const mongoose = require("mongoose");
const passport = require("passport");
const { Server } = require("socket.io");
const Room = require("./models/Rooms");

// WebRTC in this app is one to one, so a room holds two people at most.
const MAX_CLIENTS = 2;
const MAX_CHAT_LENGTH = 500;
// How long a seat is kept for someone whose connection dropped (Wi-Fi blip, phone
// in the background, server hiccup) before their partner is told they left.
const RECONNECT_GRACE_MS = 10_000;

// Express middlewares only need to run on the first HTTP request of a socket
// (the handshake), not on every polling request that comes after it.
function onlyForHandshake(middleware) {
  return (req, res, next) => {
    const isHandshake = req._query.sid === undefined;
    if (isHandshake) middleware(req, res, next);
    else next();
  };
}

function setupSockets(server, sessionMiddleware, { reconnectGraceMs = RECONNECT_GRACE_MS } = {}) {
  const io = new Server(server);

  // Seats held for people who lost their connection: roomId -> Map(userId -> timer).
  // A held seat counts toward the room's limit, so nobody else can take it meanwhile.
  const heldSeats = new Map();

  function holdSeat(roomId, userId) {
    const seats = heldSeats.get(roomId) ?? new Map();
    heldSeats.set(roomId, seats);
    clearTimeout(seats.get(userId));
    seats.set(userId, setTimeout(() => {
      releaseSeat(roomId, userId);
      // They didn't come back in time: now it counts as hanging up.
      io.to(roomId).emit("bye");
    }, reconnectGraceMs));
  }

  // Returns true when this user had a held seat in the room.
  function releaseSeat(roomId, userId) {
    const seats = heldSeats.get(roomId);
    if (!seats || !seats.has(userId)) return false;
    clearTimeout(seats.get(userId));
    seats.delete(userId);
    if (seats.size === 0) heldSeats.delete(roomId);
    return true;
  }

  // Read the login session so only logged in users can use the signaling
  // server. Before, anyone could connect and send messages to any room.
  io.engine.use(onlyForHandshake(sessionMiddleware));
  io.engine.use(onlyForHandshake(passport.session()));
  io.engine.use(onlyForHandshake((req, res, next) => {
    if (req.user) return next();
    res.writeHead(401);
    res.end();
  }));

  io.on("connection", (socket) => {
    const user = socket.request.user;
    const userId = String(user._id);
    // The room this socket joined. The server keeps it, so a client can't
    // send messages to a room it isn't part of.
    socket.data.room = null;

    socket.on("create or join", async (roomId) => {
      if (socket.data.room) return;
      // Only rooms that were created from /home can be joined.
      let exists = false;
      try {
        exists = mongoose.isValidObjectId(roomId) && Boolean(await Room.exists({ _id: roomId }));
      } catch (err) {
        // An error thrown here would not be caught and would stop the server.
        console.error("Could not look up room", err);
      }
      if (!exists) {
        socket.emit("invalid room");
        return;
      }
      if (socket.data.room) return; // a second "create or join" arrived meanwhile

      // Coming back after a dropped connection: take the held seat again. The
      // partner never got "bye", so the call can carry on (or recover, see main.js).
      if (releaseSeat(roomId, userId)) {
        socket.join(roomId);
        socket.data.room = roomId;
        const others = io.sockets.adapter.rooms.get(roomId).size - 1;
        socket.emit("rejoined", { peerPresent: others > 0 });
        socket.to(roomId).emit("peer rejoined");
        return;
      }

      // Count after the await so two people joining at once see the real number.
      // Held seats count too, so a stranger can't take the place of someone reconnecting.
      const clients = io.sockets.adapter.rooms.get(roomId);
      const numClients = (clients ? clients.size : 0) + (heldSeats.get(roomId)?.size ?? 0);

      // The old code used 1 as the default here, so the second person was
      // treated like the first one and the call never started.
      if (numClients === 0) {
        socket.join(roomId);
        socket.data.room = roomId;
        socket.emit("created", roomId);
      } else if (numClients < MAX_CLIENTS) {
        socket.join(roomId);
        socket.data.room = roomId;
        socket.emit("joined", roomId);
        // The person who was already waiting creates the WebRTC offer.
        socket.to(roomId).emit("ready");
      } else {
        socket.emit("full", roomId);
      }
    });

    // WebRTC signaling (offer, answer and ICE candidates) for the other peer.
    socket.on("message", (message) => {
      if (!socket.data.room) return;
      socket.to(socket.data.room).emit("message", message);
    });

    // Chat messages now stay inside the room (before, io.emit sent them to
    // every connected user in every room).
    socket.on("chat message", (text) => {
      if (!socket.data.room || typeof text !== "string") return;
      const msg = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!msg) return;
      io.to(socket.data.room).emit("chat message", {
        from: socket.id,
        user: user.name,
        text: msg,
      });
    });

    // The user hung up: tell the other peer and leave the room.
    socket.on("bye", () => {
      if (!socket.data.room) return;
      socket.to(socket.data.room).emit("bye");
      socket.leave(socket.data.room);
      socket.data.room = null;
    });

    // A dropped connection isn't a hang-up yet: hold the seat for a few seconds
    // and let the partner know, in case they come back. Closing the tab sends
    // "bye" first (see main.js), so leaving on purpose is still immediate.
    socket.on("disconnecting", () => {
      const roomId = socket.data.room;
      if (!roomId) return;
      holdSeat(roomId, userId);
      socket.to(roomId).emit("peer disconnected");
    });
  });

  return io;
}

module.exports = setupSockets;
