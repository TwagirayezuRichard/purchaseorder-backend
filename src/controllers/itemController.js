import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Item from '../models/Item.js';
import AuditLog from '../models/AuditLog.js';

export const getItems = async (req, res) => {
  try {
    const { categoryId, search, activeOnly } = req.query;
    const filters = {};

    if (categoryId) {
      if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ message: 'Invalid category ID.' });
      filters.categoryId = categoryId;
    }

    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filters.name = { $regex: escaped, $options: 'i' };
    }

    if (req.user.role !== 'admin' || activeOnly === 'true') {
      filters.isActive = true;
      const activeCategories = await Category.find({ isActive: true }).distinct('_id');
      filters.categoryId = {
        ...(filters.categoryId ? { $eq: filters.categoryId } : {}),
        $in: activeCategories,
      };
    }
    const items = await Item.find(filters).populate('categoryId', 'name').sort({ name: 1 });
    return res.json(items);
  } catch (error) {
    console.error('Get items failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch catalogue items.' });
  }
};

export const createItem = async (req, res) => {
  try {
    const { name, categoryId, unit, description, minimumStockLevel } = req.body;

    if (!name?.trim() || !categoryId || !unit?.trim()) {
      return res.status(400).json({ message: 'Item name, category and unit are required.' });
    }
    if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ message: 'Invalid category ID.' });
    const stockLevel = Number(minimumStockLevel || 0);
    if (!Number.isFinite(stockLevel) || stockLevel < 0) {
      return res.status(400).json({ message: 'Minimum stock level must be zero or greater.' });
    }

    const category = await Category.findOne({ _id: categoryId, isActive: true });
    if (!category) return res.status(404).json({ message: 'Selected active category was not found.' });

    const item = await Item.create({
      name: name.trim(),
      categoryId,
      unit: unit.trim(),
      description: String(description || '').trim(),
      minimumStockLevel: stockLevel,
      createdBy: req.user.id,
    });
    await AuditLog.create({
      userId: req.user.id,
      action: 'catalogue_item_created',
      entityType: 'Item',
      entityId: item._id.toString(),
      newValue: { name: item.name, unit: item.unit },
      ipAddress: req.ip,
    });

    return res.status(201).json({ message: 'Item created successfully.', item: await item.populate('categoryId', 'name') });
  } catch (error) {
    console.error('Create item failed:', error.message);
    return res.status(500).json({ message: 'Unable to create item.' });
  }
};

export const updateItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid item ID.' });
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found.' });

    const { name, categoryId, unit, description, minimumStockLevel } = req.body;
    if (name !== undefined) item.name = String(name).trim();
    if (unit !== undefined) item.unit = String(unit).trim();
    if (description !== undefined) item.description = String(description).trim();
    if (categoryId !== undefined) {
      if (!mongoose.isValidObjectId(categoryId) || !(await Category.exists({ _id: categoryId, isActive: true }))) {
        return res.status(400).json({ message: 'Select a valid active category.' });
      }
      item.categoryId = categoryId;
    }
    if (minimumStockLevel !== undefined) {
      const value = Number(minimumStockLevel);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Minimum stock level must be zero or greater.' });
      item.minimumStockLevel = value;
    }
    await item.save();
    return res.json({ message: 'Item updated.', item: await item.populate('categoryId', 'name') });
  } catch (error) {
    console.error('Update item failed:', error.message);
    return res.status(500).json({ message: 'Unable to update item.' });
  }
};

export const updateItemStatus = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid item ID.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean.' });
    const item = await Item.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { returnDocument: 'after' });
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    return res.json({ message: 'Item status updated.', item });
  } catch (error) {
    console.error('Update item status failed:', error.message);
    return res.status(500).json({ message: 'Unable to update item status.' });
  }
};
