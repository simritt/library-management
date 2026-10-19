const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { requireAdmin } = require('../middlewares/authMiddleware');

// Administrative reports (SE-5, FR-Report)
router.get('/inventory', requireAdmin, reportsController.getInventoryReport);
router.get('/overdue', requireAdmin, reportsController.getOverdueReport);
router.get('/circulation', requireAdmin, reportsController.getCirculationReport);
router.get('/fines', requireAdmin, reportsController.getFinesReport);
router.get('/export/:type', requireAdmin, reportsController.exportReportCsv);

// System Configuration
router.get('/settings', requireAdmin, reportsController.getSettings);
router.put('/settings', requireAdmin, reportsController.updateSettings);

module.exports = router;
