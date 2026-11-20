import express from 'express';
import { createUser, listUsers, updateUser, updateUserStatus } from '../controllers/userController.js';

const router = express.Router();

router.get('/', listUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/status', updateUserStatus);

export default router;
