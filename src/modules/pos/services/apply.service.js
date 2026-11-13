const Record = require('../models/Record');
const Journal = require('../models/Journal');
const { nextRev } = require('./rev.service');
const {
  RECORD_KINDS,
  isValidRecord,
  recordIdFor,
  dayFor,
} = require('./validate.service');

const winsAgainst = (kind, incoming, current) => {
  if (!current) return true;
  if (kind === 'voided') return false;

  const nextU = Number(incoming.u || 0);
  const curU = Number(current.u || 0);

  if (nextU > curU) return true;
  if (nextU < curU) return false;

  const curPay = current.data?.payment || 'Unpaid';
  const nextPay = incoming.payment || 'Unpaid';
  if (curPay === 'Unpaid' && nextPay !== 'Unpaid') return true;

  const nextDeleted = String(incoming.deleted || '') === 'true';
  const curDeleted = String(current.data?.deleted || '') === 'true';
  if (nextDeleted && !curDeleted) return true;

  return false;
};

/**
 * Core LWW apply — Mongo rewrite of pos.apply (outlet-scoped).
 * Staff refuse/approve matrix will layer on later; base sync must work offline-first.
 */
const applyChanges = async ({ changes, label, role, outlet }) => {
  const mine = [];
  const back = [];
  let skipped = 0;
  let seen = 0;

  const payload = changes && typeof changes === 'object' ? changes : {};

  for (const kind of RECORD_KINDS) {
    const list = Array.isArray(payload[kind]) ? payload[kind] : [];

    for (const raw of list) {
      seen += 1;
      if (seen > 600) break;

      if (!isValidRecord(kind, raw)) {
        skipped += 1;
        continue;
      }

      // feed is server-only in original design — devices cannot upload it
      if (kind === 'feed') {
        skipped += 1;
        continue;
      }

      const id = recordIdFor(kind, raw);
      const u = Number(raw.u || 0);
      const day = dayFor(kind, raw);

      if (kind === 'orders') {
        const voided = await Record.findOne({ outlet, kind: 'voided', id }).lean();
        if (voided) {
          back.push(voided.rev);
          continue;
        }
      }

      const current = await Record.findOne({ outlet, kind, id }).lean();
      const wins = winsAgainst(kind, raw, current);

      if (!wins) {
        if (current) back.push(current.rev);
        continue;
      }

      const rev = await nextRev();

      await Journal.create({
        rev,
        outlet,
        device: label,
        role,
        kind,
        id,
        u,
        data: raw,
      });

      await Record.findOneAndUpdate(
        { outlet, kind, id },
        {
          $set: {
            outlet,
            kind,
            id,
            u,
            day,
            data: raw,
            rev,
            device: label,
          },
        },
        { upsert: true, new: true }
      );

      mine.push(rev);
    }
  }

  return { mine, back, skipped };
};

module.exports = {
  applyChanges,
  winsAgainst,
};
