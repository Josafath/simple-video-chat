var express = require('express');
var router = express.Router();
const passport = require("passport");
const controller = require("../controllers/index")

/* GET home page. */
router.get('/', controller.index);

router.get('/login', controller.login_get);

router.post("/login", passport.authenticate("local",
  {
    failureRedirect: "/login"
  }),
  function(req,res) {
    res.set('Content-Type', 'text/plain');
    res.redirect("/home")
  })

router.get('/signup', controller.signup_get)

router.post('/signup', controller.signup_post);

router.get('/log-out', controller.log_out_get)

router.get("/home", controller.home_get)

router.post('/home', controller.home_post )

router.get('/home/join', controller.join_get);

router.post('/home/join', controller.join_post);

//* Making a function to ensure that the user has already login
function loggedIn(req, res, next) {
  if (req.user) {
      next();
  } else {
      res.redirect('/login');
  }
}

router.get('/home/room/:id',loggedIn,(req, res, next) => {
  res.render('app',{title: "Meeting in Progress"})
})


module.exports = router;
