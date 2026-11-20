import mongoose from 'mongoose';
import PurchaseRequest from '../models/PurchaseRequest.js';
import AuditLog from '../models/AuditLog.js';
import Item from '../models/Item.js';
import User from '../models/User.js';
import generateRequestNumber from '../utils/generateRequestNumber.js';
import { queueNotifications } from '../services/notificationService.js';

const isAdmin = (user) => user.role === 'admin';
const validId = (id) => mongoose.isValidObjectId(id);

const audit = (req, action, request, newValue, previousValue) =>
  AuditLog.create({
    userId: req.user.id,
    action,
    entityType: 'PurchaseRequest',
    entityId: request._id.toString(),
    previousValue,
    newValue,
    ipAddress: req.ip,
  });

const notifyRequester = async (request, notificationType) => {
  const employee = await User.findById(request.requestedBy).select('email');
  if (!employee) return;
  if (employee.email) {
    await queueNotifications(request._id, [
      { channel: 'email', recipient: employee.email, notificationType },
    ]);
  }
};

const normalizeRequestedItems = async (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('A request must contain at least one item.'), { status: 400 });
  }

  const itemQuantities = new Map();
  for (const entry of items) {
    if (!entry || !validId(entry.itemId) || !Number.isFinite(Number(entry.quantityRequested)) || Number(entry.quantityRequested) <= 0) {
      throw Object.assign(new Error('Each item must have a valid ID and a quantity greater than zero.'), { status: 400 });
    }
    const itemId = String(entry.itemId);
    itemQuantities.set(itemId, (itemQuantities.get(itemId) || 0) + Number(entry.quantityRequested));
  }

  const catalogItems = await Item.find({
    _id: { $in: [...itemQuantities.keys()] },
    isActive: true,
  }).populate({ path: 'categoryId', select: 'isActive' });
  if (catalogItems.length !== itemQuantities.size || catalogItems.some((item) => !item.categoryId?.isActive)) {
    throw Object.assign(new Error('One or more selected items are inactive or unavailable.'), { status: 400 });
  }

  return catalogItems.map((catalogItem) => ({
    itemId: catalogItem._id,
    itemNameSnapshot: catalogItem.name,
    quantityRequested: itemQuantities.get(catalogItem._id.toString()),
    quantityPurchased: 0,
    unitSnapshot: catalogItem.unit,
  }));
};

export const listPurchaseRequests = async (req, res) => {
  try {
    const { status, department, employee, from, to, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (!isAdmin(req.user)) {
      filter.requestedBy = req.user.id;
    } else {
      if (employee && validId(employee)) filter.requestedBy = employee;
      if (department && ['Kitchen', 'Stock'].includes(department)) filter.department = department;
    }

    if (status) {
      const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_PURCHASED', 'PURCHASED'];
      if (!statuses.includes(status)) return res.status(400).json({ message: 'Invalid request status filter.' });
      filter.status = status;
    }

    if (search) {
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.requestNumber = { $regex: escaped, $options: 'i' };
    }

    if (from || to) {
      filter.createdAt = {};
      if (from && !Number.isNaN(Date.parse(from))) filter.createdAt.$gte = new Date(from);
      if (to && !Number.isNaN(Date.parse(to))) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
    const [requests, total] = await Promise.all([
      PurchaseRequest.find(filter)
        .populate('requestedBy', 'fullName email department')
        .populate('approvedBy', 'fullName')
        .populate('rejectedBy', 'fullName')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      PurchaseRequest.countDocuments(filter),
    ]);

    return res.json({ requests, page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) });
  } catch (error) {
    console.error('List purchase requests failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch purchase requests.' });
  }
};

export const getPurchaseRequest = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });

    const request = await PurchaseRequest.findById(req.params.id)
      .populate('requestedBy', 'fullName email department')
      .populate('approvedBy', 'fullName')
      .populate('rejectedBy', 'fullName')
      .populate('comments.userId', 'fullName role');

    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!isAdmin(req.user) && request.requestedBy._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You cannot access this request.' });
    }
    return res.json(request);
  } catch (error) {
    console.error('Get purchase request failed:', error.message);
    return res.status(500).json({ message: 'Unable to load request details.' });
  }
};

