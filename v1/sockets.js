const mongoose = require("mongoose");
const passport = require("passport");
const { Server } = require("socket.io");
const Room = require("./models/Rooms");

// WebRTC in this app is one to one, so a room holds two people at most.
const MAX_CLIENTS = 2;
const MAX_CHAT_LENGTH = 500;

// Express middlewares only need to run on the first HTTP request of a socket
// (the handshake), not on every polling request that comes after it.
function onlyForHandshake(middleware) {
  return (req, res, next) => {
    const isHandshake = req._query.sid === undefined;
    if (isHandshake) middleware(req, res, next);
    else next();
  };
}

function setupSockets(server, sessionMiddleware) {
  const io = new Server(server);

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
      // Count after the await so two people joining at once see the real number.
      const clients = io.sockets.adapter.rooms.get(roomId);
      const numClients = clients ? clients.size : 0;

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

    // Closing the tab or losing the connection also counts as hanging up.
    socket.on("disconnecting", () => {
      if (socket.data.room) socket.to(socket.data.room).emit("bye");
    });
  });

  return io;
}

module.exports = setupSockets;
