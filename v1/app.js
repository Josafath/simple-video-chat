const express = require("express");
const path = require("path");
const logger = require("morgan");
const session = require("express-session");
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

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
  } catch (err) {
    done(err);
  }
});

const indexRouter = require("./routes/index");

const app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Behind a proxy (Render, Railway, Heroku...) this lets the secure cookie work.
if (config.isProduction) app.set("trust proxy", 1);

app.use(logger("dev"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// The same session middleware is shared with Socket.IO in bin/www, so the
// signaling server knows which user is behind each socket.
const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
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
