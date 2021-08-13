var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const session = require("express-session");
const mongoose = require("mongoose");
const passport = require('passport');
const LocalStrategy = require("passport-local").Strategy;
const User = require("./models/Users");
const bcrypt = require("bcryptjs");
require('dotenv').config()


const mongoDb = process.env.DB;
mongoose.connect(mongoDb, { useUnifiedTopology: true, useNewUrlParser: true });
const db = mongoose.connection;
db.on("error", console.error.bind(console, "mongo connection error"));

passport.use(
  new LocalStrategy((username, password, done) => {
    User.findOne({name: username}, (err, user) => {
      if (err) {
        return done(err);
      }
      if (!user) {
        return done(null, false, { msg: "Incorrect username" });
      }
      bcrypt.compare(password, user.password, (err, res) => {
        if (res) {
          // passwords match! log user in
          return done(null, user);
        } else {
          // passwords do not match!
          return done(null, false, { msg: "Incorrect password" });
        }
      });
    });
  })
);


passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

var indexRouter = require('./routes/index');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');


app.use(session({ secret: "demoapp", resave: true, saveUninitialized: true }));

app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  app.locals.currentUser = req.user;
  res.locals.currentUser = req.user;
  next();
});


app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname+'/public'));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
