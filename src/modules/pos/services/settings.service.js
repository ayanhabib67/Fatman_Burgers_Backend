const Setting = require('../models/Setting');
const { authKey, seqKey, isOutletOk } = require('../../../shared/utils/outlet');
const { randomSalt } = require('../../../shared/utils/crypto');

const getSetting = async (key) => {
  const row = await Setting.findOne({ key }).lean();
  return row ? row.value : null;
};

const setSetting = async (key, value) => {
  await Setting.findOneAndUpdate(
    { key },
    { $set: { value } },
    { upsert: true, new: true }
  );
  return value;
};

const ensureOutlet = async (outlet) => {
  if (!isOutletOk(outlet)) {
    throw new Error('outlet must be 2 to 20 characters: lowercase letters, digits, - or _');
  }

  const auth = authKey(outlet);
  const seq = seqKey(outlet);

  await Setting.updateOne(
    { key: auth },
    {
      $setOnInsert: {
        key: auth,
        value: {
          salt: randomSalt(),
          pins: {},
          pv: { barista: 0, owner: 0 },
          fail: {},
        },
      },
    },
    { upsert: true }
  );

  await Setting.updateOne(
    { key: seq },
    { $setOnInsert: { key: seq, value: 0 } },
    { upsert: true }
  );

  await Setting.updateOne(
    { key: 'epoch' },
    { $setOnInsert: { key: 'epoch', value: randomSalt().slice(0, 32) } },
    { upsert: true }
  );
};

const getAuth = async (outlet) => getSetting(authKey(outlet));

const saveAuth = async (outlet, value) => setSetting(authKey(outlet), value);

const getSeq = async (outlet) => {
  const value = await getSetting(seqKey(outlet));
  return Number(value || 0);
};

const bumpSeq = async (outlet, clientSeq) => {
  const key = seqKey(outlet);
  const current = await getSeq(outlet);
  const next = Math.max(current, Number(clientSeq || 0));
  await setSetting(key, next);
  return next;
};

const getEpoch = async () => {
  const value = await getSetting('epoch');
  return value == null ? null : String(value);
};

module.exports = {
  getSetting,
  setSetting,
  ensureOutlet,
  getAuth,
  saveAuth,
  getSeq,
  bumpSeq,
  getEpoch,
};
