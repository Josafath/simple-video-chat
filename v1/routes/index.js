const express = require('express');
const passport = require("passport");
const { rateLimit } = require("express-rate-limit");
const controller = require("../controllers/index");

const router = express.Router();

// Pages for logged-in users. Visitors are sent to the login page, and the page they
// wanted (for example an invite link) is remembered so they come back to it after.
function loggedIn(req, res, next) {
  if (req.user) return next();
  if (req.method === "GET" && /^\/(room\/|home)/.test(req.originalUrl)) req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

// Brute-force protection: 10 failed logins per IP every 15 minutes. Successful
// logins don't count, so a user who types the password wrong once isn't punished.
// Limits are per server process (in memory); see the README for multi-server setups.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const minutes = Math.ceil(options.windowMs / 60000);
    res.status(options.statusCode).render('login', {
      title: "Login",
      error: `Too many failed attempts. Try again in ${minutes} minutes.`,
    });
  },
});

// Stops scripts from creating accounts in bulk: 10 sign-ups per IP per hour.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    res.status(options.statusCode).render('signup', {
      title: "Sign up",
      error: "Too many accounts were created from this network. Try again later.",
      values: {},
    });
  },
});

/* GET home page. */
router.get('/', controller.index);

router.get('/login', controller.login_get);

// A failed login answers 401 (instead of redirecting) so the limiter counts it.
router.post("/login", loginLimiter, (req, res, next) => {
  passport.authenticate("local", (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).render('login', { title: "Login", error: "Incorrect username or password" });
    }
    // Read it before logging in: req.login starts a new session.
    const returnTo = req.session.returnTo;
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      res.redirect(controller.afterLogin(returnTo));
    });
  })(req, res, next);
});

router.get('/signup', controller.signup_get)

router.post('/signup', signupLimiter, controller.signup_post);

// POST, not GET: a link or image on another site can't log the user out.
router.post('/log-out', controller.log_out_post)

// Every page below needs a logged in user (before, only the room page did).
router.get("/home", loggedIn, controller.home_get)

router.post('/home', loggedIn, controller.home_post)

router.get('/home/join', loggedIn, controller.join_get);

router.post('/home/join', loggedIn, controller.join_post);

// A private room, opened with its invite link.
router.get('/room/:token', loggedIn, controller.room_get)

router.get('/ice-servers', loggedIn, controller.ice_servers_get)

module.exports = router;
