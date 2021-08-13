const passport = require("passport");
const User = require("../models/Users");
const Room = require("../models/Rooms");
const bcrypt = require("bcryptjs");

exports.index = (req, res, next) => {
    res.render('index', { title: 'SP. Improving your coding skills.' });
}

exports.login_get = (req,res, next) => {
    res.render('login',{title: "Login"})
}

exports.signup_get = (req, res, next) => {
    res.render('signup',{title: "Sign up"})
}

exports.log_out_get = (req, res, next) => {
    req.logout();
    res.redirect('/');
}

exports.home_get = async (req, res,next) => {
  console.log("User --> ",req.user)

  const any_rooms = await Room.count({}).exec();
  console.log("# of Rooms --> ", any_rooms);
  
  if(any_rooms) {
    Room.deleteMany({}, (err, result) => {
      if(err) return next(err)

      console.log("Rooms deleted");
    })
  }
  res.render('home',{title: "Welcome!"})
}

exports.join_get = (req,res, next) => {
    res.render('join', {title:"Join the partner meeting"})
}

exports.join_post = async (req, res, next) => {
    const room = await Room.findOne({name: req.body.room,}).exec();
    console.log(room);
    if(room){
        res.redirect(room.url);
    }else {
        res.redirect("/home/join");
    }
};

exports.home_post = (req,res,next) => {
    console.log(req.body)
    const taken_Room_name =  Room.find({name: req.body.room})
    if(taken_Room_name.length > 0){
      res.render('home', {errors: true, success: [], user:res.locals.currentUser})
    }
    else {
      const room = new Room({
        name: req.body.room,
      })
      room.save((err)=> {
        if(err) return next(err)
          res.redirect(room.url)
        })
    }
}

exports.signup_post = (req, res, next) =>{
    //* Checking if user exists in DB.
    User.countDocuments({name: req.body.username},(err, result)=> {
      if(result == 1){ 
        res.redirect("/signup");
        return;
      }
    })
    User.countDocuments({name: req.body.email},(err, result)=> {
      if(result == 1){ 
        res.redirect("/signup");
        return;
      }
    })
    // There're no users with the same username or email. 
    //* Then insert in the DB.
    const user = new User({
      name: req.body.username,
      email: req.body.email,
      password: req.body.password
    });
    bcrypt.hash(req.body.password,10, (err, hashedPassword) => {
      if(err) return next(err);
      user.password = hashedPassword;
      user.save((err) => {
        if(err){
          return next(err)
        }
        req.login(user,function(err){
          if(err) {
            return next(err)
          }
          return res.redirect("/home")
        })
      })
    })
}