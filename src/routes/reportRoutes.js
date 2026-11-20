import express from 'express';
import { exportRequestsCsv, exportRequestsPdf, getConsolidatedPurchaseList, getDashboardStats, getReports } from '../controllers/reportController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/dashboard', protect, authorize('admin'), getDashboardStats);
router.get('/consolidated-purchase-list', protect, authorize('admin'), getConsolidatedPurchaseList);
router.get('/export/csv', protect, authorize('admin'), exportRequestsCsv);
router.get('/export/pdf', protect, authorize('admin'), exportRequestsPdf);
router.get('/daily', protect, authorize('admin'), getReports);
router.get('/weekly', protect, authorize('admin'), getReports);
router.get('/monthly', protect, authorize('admin'), getReports);

export default router;
