import express from 'express';
import { addRequestComment, approveRequest, createPurchaseRequest, getMyRequests, getPurchaseRequest, listPurchaseRequests, rejectRequest, submitPurchaseDraft, updatePurchaseDraft, updatePurchaseProgress } from '../controllers/purchaseRequestController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, listPurchaseRequests);
router.get('/my-requests', protect, getMyRequests);
router.post('/', protect, createPurchaseRequest);
router.get('/:id', protect, getPurchaseRequest);
router.post('/:id/comments', protect, addRequestComment);
router.put('/:id/draft', protect, updatePurchaseDraft);
router.post('/:id/submit', protect, submitPurchaseDraft);
router.patch('/:id/approve', protect, authorize('admin'), approveRequest);
router.patch('/:id/reject', protect, authorize('admin'), rejectRequest);
router.patch('/:id/purchase-progress', protect, authorize('admin'), updatePurchaseProgress);

export default router;
