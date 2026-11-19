var express = require('express');
var router = express.Router();
const passport = require("passport");
const controller = require("../controllers/index")

//* Making a function to ensure that the user has already login
function loggedIn(req, res, next) {
  if (req.user) {
      next();
  } else {
      res.redirect('/login');
  }
}

/* GET home page. */
router.get('/', controller.index);

router.get('/login', controller.login_get);

router.post("/login", passport.authenticate("local", {
  successRedirect: "/home",
  failureRedirect: "/login?error=1"
}));

router.get('/signup', controller.signup_get)

router.post('/signup', controller.signup_post);

router.get('/log-out', controller.log_out_get)

// Every page below needs a logged in user (before, only the room page did).
router.get("/home", loggedIn, controller.home_get)

router.post('/home', loggedIn, controller.home_post)

router.get('/home/join', loggedIn, controller.join_get);

router.post('/home/join', loggedIn, controller.join_post);

router.get('/home/room/:id', loggedIn, controller.room_get)

router.get('/ice-servers', loggedIn, controller.ice_servers_get)

module.exports = router;
