/**
 * Inventory — daily stock ledger.
 *
 * Every change to stock is a movement row (in / out / adjust) stamped with a
 * business day (Asia/Karachi). The item's `stock` field is the live balance and
 * is only ever changed atomically together with a movement, so:
 *
 *   opening(day)  = sum(delta of movements before day)
 *   closing(day)  = opening + received - used + adjusted
 *   closing(today) == item.stock
 *
 * All functions take the till's device token (p.token) and return
 * { ok: true, ... } or { ok: false, error } like the other POS RPCs.
 */
const mongoose = require('mongoose');
const InventoryItem = require('./models/InventoryItem');
const InventoryMovement = require('./models/InventoryMovement');
const { findActiveDevice } = require('../pos/services/auth.service');
const { toLocalDateString } = require('../hr/utils/time');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_DAYS = 92;

const today = () => toLocalDateString(new Date(), 'Asia/Karachi');
const round = (n) => Math.round(Number(n) * 1000) / 1000;
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const isId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const itemShape = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  unit: doc.unit,
  category: doc.category,
  stock: round(doc.stock),
  lowStockAt: doc.lowStockAt,
  low: doc.lowStockAt > 0 && doc.stock <= doc.lowStockAt,
  active: doc.active !== false,
});

const movementShape = (doc) => ({
  id: String(doc._id),
  itemId: String(doc.item),
  itemName: doc.itemName,
  unit: doc.unit,
  type: doc.type,
  qty: round(doc.qty),
  delta: round(doc.delta),
  balanceAfter: round(doc.balanceAfter),
  day: doc.day,
  note: doc.note,
  by: doc.by,
  at: doc.createdAt,
});

/** Resolve the device behind p.token. */
const withDevice = async (p, { ownerOnly = false } = {}) => {
  const device = await findActiveDevice(p?.token);
  if (!device) return { err: fail('auth') };
  if (ownerOnly && device.role !== 'owner') return { err: fail('owner_only') };
  return { device };
};

const byLabel = (device) => `${device.role}${device.label ? ` · ${device.label}` : ''}`;

// ─── Items ──────────────────────────────────────────────────────────────────

const listItems = async (p = {}) => {
  const { device, err } = await withDevice(p);
  if (err) return err;

  const filter = { outlet: device.outlet };
  if (p.includeInactive !== true) filter.active = true;

  const items = await InventoryItem.find(filter).sort({ category: 1, name: 1 }).lean();
  return { ok: true, day: today(), items: items.map(itemShape) };
};

/** Create (no id) or update (id) an item. Owner only. Stock is never set here. */
const saveItem = async (p = {}) => {
  const { device, err } = await withDevice(p, { ownerOnly: true });
  if (err) return err;

  const name = String(p.name || '').trim();
  if (!name) return fail('bad_request', { message: 'name is required' });

  const fields = {
    name,
    unit: String(p.unit || 'pcs').trim() || 'pcs',
    category: String(p.category || 'General').trim() || 'General',
    lowStockAt: Math.max(0, Number(p.lowStockAt) || 0),
  };
  if (typeof p.active === 'boolean') fields.active = p.active;

  try {
    let item;
    if (p.id) {
      if (!isId(p.id)) return fail('not_found');
      item = await InventoryItem.findOneAndUpdate(
        { _id: p.id, outlet: device.outlet },
        { $set: fields },
        { new: true }
      );
      if (!item) return fail('not_found');
    } else {
      item = await InventoryItem.create({ outlet: device.outlet, ...fields, stock: 0 });

      // Optional opening stock when creating the item.
      const opening = round(p.openingStock || 0);
      if (opening > 0) {
        const res = await recordMovement(device, item._id, {
          type: 'in',
          qty: opening,
          note: 'Opening stock',
        });
        if (!res.ok) return res;
        item = await InventoryItem.findById(item._id);
      }
    }
    return { ok: true, item: itemShape(item) };
  } catch (e) {
    if (e.code === 11000) return fail('duplicate', { message: 'An item with this name already exists' });
    throw e;
  }
};

/** Soft delete (hide) an item; its history is kept. Owner only. */
const deleteItem = async (p = {}) => {
  const { device, err } = await withDevice(p, { ownerOnly: true });
  if (err) return err;
  if (!isId(p.id)) return fail('not_found');

  const item = await InventoryItem.findOneAndUpdate(
    { _id: p.id, outlet: device.outlet },
    { $set: { active: false } },
    { new: true }
  );
  if (!item) return fail('not_found');
  return { ok: true, item: itemShape(item) };
};

// ─── Movements ──────────────────────────────────────────────────────────────

/**
 * Core ledger write: atomically update item.stock and insert the movement.
 * `out` is rejected if it would make stock negative.
 */
