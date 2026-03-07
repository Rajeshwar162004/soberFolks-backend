// authRoutes.js - Authentication routes

const express = require('express');
const router = express.Router();
const { signup, login } = require('../controllers/authController');

// POST /signup - Register new user (Consumer or Driver)
router.post('/signup', signup);

// POST /login - User login
router.post('/login', login);

module.exports = router;
