// Shared helpers for the integration tests: an in-memory MongoDB, the real app on a
// free port, users, logged-in cookies and Socket.IO clients. Nothing here talks to
// MongoDB Atlas, Xirsys or the developer's .env.
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: connectSocket } = require("socket.io-client");

// Ports that fetch() and browsers refuse to connect to ("bad port"), from the Fetch
// standard. Some systems hand them out as free ports (on Windows the dynamic range can
// start at 1024), so the test server must avoid them.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Listens on a free port that fetch() and browsers accept. */
async function listenOnUsablePort(server) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    if (!FETCH_BLOCKED_PORTS.has(server.address().port)) return;
    await new Promise((resolve) => server.close(resolve));
  }
  throw new Error("could not find a usable port");
}

/**
 * Starts MongoDB in memory and the app (Express + Socket.IO) on a free port.
 * The environment is set before the app is required, because config.js reads it once.
 */
async function startTestServer({ reconnectGraceMs = 300 } = {}) {
  const mongo = await MongoMemoryServer.create();
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = mongo.getUri("videochat-test");
  process.env.SESSION_SECRET = "test-session-secret";
  // No TURN account and no external STUN: tests must not depend on the internet.
  for (const name of ["XIRSYS_IDENT", "XIRSYS_SECRET", "XIRSYS_CHANNEL", "XIRSYS_URL"]) delete process.env[name];
  process.env.ICE_SERVERS = "[]";

  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI);
  // Unique indexes (usernames, emails, room names) must exist before the tests rely on them.
  await Promise.all([require("../models/Users").init(), require("../models/Rooms").init()]);

  const { createServer } = require("../server");
  const { server, io } = createServer({ reconnectGraceMs });
  await listenOnUsablePort(server);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sockets = new Set();
  return {
    baseUrl,
    mongoose,
    /** A Socket.IO client logged in with `cookie`; closed automatically by stop(). */
    socket(cookie, options = {}) {
      const socket = connectSocket(baseUrl, {
        transports: ["websocket"],
        extraHeaders: cookie ? { cookie } : {},
        reconnection: false,
        forceNew: true,
        ...options,
      });
      sockets.add(socket);
      return socket;
    },
    async stop() {
      for (const socket of sockets) socket.disconnect();
      io.close();
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

let userCount = 0;
/** Creates a user directly in the database (fast bcrypt cost). */
async function createUser(name = `user${++userCount}`, password = "correct-password") {
  const bcrypt = require("bcryptjs");
  const User = require("../models/Users");
  await new User({ name, email: `${name}@example.test`, password: await bcrypt.hash(password, 4) }).save();
  return { name, password };
}

/** Sends a form like a browser does, without following redirects. */
function postForm(baseUrl, path, fields, cookie) {
  return fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

/** The "name=value" part of the session cookie a response set. */
function sessionCookie(response) {
  const header = response.headers.getSetCookie().find((c) => c.startsWith("connect.sid="));
  return header ? header.split(";")[0] : null;
}

async function login(baseUrl, { name, password }) {
  const response = await postForm(baseUrl, "/login", { username: name, password });
  if (response.status !== 302) throw new Error(`login failed with ${response.status}`);
  return sessionCookie(response);
}

/** Creates a room through the app and returns its id. */
async function createRoom(baseUrl, cookie, name) {
  const response = await postForm(baseUrl, "/home", { room: name }, cookie);
  if (response.status !== 302) throw new Error(`room creation failed with ${response.status}`);
  return response.headers.get("location").split("/").pop();
}

/** Resolves with the event's first argument, or rejects after `ms`. */
function nextEvent(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for "${event}"`));
    }, ms);
    function onEvent(value) {
      clearTimeout(timer);
      resolve(value);
    }
    socket.once(event, onEvent);
  });
}

/** Collects every event a socket receives, to assert on what did NOT happen. */
function recordEvents(socket) {
  const events = [];
  socket.onAny((event) => events.push(event));
  return events;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { startTestServer, createUser, postForm, sessionCookie, login, createRoom, nextEvent, recordEvents, wait };