const recordMovement = async (device, itemId, { type, qty, count, note = '', day }) => {
  const outlet = device.outlet;
  const base = { _id: itemId, outlet, active: true };
  let item;
  let delta;

  if (type === 'in' || type === 'out') {
    delta = type === 'in' ? qty : -qty;
    const filter = type === 'out' ? { ...base, stock: { $gte: qty } } : base;
    item = await InventoryItem.findOneAndUpdate(filter, { $inc: { stock: delta } }, { new: true });
    if (!item) {
      const exists = await InventoryItem.findOne(base).lean();
      if (!exists) return fail('not_found');
      return fail('insufficient_stock', {
        message: `Only ${round(exists.stock)} ${exists.unit} of ${exists.name} in stock`,
        stock: round(exists.stock),
      });
    }
  } else {
    // adjust: set stock to the physically counted value (compare-and-set, retry on race)
    for (let attempt = 0; attempt < 5 && !item; attempt += 1) {
      const current = await InventoryItem.findOne(base).lean();
      if (!current) return fail('not_found');
      delta = round(count - current.stock);
      item = await InventoryItem.findOneAndUpdate(
        { ...base, stock: current.stock },
        { $set: { stock: count } },
        { new: true }
      );
    }
    if (!item) return fail('busy');
  }

  item.stock = round(item.stock);
  const movement = await InventoryMovement.create({
    outlet,
    item: item._id,
    itemName: item.name,
    unit: item.unit,
    type,
    qty: type === 'adjust' ? Math.abs(delta) : qty,
    delta: round(delta),
    balanceAfter: item.stock,
    day: day || today(),
    note: String(note || '').slice(0, 200),
    by: byLabel(device),
  });

  return { ok: true, movement: movementShape(movement), item: itemShape(item) };
};

/**
 * p: { token, itemId, type: 'in'|'out'|'adjust', qty, count, note, day? }
 *  - in/out need qty > 0
 *  - adjust needs count >= 0 (owner only)
 *  - day defaults to today; backdating is owner only; future days rejected
 */
const addMovement = async (p = {}) => {
  const { device, err } = await withDevice(p);
  if (err) return err;

  const type = String(p.type || '');
  if (!['in', 'out', 'adjust'].includes(type)) return fail('bad_request', { message: 'type must be in, out or adjust' });
  if (!isId(p.itemId)) return fail('not_found');

  const t = today();
  const day = p.day ? String(p.day) : t;
  if (!DAY_RE.test(day) || day > t) return fail('bad_day');
  if (day !== t && device.role !== 'owner') return fail('owner_only', { message: 'Only owner can record past days' });

  if (type === 'adjust') {
    if (device.role !== 'owner') return fail('owner_only');
    const count = round(p.count);
    if (!Number.isFinite(count) || count < 0) return fail('bad_request', { message: 'count must be 0 or more' });
    return recordMovement(device, p.itemId, { type, count, note: p.note, day });
  }

  const qty = round(p.qty);
  if (!Number.isFinite(qty) || qty <= 0) return fail('bad_request', { message: 'qty must be greater than 0' });
  return recordMovement(device, p.itemId, { type, qty, note: p.note, day });
};

/**
 * Bulk entry — e.g. a whole delivery or end-of-day usage sheet.
 * p: { token, type: 'in'|'out', day?, note?, lines: [{ itemId, qty, note? }] }
 * Lines are applied one by one; result lists successes and failures.
 */
const addMovementsBulk = async (p = {}) => {
  const { err } = await withDevice(p);
  if (err) return err;
  if (!Array.isArray(p.lines) || !p.lines.length) return fail('bad_request', { message: 'lines required' });
  if (p.lines.length > 100) return fail('bad_request', { message: 'max 100 lines' });

  const results = [];
  for (const line of p.lines) {
    // eslint-disable-next-line no-await-in-loop
    const r = await addMovement({
      token: p.token,
      type: p.type,
      day: p.day,
      itemId: line.itemId,
      qty: line.qty,
      count: line.count,
      note: line.note || p.note,
    });
    results.push({ itemId: line.itemId, ...r });
  }
  return {
    ok: results.every((r) => r.ok),
    results,
  };
};

/** Undo a movement (reverses its delta). Owner any day; barista only today's. */
const deleteMovement = async (p = {}) => {
  const { device, err } = await withDevice(p);
  if (err) return err;
  if (!isId(p.id)) return fail('not_found');

  const mv = await InventoryMovement.findOne({ _id: p.id, outlet: device.outlet });
  if (!mv) return fail('not_found');
  if (device.role !== 'owner' && (mv.day !== today() || mv.type === 'adjust')) {
    return fail('owner_only');
  }

  const reverse = -mv.delta;
  const filter = { _id: mv.item, outlet: device.outlet };
  if (reverse < 0) filter.stock = { $gte: -reverse };
  const item = await InventoryItem.findOneAndUpdate(filter, { $inc: { stock: reverse } }, { new: true });
  if (!item) {
    return fail('insufficient_stock', { message: 'Undoing this would make stock negative' });
  }
  await mv.deleteOne();
  return { ok: true, item: itemShape(item) };
};

