const Record = require('../models/Record');
const Device = require('../models/Device');
const { applyChanges } = require('./apply.service');
const { bumpSeq, getAuth, getEpoch } = require('./settings.service');
const { findActiveDevice } = require('./auth.service');
const { withOutletLock } = require('../../../shared/utils/outletLock');

const PULL_LIMIT = 400;

const buildPullQuery = ({ outlet, cursor, minDay, mine, back }) => {
  const branches = [];

  if (back.length) {
    branches.push({ rev: { $in: back } });
  }

  const since = {
    rev: { $gt: cursor },
  };
  if (mine.length) {
    since.rev = { $gt: cursor, $nin: mine };
  }

  if (cursor === 0 && minDay) {
    branches.push({
      ...since,
      $or: [
        { day: '' },
        { day: { $gte: minDay } },
        { kind: 'orders', 'data.payment': 'Unpaid' },
      ],
    });
  } else {
    branches.push(since);
  }

  return {
    outlet,
    $or: branches,
  };
};

const sync = async (p = {}) => {
  const device = await findActiveDevice(p.token);
  if (!device) {
    return { ok: false, error: 'auth' };
  }

  return withOutletLock(device.outlet, async () => {
    const { mine, back, skipped } = await applyChanges({
      changes: p.changes || {},
      label: device.label,
      role: device.role,
      outlet: device.outlet,
    });

    const seq = await bumpSeq(device.outlet, p.seq);

    let cursor = Math.max(Number(p.cursor || 0), 0);
    let reset = false;

    const headRow = await Record.findOne({ outlet: device.outlet })
      .sort({ rev: -1 })
      .select('rev')
      .lean();
    const head = headRow ? Number(headRow.rev) : 0;

    if (cursor > head) {
      cursor = 0;
      reset = true;
    }

    const minDay = String(p.minDay || '');
    const pullQuery = buildPullQuery({
      outlet: device.outlet,
      cursor,
      minDay,
      mine,
      back,
    });

    const candidates = await Record.find(pullQuery)
      .sort({ rev: 1 })
      .limit(PULL_LIMIT)
      .lean();

    const orderIds = candidates.filter((r) => r.kind === 'orders').map((r) => r.id);
    const voidIds = new Set(
      orderIds.length
        ? (
            await Record.find({
              outlet: device.outlet,
              kind: 'voided',
              id: { $in: orderIds },
            })
              .select('id')
              .lean()
          ).map((r) => r.id)
        : []
    );

    const backSet = new Set(back);
    const mineSet = new Set(mine);
    const rows = [];
    let last = cursor;

    for (const row of candidates) {
      if (row.kind === 'orders' && voidIds.has(row.id)) continue;
      if (mineSet.has(row.rev) && !backSet.has(row.rev)) continue;
      rows.push([row.kind, row.data]);
      last = Math.max(last, Number(row.rev));
    }

    const more = candidates.length >= PULL_LIMIT;
    const nextCursor = more ? Math.max(last, cursor) : head;

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (!device.lastSeen || device.lastSeen < tenMinAgo) {
      await Device.updateOne({ _id: device._id }, { $set: { lastSeen: new Date() } });
    }

    const auth = await getAuth(device.outlet);

    return {
      ok: true,
      rows,
      cursor: nextCursor,
      more,
      seq,
      pv: auth?.pv || { barista: 0, owner: 0 },
      role: device.role,
      outlet: device.outlet,
      epoch: await getEpoch(),
      reset,
      skipped,
      rejected: [],
      now: Date.now(),
    };
  });
};

module.exports = { sync };
