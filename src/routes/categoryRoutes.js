import express from 'express';
import { createCategory, getCategories, updateCategory, updateCategoryStatus } from '../controllers/categoryController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, getCategories);
router.post('/', protect, authorize('admin'), createCategory);
router.put('/:id', protect, authorize('admin'), updateCategory);
router.patch('/:id/status', protect, authorize('admin'), updateCategoryStatus);

export default router;