export const getMyRequests = async (req, res) => {
  try {
    const requests = await PurchaseRequest.find({ requestedBy: req.user.id })
      .populate('requestedBy', 'fullName email department')
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json(requests);
  } catch (error) {
    console.error('Get my requests failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch your requests.' });
  }
};

export const createPurchaseRequest = async (req, res) => {
  try {
    const { items, notes, saveAsDraft } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || !user.isActive) return res.status(401).json({ message: 'Your account is unavailable.' });

    const idempotencyKey = req.get('Idempotency-Key');
    if (idempotencyKey) {
      if (idempotencyKey.length > 100) return res.status(400).json({ message: 'Invalid submission key.' });
      const existing = await PurchaseRequest.findOne({ idempotencyKey, requestedBy: user._id });
      if (existing) return res.status(200).json({ message: 'This request was already submitted.', request: existing });
    }

    const normalizedItems = await normalizeRequestedItems(items);

    const request = await PurchaseRequest.create({
      requestNumber: await generateRequestNumber(),
      idempotencyKey,
      requestedBy: user._id,
      department: user.department === 'Stock' ? 'Stock' : 'Kitchen',
      items: normalizedItems,
      notes: String(notes || '').trim().slice(0, 2000),
      status: saveAsDraft ? 'DRAFT' : 'PENDING_APPROVAL',
    });

    await audit(req, saveAsDraft ? 'purchase_request_draft_saved' : 'purchase_request_submitted', request, {
      requestNumber: request.requestNumber,
      status: request.status,
    });

    if (!saveAsDraft) {
      await queueNotifications(request._id, [
        { channel: 'email', recipient: process.env.ADMIN_EMAIL || 'not-configured' },
      ]);
    }

    return res.status(201).json({
      message: saveAsDraft ? 'Draft saved successfully.' : 'Purchase request submitted successfully.',
      request,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 11000 && req.get('Idempotency-Key')) {
      const existing = await PurchaseRequest.findOne({ idempotencyKey: req.get('Idempotency-Key'), requestedBy: req.user.id });
      if (existing) return res.status(200).json({ message: 'This request was already submitted.', request: existing });
    }
    console.error('Create purchase request failed:', error.message);
    return res.status(500).json({ message: 'Unable to submit purchase request.' });
  }
};

export const updatePurchaseDraft = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Draft not found.' });
    if (request.requestedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You cannot edit this draft.' });
    }
    if (request.status !== 'DRAFT') return res.status(409).json({ message: 'Only draft requests can be edited.' });

    request.items = await normalizeRequestedItems(req.body.items);
    request.notes = String(req.body.notes || '').trim().slice(0, 2000);
    await request.save();
    await audit(req, 'purchase_request_draft_updated', request, { requestNumber: request.requestNumber });
    return res.json({ message: 'Draft updated.', request });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Update purchase draft failed:', error.message);
    return res.status(500).json({ message: 'Unable to update draft.' });
  }
};

export const submitPurchaseDraft = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Draft not found.' });
    if (request.requestedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You cannot submit this draft.' });
    }
    if (request.status !== 'DRAFT') return res.status(409).json({ message: 'Only draft requests can be submitted.' });

    request.items = await normalizeRequestedItems(request.items);
    request.status = 'PENDING_APPROVAL';
    await request.save();
    await audit(req, 'purchase_request_submitted', request, { requestNumber: request.requestNumber, status: request.status });
    await queueNotifications(request._id, [
      { channel: 'email', recipient: process.env.ADMIN_EMAIL || 'not-configured' },
    ]);
    return res.json({ message: 'Purchase request submitted successfully.', request });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Submit purchase draft failed:', error.message);
    return res.status(500).json({ message: 'Unable to submit draft.' });
  }
};

