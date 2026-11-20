import bcrypt from 'bcryptjs';
import Category from '../models/Category.js';
import Item from '../models/Item.js';
import User from '../models/User.js';

export async function seedDatabase() {
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  const adminName = process.env.INITIAL_ADMIN_NAME || 'System Administrator';
  let admin = await User.findOne({ role: 'admin' });

  if (!admin) {
    if (!adminEmail || !adminPassword || adminPassword.length < 12) {
      throw new Error('Set INITIAL_ADMIN_EMAIL and an INITIAL_ADMIN_PASSWORD of at least 12 characters in backend/.env.');
    }

    admin = await User.create({
      fullName: adminName,
      email: adminEmail.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'admin',
      department: 'Administration',
    });
    console.log(`Created initial administrator account for ${admin.email}.`);
  }

  const categoriesExist = await Category.exists();
  if (!categoriesExist) {
    const categories = await Category.insertMany([
      { name: 'Food', description: 'Cooked and dry food items' },
      { name: 'Vegetables', description: 'Fresh vegetables and greens' },
      { name: 'Meat', description: 'Poultry and red meat products' },
      { name: 'Dairy Products', description: 'Milk, cheese, eggs and related items' },
      { name: 'Beverages', description: 'Drinks and beverages' },
      { name: 'Cleaning Materials', description: 'Cleaning and sanitation items' },
    ]);

    const foodCategory = categories.find((category) => category.name === 'Food');
    const vegetablesCategory = categories.find((category) => category.name === 'Vegetables');
    const meatCategory = categories.find((category) => category.name === 'Meat');
    const dairyCategory = categories.find((category) => category.name === 'Dairy Products');
    const beveragesCategory = categories.find((category) => category.name === 'Beverages');

    await Item.insertMany([
      { name: 'Rice', categoryId: foodCategory._id, unit: 'Kg', description: 'Rice for daily kitchen use', createdBy: admin._id },
      { name: 'Cooking Oil', categoryId: foodCategory._id, unit: 'Litres', description: 'Kitchen oil', createdBy: admin._id },
      { name: 'Tomatoes', categoryId: vegetablesCategory._id, unit: 'Kg', description: 'Fresh tomatoes', createdBy: admin._id },
      { name: 'Onions', categoryId: vegetablesCategory._id, unit: 'Kg', description: 'Fresh onions', createdBy: admin._id },
      { name: 'Beef', categoryId: meatCategory._id, unit: 'Kg', description: 'Fresh beef', createdBy: admin._id },
      { name: 'Chicken', categoryId: meatCategory._id, unit: 'Kg', description: 'Chicken cuts', createdBy: admin._id },
      { name: 'Milk', categoryId: dairyCategory._id, unit: 'Litres', description: 'Fresh milk', createdBy: admin._id },
      { name: 'Eggs', categoryId: dairyCategory._id, unit: 'Pieces', description: 'Fresh eggs', createdBy: admin._id },
      { name: 'Mineral Water', categoryId: beveragesCategory._id, unit: 'Bottles', description: 'Water bottles', createdBy: admin._id },
    ]);
  }
}
