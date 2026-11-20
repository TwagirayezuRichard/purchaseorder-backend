import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memoryServer;
let server;
let baseUrl;
let adminCookie;
let employeeCookie;
let itemId;
let firstRequestId;

const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, data };
};

before(async () => {
  memoryServer = await MongoMemoryServer.create();
  process.env.MONGO_URI = memoryServer.getUri('rpms-tests');
  process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
  process.env.INITIAL_ADMIN_EMAIL = 'admin@test.local';
  process.env.INITIAL_ADMIN_NAME = 'Test Administrator';
  process.env.INITIAL_ADMIN_PASSWORD = 'temporary-password-for-testing';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.ADMIN_EMAIL = '';

  const [{ default: app }, { connectDatabase }, { seedDatabase }] = await Promise.all([
    import('../src/app.js'),
    import('../src/config/db.js'),
    import('../src/utils/seed.js'),
  ]);
  await connectDatabase();
  await seedDatabase();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

test('authentication, role authorization, requests, approvals, and purchase progress', async () => {
  const health = await request('/health');
  assert.equal(health.response.status, 200);

  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.local', password: 'temporary-password-for-testing' },
  });
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.data.token);
  adminCookie = adminLogin.response.headers.get('set-cookie').split(';')[0];

  const bearerSession = await request('/auth/me', {
    headers: { Authorization: `Bearer ${adminLogin.data.token}` },
  });
  assert.equal(bearerSession.response.status, 200);
  assert.equal(bearerSession.data.email, 'admin@test.local');

  const categories = await request('/categories', { cookie: adminCookie });
  assert.equal(categories.response.status, 200);
  assert.ok(categories.data.length > 0);

  const items = await request('/items', { cookie: adminCookie });
  itemId = items.data.find((item) => item.name === 'Rice')._id;

  const employeeCreate = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      fullName: 'Kitchen Worker',
      email: 'ikafehouse@gmail.com',
      password: 'long-temporary-password',
      role: 'kitchen_manager',
    },
  });
  assert.equal(employeeCreate.response.status, 201);

  const employeeLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'ikafehouse@gmail.com', password: 'long-temporary-password' },
  });
  assert.equal(employeeLogin.response.status, 200);
  employeeCookie = employeeLogin.response.headers.get('set-cookie').split(';')[0];

  const forbiddenUsers = await request('/users', { cookie: employeeCookie });
  assert.equal(forbiddenUsers.response.status, 403);

  const csrfRejected = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(csrfRejected.response.status, 403);

  const stockCreate = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      fullName: 'Stock Worker',
      email: 'stock@test.local',
      password: 'another-temporary-password',
      role: 'stock_manager',
    },
  });
  assert.equal(stockCreate.response.status, 201);
  const stockLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'stock@test.local', password: 'another-temporary-password' },
  });
  const stockCookie = stockLogin.response.headers.get('set-cookie').split(';')[0];

  const idempotencyKey = 'test-request-once-1';
  const requestBody = { items: [{ itemId, quantityRequested: 12 }], notes: 'Test request' };
  const submitted = await request('/purchase-requests', {
    method: 'POST',
    cookie: employeeCookie,
    body: requestBody,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(submitted.response.status, 201);
  firstRequestId = submitted.data.request._id;
  assert.match(submitted.data.request.requestNumber, /^PR-\d{4}-\d{4}$/);
  const { default: Notification } = await import('../src/models/Notification.js');
  const submittedNotifications = await Notification.find({ purchaseRequestId: firstRequestId });
  assert.ok(submittedNotifications.length > 0);
  assert.ok(submittedNotifications.every((notification) => notification.channel === 'email'));

  const foreignRequest = await request(`/purchase-requests/${firstRequestId}`, { cookie: stockCookie });
  assert.equal(foreignRequest.response.status, 403);

  const duplicate = await request('/purchase-requests', {
    method: 'POST',
    cookie: employeeCookie,
    body: requestBody,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.data.request._id, firstRequestId);

  const emptyRequest = await request('/purchase-requests', {
    method: 'POST',
    cookie: employeeCookie,
    body: { items: [] },
  });
  assert.equal(emptyRequest.response.status, 400);

  const approvedByEmployee = await request(`/purchase-requests/${firstRequestId}/approve`, {
    method: 'PATCH',
    cookie: employeeCookie,
  });
  assert.equal(approvedByEmployee.response.status, 403);

  const approved = await request(`/purchase-requests/${firstRequestId}/approve`, {
    method: 'PATCH',
    cookie: adminCookie,
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.request.status, 'APPROVED');

  const partial = await request(`/purchase-requests/${firstRequestId}/purchase-progress`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { itemUpdates: [{ itemId, quantityPurchased: 7 }] },
  });
  assert.equal(partial.response.status, 200);
  assert.equal(partial.data.request.status, 'PARTIALLY_PURCHASED');

  const excessive = await request(`/purchase-requests/${firstRequestId}/purchase-progress`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { itemUpdates: [{ itemId, quantityPurchased: 13 }] },
  });
  assert.equal(excessive.response.status, 400);

  const completed = await request(`/purchase-requests/${firstRequestId}/purchase-progress`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { itemUpdates: [{ itemId, quantityPurchased: 12 }] },
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.data.request.status, 'PURCHASED');

  const employeeRequests = await request('/purchase-requests/my-requests', { cookie: employeeCookie });
  assert.equal(employeeRequests.response.status, 200);
  assert.equal(employeeRequests.data.length, 1);

  const comment = await request(`/purchase-requests/${firstRequestId}/comments`, {
    method: 'POST',
    cookie: employeeCookie,
    body: { text: 'Please purchase this item this week.' },
  });
  assert.equal(comment.response.status, 201);

  const draft = await request('/purchase-requests', {
    method: 'POST',
    cookie: employeeCookie,
    body: { ...requestBody, saveAsDraft: true },
    headers: { 'Idempotency-Key': 'test-draft-key' },
  });
  assert.equal(draft.response.status, 201);
  assert.equal(draft.data.request.status, 'DRAFT');

  const updatedDraft = await request(`/purchase-requests/${draft.data.request._id}/draft`, {
    method: 'PUT',
    cookie: employeeCookie,
    body: { items: [{ itemId, quantityRequested: 15 }], notes: 'Updated draft' },
  });
  assert.equal(updatedDraft.response.status, 200);
  assert.equal(updatedDraft.data.request.items[0].quantityRequested, 15);

  const submittedDraft = await request(`/purchase-requests/${draft.data.request._id}/submit`, {
    method: 'POST',
    cookie: employeeCookie,
  });
  assert.equal(submittedDraft.response.status, 200);
  assert.equal(submittedDraft.data.request.status, 'PENDING_APPROVAL');

  const secondRequest = await request('/purchase-requests', {
    method: 'POST',
    cookie: employeeCookie,
    body: requestBody,
    headers: { 'Idempotency-Key': 'test-request-once-2' },
  });
  assert.equal(secondRequest.response.status, 201);

  const rejectWithoutReason = await request(`/purchase-requests/${secondRequest.data.request._id}/reject`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(rejectWithoutReason.response.status, 400);

  const rejected = await request(`/purchase-requests/${secondRequest.data.request._id}/reject`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { rejectionReason: 'Test rejection reason' },
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.data.request.status, 'REJECTED');

  const list = await request('/purchase-requests', { cookie: adminCookie });
  assert.equal(list.response.status, 200);
  assert.equal(list.data.total, 3);

  const report = await request('/reports/dashboard', { cookie: adminCookie });
  assert.equal(report.response.status, 200);
  assert.equal(report.data.stats.totalRequests, 3);

  const csv = await request('/reports/export/csv', { cookie: adminCookie });
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get('content-type'), /text\/csv/);

  const pdf = await request('/reports/export/pdf', { cookie: adminCookie });
  assert.equal(pdf.response.status, 200);
  assert.match(pdf.response.headers.get('content-type'), /application\/pdf/);

  const settings = await request('/settings/notifications', { cookie: adminCookie });
  assert.equal(settings.response.status, 200);
  assert.equal(Object.hasOwn(settings.data, 'whatsappConfigured'), false);
});

test('notification settings require authorized SMTP credentials', async () => {
  const previous = {
    SMTP_USER: process.env.SMTP_USER,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };
  Object.assign(process.env, {
    SMTP_USER: 'sender@test.local',
    EMAIL_FROM: 'sender@test.local',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PASSWORD: 'test-app-password',
  });

  try {
    const settings = await request('/settings/notifications', { cookie: adminCookie });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.data.emailConfigured, true);
    process.env.SMTP_PASSWORD = '';
    const withoutPassword = await request('/settings/notifications', { cookie: adminCookie });
    assert.equal(withoutPassword.data.emailConfigured, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
