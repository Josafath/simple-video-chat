const express = require("express");
const path = require("path");
const logger = require("morgan");
const helmet = require("helmet");
const mongoose = require("mongoose");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const config = require("./config");
const User = require("./models/Users");

// The credentials now come from the environment (see config.js and .env.example).
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await User.findOne({ name: username.trim() });
      // Same message for both cases so nobody can find out which usernames exist.
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return done(null, false, { message: "Incorrect username or password" });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// The session keeps the user's id and name, the only fields the pages and the
// signaling server use. Before, every request (pages, /ice-servers, the socket
// handshake) looked the user up in MongoDB again. Usernames can't change, so the
// copy in the session never goes stale.
passport.serializeUser((user, done) => {
  done(null, { id: String(user._id), name: user.name });
});

passport.deserializeUser((data, done) => {
  // Anything else (for example a session from an older version) logs the user out.
  if (!data || typeof data.id !== "string" || typeof data.name !== "string") return done(null, false);
  done(null, { _id: data.id, id: data.id, name: data.name });
});

const indexRouter = require("./routes/index");

const app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Behind a proxy (Render, Railway, Heroku...) this lets the secure cookie work.
if (config.isProduction) app.set("trust proxy", 1);

// Security headers. The Content Security Policy only allows what the pages use:
// our own files, the emoji picker from jsDelivr, the error page's Giphy embed and
// the WebSocket of Socket.IO. Inline styles stay allowed because the emoji picker
// injects its own <style>.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.jsdelivr.net"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "frame-src": ["https://giphy.com"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      // Only upgrade to HTTPS in production: on http://localhost it would break the page.
      "upgrade-insecure-requests": config.isProduction ? [] : null,
    },
  },
  // HSTS tells browsers to only use HTTPS: only meaningful once deployed with HTTPS.
  strictTransportSecurity: config.isProduction,
}));

app.use(logger("dev"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8 hours

// The same session middleware is shared with Socket.IO in bin/www, so the
// signaling server knows which user is behind each socket.
const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  // Sessions live in MongoDB (collection "sessions") instead of the server's memory:
  // a restart or a deploy no longer logs everybody out, so browsers in a call can
  // reconnect on their own. Reuses Mongoose's connection (opened in bin/www).
  store: MongoStore.create({
    clientPromise: mongoose.connection.asPromise().then((connection) => connection.getClient()),
    ttl: SESSION_MAX_AGE_MS / 1000, // MongoDB deletes expired sessions by itself
    touchAfter: 60 * 60, // refresh the expiry at most once an hour, not on every request
  }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: SESSION_MAX_AGE_MS,
  },
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// res.locals belongs to this request only. The old code also wrote to
// app.locals, which is shared by every request and could show one user's
// name to another.
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});

app.use("/", indexRouter);

// catch 404 and forward to error handler
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // Only show the real message for client errors; server errors stay generic.
  res.locals.message = status < 500 ? err.message : "Something went wrong";
  res.locals.error = { status };
  res.status(status);
  res.render("error");
});

module.exports = { app, sessionMiddleware };
