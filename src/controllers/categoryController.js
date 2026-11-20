import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Item from '../models/Item.js';

export const getCategories = async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { isActive: true };
    const categories = await Category.find(filter).sort({ name: 1 });
    return res.json(categories);
  } catch (error) {
    console.error('Get categories failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch categories.' });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Category name is required.' });
    const category = await Category.create({
      name: name.trim(),
      description: String(description || '').trim(),
    });
    return res.status(201).json({ message: 'Category created.', category });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A category with this name already exists.' });
    console.error('Create category failed:', error.message);
    return res.status(500).json({ message: 'Unable to create category.' });
  }
};

export const updateCategory = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid category ID.' });
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    if (req.body.name !== undefined) category.name = String(req.body.name).trim();
    if (req.body.description !== undefined) category.description = String(req.body.description).trim();
    if (typeof req.body.isActive === 'boolean') category.isActive = req.body.isActive;
    await category.save();
    return res.json({ message: 'Category updated.', category });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A category with this name already exists.' });
    console.error('Update category failed:', error.message);
    return res.status(500).json({ message: 'Unable to update category.' });
  }
};

export const updateCategoryStatus = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid category ID.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean.' });
    if (!req.body.isActive && await Item.exists({ categoryId: req.params.id, isActive: true })) {
      return res.status(409).json({ message: 'Deactivate or move this category’s active items first.' });
    }
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { returnDocument: 'after' });
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    return res.json({ message: 'Category status updated.', category });
  } catch (error) {
    console.error('Update category status failed:', error.message);
    return res.status(500).json({ message: 'Unable to update category status.' });
  }
};
