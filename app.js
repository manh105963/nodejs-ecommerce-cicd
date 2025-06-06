var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var exphbs = require('express-handlebars');
var fileUpload = require('express-fileupload');
var session = require('express-session');
var db = require('./config/connection');

var userRouter = require('./routes/user');
var adminRouter = require('./routes/admin');

var app = express();

app.engine('hbs', exphbs.engine({
  extname: 'hbs',
  defaultLayout: 'layout',
  layoutsDir: path.join(__dirname, 'views', 'layout'),
  partialsDir: path.join(__dirname, 'views', 'partials'),
  helpers: {
    eq: function (value1, value2) {
      return value1 === value2;
    },
    increment: function (value) {
      return value + 1;
    },
    gt: function (value1, value2) {
      return value1 > value2;
    },
    multiply: function (price, quantity) {
      const cleanPrice = parseFloat(price.replace(/[^0-9.-]+/g, ""));
      return cleanPrice * quantity;
    },
    totalPrice: function (items) {
      return items.reduce((acc, item) => {
        const cleanPrice = parseFloat(item.product.Price.replace(/[^0-9.-]+/g, ""));
        return acc + cleanPrice * item.quantity;
      }, 0);
    },
    formatDate: function (date) {
      const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };
      return new Date(date).toLocaleString('en-US', options);
    },

    not: function (value) {
      return !value;
    }
  }
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(fileUpload());


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


app.use(session({
  secret: "Key",
  cookie: { maxAge: 5 * 60 * 1000 },
  resave: false,
  saveUninitialized: true
}));

// Middleware to set loggedIn and adminLoggedIn status
app.use((req, res, next) => {
  res.locals.loggedIn = req.session.isLoggedIn || false; // For user login
  res.locals.adminLoggedIn = req.session.adminLoggedIn || false; // For admin login
  res.locals.isProfilePage = req.path === '/profile'; // Determine if on profile page
  next();
});


db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
  } else {
    console.log("Database connected successfully");
  }
});

// Use routers
app.use('/', userRouter);
app.use('/admin', adminRouter);


app.use(function (req, res, next) {
  next(createError(404));
});

app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