// ─── Reports ────────────────────────────────────────────────────────────────

/**
 * Day sheet: per item opening / received / used / adjusted / closing,
 * plus the day's movement list.  p: { token, day? }
 */
const daySummary = async (p = {}) => {
  const { device, err } = await withDevice(p);
  if (err) return err;

  const day = p.day ? String(p.day) : today();
  if (!DAY_RE.test(day)) return fail('bad_day');
  const outlet = device.outlet;

  const [items, before, during, movements] = await Promise.all([
    InventoryItem.find({ outlet }).sort({ category: 1, name: 1 }).lean(),
    InventoryMovement.aggregate([
      { $match: { outlet, day: { $lt: day } } },
      { $group: { _id: '$item', opening: { $sum: '$delta' } } },
    ]),
    InventoryMovement.aggregate([
      { $match: { outlet, day } },
      {
        $group: {
          _id: '$item',
          received: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$qty', 0] } },
          used: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$qty', 0] } },
          adjusted: { $sum: { $cond: [{ $eq: ['$type', 'adjust'] }, '$delta', 0] } },
        },
      },
    ]),
    InventoryMovement.find({ outlet, day }).sort({ createdAt: -1 }).lean(),
  ]);

  const openMap = new Map(before.map((r) => [String(r._id), r.opening]));
  const dayMap = new Map(during.map((r) => [String(r._id), r]));

  const rows = items
    .filter((it) => it.active || openMap.has(String(it._id)) || dayMap.has(String(it._id)))
    .map((it) => {
      const id = String(it._id);
      const opening = round(openMap.get(id) || 0);
      const d = dayMap.get(id) || { received: 0, used: 0, adjusted: 0 };
      const closing = round(opening + d.received - d.used + d.adjusted);
      return {
        ...itemShape(it),
        opening,
        received: round(d.received),
        used: round(d.used),
        adjusted: round(d.adjusted),
        closing,
        low: it.lowStockAt > 0 && closing <= it.lowStockAt,
      };
    });

  return {
    ok: true,
    day,
    isToday: day === today(),
    items: rows,
    movements: movements.map(movementShape),
  };
};

/**
 * Daily totals over a range (for a history view).
 * p: { token, from?, to?, itemId? } — defaults to last 7 days, max 92 days.
 */
const history = async (p = {}) => {
  const { device, err } = await withDevice(p);
  if (err) return err;

  const to = p.to ? String(p.to) : today();
  const from = p.from ? String(p.from) : addDays(to, -6);
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) return fail('bad_day');
  if (addDays(from, MAX_HISTORY_DAYS) < to) return fail('bad_request', { message: `max ${MAX_HISTORY_DAYS} days` });

  const match = { outlet: device.outlet, day: { $gte: from, $lte: to } };
  if (p.itemId) {
    if (!isId(p.itemId)) return fail('not_found');
    match.item = new mongoose.Types.ObjectId(String(p.itemId));
  }

  const rows = await InventoryMovement.aggregate([
    { $match: match },
    {
      $group: {
        _id: { day: '$day', item: '$item' },
        itemName: { $last: '$itemName' },
        unit: { $last: '$unit' },
        received: { $sum: { $cond: [{ $eq: ['$type', 'in'] }, '$qty', 0] } },
        used: { $sum: { $cond: [{ $eq: ['$type', 'out'] }, '$qty', 0] } },
        adjusted: { $sum: { $cond: [{ $eq: ['$type', 'adjust'] }, '$delta', 0] } },
      },
    },
    { $sort: { '_id.day': -1, itemName: 1 } },
  ]);

  const days = {};
  for (const r of rows) {
    const key = r._id.day;
    days[key] = days[key] || [];
    days[key].push({
      itemId: String(r._id.item),
      itemName: r.itemName,
      unit: r.unit,
      received: round(r.received),
      used: round(r.used),
      adjusted: round(r.adjusted),
    });
  }

  return {
    ok: true,
    from,
    to,
    days: Object.keys(days)
      .sort()
      .reverse()
      .map((day) => ({ day, items: days[day] })),
  };
};

module.exports = {
  listItems,
  saveItem,
  deleteItem,
  addMovement,
  addMovementsBulk,
  deleteMovement,
  daySummary,
  history,
};
