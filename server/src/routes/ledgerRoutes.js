const express = require('express');
const router = express.Router();
const controller = require('../controllers/ledgerController');
const { requireAuth, requireStaff } = require('../middlewares/authMiddleware');

router.get('/me', requireAuth, controller.getMyLedger);
router.get('/members/:membershipId', requireStaff, controller.getMemberLedger);
router.get('/books/:isbn', requireStaff, controller.getBookLedger);

module.exports = router;
