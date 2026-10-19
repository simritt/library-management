const express = require('express');
const router = express.Router();
const circulationController = require('../controllers/circulationController');
const { requireStaff, requireAdmin, requireAuth } = require('../middlewares/authMiddleware');

// Circulation Desk operations (Staff-only: SE-4)
router.get('/loans', requireStaff, circulationController.getActiveLoans);
router.get('/reservations', requireStaff, circulationController.getReservationQueue);
router.get('/issue/preview', requireStaff, circulationController.previewIssue);
router.post('/issue', requireStaff, circulationController.issueBook);
router.post('/return', requireStaff, circulationController.returnBook);
router.post('/fines/pay', requireStaff, circulationController.payFine);

// Fine waiver (Administrator only: SE-5, BR-8)
router.post('/fines/waive', requireAdmin, circulationController.waiveFine);

// Reservations (Patron or Staff: FR-Reserve.Create-01)
router.post('/reserve', requireAuth, circulationController.createReservation);
router.post('/reserve/:reservationId/cancel', requireAuth, circulationController.cancelReservation);

module.exports = router;
