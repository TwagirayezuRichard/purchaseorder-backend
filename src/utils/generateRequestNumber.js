import Counter from '../models/Counter.js';

export default async function generateRequestNumber() {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `purchase-request-${year}` },
    { $inc: { sequence: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return `PR-${year}-${String(counter.sequence).padStart(4, '0')}`;
}
