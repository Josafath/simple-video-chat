const express = require('express');
const passport = require("passport");
const { rateLimit } = require("express-rate-limit");
const controller = require("../controllers/index");

const router = express.Router();

//* Making a function to ensure that the user has already login
function loggedIn(req, res, next) {
  if (req.user) {
      next();
  } else {
      res.redirect('/login');
  }
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
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      res.redirect("/home");
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

router.get('/home/room/:id', loggedIn, controller.room_get)

router.get('/ice-servers', loggedIn, controller.ice_servers_get)

module.exports = router;
