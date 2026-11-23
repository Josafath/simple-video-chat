const http = require("http");
const { app, sessionMiddleware } = require("./app");
const setupSockets = require("./sockets");

/**
 * Creates the HTTP server (Express) with the Socket.IO signaling server on it.
 * bin/www starts it for real; the tests start one on a free port with a short
 * reconnect grace period. It doesn't listen or connect to MongoDB by itself.
 */
function createServer(socketOptions = {}) {
  const server = http.createServer(app);
  const io = setupSockets(server, sessionMiddleware, socketOptions);
  return { server, io };
}

module.exports = { createServer };
