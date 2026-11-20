import mongoose from 'mongoose';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Notification from '../models/Notification.js';
import PDFDocument from 'pdfkit';

const requestFilters = (query) => {
  const filter = {};
  if (query.department && ['Kitchen', 'Stock'].includes(query.department)) filter.department = query.department;
  if (query.status && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_PURCHASED', 'PURCHASED'].includes(query.status)) {
    filter.status = query.status;
  }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) filter.createdAt.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) {
      const end = new Date(query.to);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  if (query.requestIds !== undefined) {
    const ids = String(query.requestIds).split(',').filter(mongoose.isValidObjectId);
    filter._id = { $in: ids };
  }
  return filter;
};

export const getDashboardStats = async (req, res) => {
  try {
    const [totalRequests, pending, approved, rejected, purchased, partiallyPurchased, totalLineItems, notificationFailures, recentRequests] = await Promise.all([
      PurchaseRequest.countDocuments(),
      PurchaseRequest.countDocuments({ status: 'PENDING_APPROVAL' }),
      PurchaseRequest.countDocuments({ status: 'APPROVED' }),
      PurchaseRequest.countDocuments({ status: 'REJECTED' }),
      PurchaseRequest.countDocuments({ status: 'PURCHASED' }),
      PurchaseRequest.countDocuments({ status: 'PARTIALLY_PURCHASED' }),
      PurchaseRequest.aggregate([{ $unwind: '$items' }, { $count: 'count' }]),
      Notification.countDocuments({ status: 'failed' }),
      PurchaseRequest.find().populate('requestedBy', 'fullName email').sort({ createdAt: -1 }).limit(8),
    ]);

    return res.json({
      stats: {
        totalRequests,
        pending,
        approved,
        rejected,
        purchased,
        partiallyPurchased,
        totalLineItems: totalLineItems[0]?.count || 0,
        notificationFailures,
      },
      recentRequests,
    });
  } catch (error) {
    console.error('Get dashboard stats failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch dashboard stats.' });
  }
};

export const getConsolidatedPurchaseList = async (req, res) => {
  try {
    const filter = requestFilters(req.query);
    filter.status = { $in: ['APPROVED', 'PARTIALLY_PURCHASED'] };
    const requests = await PurchaseRequest.find(filter).populate('requestedBy', 'fullName');
    const consolidated = new Map();

    for (const request of requests) {
      for (const item of request.items) {
        const remaining = Math.max(0, item.quantityRequested - item.quantityPurchased);
        if (!remaining) continue;

        const key = `${item.itemId.toString()}|${item.unitSnapshot}`;
        if (!consolidated.has(key)) {
          consolidated.set(key, {
            itemId: item.itemId.toString(),
            item: item.itemNameSnapshot,
            unit: item.unitSnapshot,
            totalQuantity: 0,
            requestBreakdown: [],
          });
        }
        const current = consolidated.get(key);
        current.totalQuantity += remaining;
        current.requestBreakdown.push({
          requestId: request._id,
          requestNumber: request.requestNumber,
          department: request.department,
          requestedBy: request.requestedBy?.fullName || 'Unknown',
          requestedQuantity: item.quantityRequested,
          purchasedQuantity: item.quantityPurchased,
          remainingQuantity: remaining,
        });
      }
    }

    return res.json([...consolidated.values()].sort((a, b) => a.item.localeCompare(b.item)));
  } catch (error) {
    console.error('Get consolidated purchase list failed:', error.message);
    return res.status(500).json({ message: 'Unable to consolidate purchase list.' });
  }
};

