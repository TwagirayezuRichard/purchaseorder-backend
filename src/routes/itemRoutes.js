import express from 'express';
import { createItem, getItems, updateItem, updateItemStatus } from '../controllers/itemController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getItems);
router.post('/', protect, authorize('admin'), createItem);
router.put('/:id', protect, authorize('admin'), updateItem);
router.patch('/:id/status', protect, authorize('admin'), updateItemStatus);

export default router;
