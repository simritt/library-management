const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { requireStaff, requireAdmin, requireAuth } = require('../middlewares/authMiddleware');

// Staff-only member listing and registration
router.get('/', requireStaff, memberController.getMembers);
router.post('/register', requireStaff, memberController.registerMember);
router.put('/:membershipId', requireStaff, memberController.updateMember);

// Administrator-only deactivation & reactivation (FR-Member.Deactivate-01)
router.post('/:membershipId/deactivate', requireAdmin, memberController.deactivateMember);
router.post('/:membershipId/reactivate', requireAdmin, memberController.reactivateMember);

// Member details (Accessible to staff OR patron themselves per SE-6)
router.get('/:membershipId', requireAuth, memberController.getMemberDetails);

module.exports = router;