export const getReports = async (req, res) => {
  try {
    const baseFilter = requestFilters(req.query);
    const now = new Date();
    const dailyStart = new Date(now);
    dailyStart.setDate(now.getDate() - 6);
    dailyStart.setHours(0, 0, 0, 0);
    const dailyFilter = { ...baseFilter, createdAt: { $gte: dailyStart, $lte: now } };

    const [dailyRows, monthlyRows, departmentRows, statusRows, demandRows] = await Promise.all([
      PurchaseRequest.aggregate([
        { $match: dailyFilter },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      PurchaseRequest.aggregate([
        { $match: baseFilter },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: 12 },
      ]),
      PurchaseRequest.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ]),
      PurchaseRequest.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      PurchaseRequest.aggregate([
        { $match: baseFilter },
        { $unwind: '$items' },
        { $group: { _id: { itemId: '$items.itemId', name: '$items.itemNameSnapshot', unit: '$items.unitSnapshot' }, quantityRequested: { $sum: '$items.quantityRequested' }, quantityPurchased: { $sum: '$items.quantityPurchased' } } },
        { $sort: { quantityRequested: -1 } },
        { $limit: 20 },
      ]),
    ]);

    const dailyMap = new Map(dailyRows.map((row) => [row._id, row.count]));
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(dailyStart);
      date.setDate(dailyStart.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { date: key, count: dailyMap.get(key) || 0 };
    });

    return res.json({
      daily,
      monthly: monthlyRows.map((row) => ({ month: row._id, count: row.count })),
      departments: departmentRows.map((row) => ({ department: row._id, count: row.count })),
      statuses: statusRows.map((row) => ({ status: row._id, count: row.count })),
      itemDemand: demandRows.map((row) => ({
        itemId: row._id.itemId,
        item: row._id.name,
        unit: row._id.unit,
        quantityRequested: row.quantityRequested,
        quantityPurchased: row.quantityPurchased,
      })),
    });
  } catch (error) {
    console.error('Get reports failed:', error.message);
    return res.status(500).json({ message: 'Unable to generate reports.' });
  }
};

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const exportRequestsCsv = async (req, res) => {
  try {
    const requests = await PurchaseRequest.find(requestFilters(req.query))
      .populate('requestedBy', 'fullName email')
      .sort({ createdAt: -1 });
    const rows = [['Request Number', 'Requested By', 'Department', 'Status', 'Date', 'Item', 'Quantity Requested', 'Quantity Purchased', 'Unit', 'Notes']];

    for (const request of requests) {
      for (const item of request.items) {
        rows.push([
          request.requestNumber,
          request.requestedBy?.fullName || '',
          request.department,
          request.status,
          request.createdAt.toISOString(),
          item.itemNameSnapshot,
          item.quantityRequested,
          item.quantityPurchased,
          item.unitSnapshot,
          request.notes,
        ]);
      }
    }

    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="purchase-requests.csv"');
    return res.send(csv);
  } catch (error) {
    console.error('Export CSV failed:', error.message);
    return res.status(500).json({ message: 'Unable to export purchase requests.' });
  }
};

export const exportRequestsPdf = async (req, res) => {
  try {
    const requests = await PurchaseRequest.find(requestFilters(req.query))
      .populate('requestedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(500);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="purchase-requests.pdf"');
    const document = new PDFDocument({ margin: 48, size: 'A4' });
    document.pipe(res);
    document.fontSize(20).fillColor('#0f172a').text('Restaurant Purchase Requests', { align: 'left' });
    document.moveDown(0.5).fontSize(9).fillColor('#64748b').text(`Generated ${new Date().toLocaleString()}`);
    document.moveDown();

    for (const request of requests) {
      if (document.y > 690) document.addPage();
      document.fontSize(12).fillColor('#0f172a').text(`${request.requestNumber}  |  ${request.status}`);
      document.fontSize(9).fillColor('#475569')
        .text(`${request.department} | ${request.requestedBy?.fullName || 'Unknown'} | ${request.createdAt.toLocaleDateString()}`);
      for (const item of request.items) {
        document.text(`• ${item.itemNameSnapshot} — ${item.quantityRequested} ${item.unitSnapshot} (purchased ${item.quantityPurchased})`, { indent: 12 });
      }
      if (request.notes) document.text(`Notes: ${request.notes}`, { indent: 12 });
      document.moveDown(0.7);
    }

    document.end();
  } catch (error) {
    console.error('Export PDF failed:', error.message);
    if (!res.headersSent) return res.status(500).json({ message: 'Unable to export purchase requests.' });
    return res.end();
  }
};