export const approveRequest = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (request.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ message: 'Only pending requests can be approved.' });
    }

    request.status = 'APPROVED';
    request.approvedBy = req.user.id;
    request.approvedAt = new Date();
    const previousValue = { status: 'PENDING_APPROVAL' };
    await request.save();
    await audit(req, 'purchase_request_approved', request, { status: request.status }, previousValue);
    await notifyRequester(request, 'request_approved');

    return res.json({ message: 'Request approved.', request });
  } catch (error) {
    console.error('Approve request failed:', error.message);
    return res.status(500).json({ message: 'Unable to approve request.' });
  }
};

export const rejectRequest = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const rejectionReason = String(req.body.rejectionReason || '').trim();
    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (request.status !== 'PENDING_APPROVAL') {
      return res.status(409).json({ message: 'Only pending requests can be rejected.' });
    }
    if (!rejectionReason) return res.status(400).json({ message: 'A rejection reason is required.' });

    request.status = 'REJECTED';
    request.rejectedBy = req.user.id;
    request.rejectedAt = new Date();
    request.rejectionReason = rejectionReason.slice(0, 1000);
    await request.save();
    await audit(req, 'purchase_request_rejected', request, { rejectionReason: request.rejectionReason });

    await notifyRequester(request, 'request_rejected');
    return res.json({ message: 'Request rejected.', request });
  } catch (error) {
    console.error('Reject request failed:', error.message);
    return res.status(500).json({ message: 'Unable to reject request.' });
  }
};

export const updatePurchaseProgress = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const { itemUpdates } = req.body;
    if (!Array.isArray(itemUpdates) || itemUpdates.length === 0) {
      return res.status(400).json({ message: 'Provide purchasing quantities for at least one item.' });
    }

    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!['APPROVED', 'PARTIALLY_PURCHASED'].includes(request.status)) {
      return res.status(409).json({ message: 'Purchasing progress can only be recorded for approved requests.' });
    }

    for (const update of itemUpdates) {
      if (!update || !validId(update.itemId) || !Number.isFinite(Number(update.quantityPurchased)) || Number(update.quantityPurchased) < 0) {
        return res.status(400).json({ message: 'Each progress entry needs an item ID and a non-negative purchased quantity.' });
      }
      const line = request.items.find((item) => item.itemId.toString() === update.itemId);
      if (!line) return res.status(400).json({ message: 'An updated item does not belong to this request.' });
      if (Number(update.quantityPurchased) > line.quantityRequested) {
        return res.status(400).json({ message: `Purchased quantity for ${line.itemNameSnapshot} cannot exceed the requested quantity.` });
      }
      line.quantityPurchased = Number(update.quantityPurchased);
    }

    const allCompleted = request.items.every((item) => item.quantityPurchased >= item.quantityRequested);
    request.status = allCompleted ? 'PURCHASED' : (
      request.items.some((item) => item.quantityPurchased > 0) ? 'PARTIALLY_PURCHASED' : 'APPROVED'
    );
    request.purchasedAt = allCompleted ? new Date() : undefined;
    await request.save();
    await audit(req, 'purchase_progress_updated', request, {
      status: request.status,
      items: request.items.map(({ itemNameSnapshot, quantityRequested, quantityPurchased }) => ({
        itemNameSnapshot,
        quantityRequested,
        quantityPurchased,
      })),
    });
    return res.json({ message: 'Purchase progress updated.', request });
  } catch (error) {
    console.error('Update purchase progress failed:', error.message);
    return res.status(500).json({ message: 'Unable to update purchase progress.' });
  }
};

export const addRequestComment = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request ID.' });
    const text = String(req.body.text || '').trim();
    if (!text || text.length > 2000) {
      return res.status(400).json({ message: 'Comment must contain between 1 and 2000 characters.' });
    }

    const request = await PurchaseRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!isAdmin(req.user) && request.requestedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You cannot comment on this request.' });
    }
    request.comments.push({ userId: req.user.id, text });
    await request.save();
    await audit(req, 'purchase_request_comment_added', request, { text });
    await request.populate('comments.userId', 'fullName role');
    return res.status(201).json({ message: 'Comment added.', comments: request.comments });
  } catch (error) {
    console.error('Add request comment failed:', error.message);
    return res.status(500).json({ message: 'Unable to add comment.' });
  }
};
