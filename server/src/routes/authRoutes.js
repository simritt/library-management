const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Staff auth
router.post('/login', authController.loginStaff);
// Patron auth
router.post('/patron-login', authController.loginPatron);
// Current session
router.get('/me', authController.getCurrentUser);
// Logout
router.post('/logout', authController.logout);

module.exports = router;
