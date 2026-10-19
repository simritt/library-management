const express = require('express');
const router = express.Router();
const controller = require('../controllers/bookRequestController');
const { requireAuth, requireStaff } = require('../middlewares/authMiddleware');

router.get('/policy', requireAuth, controller.getPolicy);
router.get('/mine', requireAuth, controller.getMyRequests);
router.post('/', requireAuth, controller.createRequest);
router.post('/:requestId/cancel', requireAuth, controller.cancelMyRequest);
router.get('/', requireStaff, controller.getAllRequests);
router.patch('/:requestId/review', requireStaff, controller.reviewRequest);

module.exports = router;
