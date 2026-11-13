const Device = require('../models/Device');
const {
  ensureOutlet,
  getAuth,
  saveAuth,
  getEpoch,
} = require('./settings.service');
const { sha, randomToken, pinHash } = require('../../../shared/utils/crypto');
const { normalizeOutlet, isOutletOk } = require('../../../shared/utils/outlet');

const nowMs = () => Date.now();

const ping = async () => {
  const Setting = require('../models/Setting');
  const authRows = await Setting.find({
    $or: [{ key: 'auth' }, { key: { $regex: /^auth:/ } }],
  }).lean();

  const outlets = {};
  for (const row of authRows) {
    const outlet =
      row.key === 'auth' ? 'whipped' : String(row.key).replace(/^auth:/, '');
    const pins = row.value?.pins || {};
    outlets[outlet] = Boolean(pins.barista && pins.owner);
  }

  const fatmanReady = Boolean(outlets.fatman);
  const whippedReady = Boolean(outlets.whipped);

  return {
    ok: true,
    app: 'fatman-burgers-pos',
    v: 3,
    ready: whippedReady,
    outlets,
    fatmanReady,
    epoch: await getEpoch(),
  };
};

const setPin = async ({ outlet, role, pin, signOut = false }) => {
  const shop = normalizeOutlet(outlet, 'fatman');
  if (!['barista', 'owner'].includes(role)) {
    throw new Error('role must be barista or owner');
  }
  if (!/^[0-9]{4}$/.test(String(pin || ''))) {
    throw new Error('the PIN must be exactly 4 digits');
  }

  await ensureOutlet(shop);
  const auth = await getAuth(shop);
  auth.pins = auth.pins || {};
  auth.pv = auth.pv || { barista: 0, owner: 0 };
  auth.fail = auth.fail || {};

  auth.pins[role] = pinHash(auth.salt, role, pin);
  auth.pv[role] = Number(auth.pv[role] || 0) + 1;
  delete auth.fail[role];

  await saveAuth(shop, auth);
  await Device.updateMany(
    { outlet: shop, role },
    { $set: { fails: 0, lockedUntil: null } }
  );

  if (signOut) {
    await Device.updateMany(
      { outlet: shop, role, revoked: false },
      { $set: { revoked: true } }
    );
  }

  return `${shop} ${role} PIN saved`;
};

const login = async (p = {}) => {
  const role = p.role === 'owner' ? 'owner' : 'barista';
  const outlet = normalizeOutlet(p.outlet, 'fatman');
  if (!isOutletOk(outlet)) {
    return { ok: false, error: 'bad_request' };
  }

  await ensureOutlet(outlet);
  const auth = await getAuth(outlet);

  if (!auth?.pins?.[role]) {
    return { ok: false, error: 'not_set_up' };
  }

  const pinOk = pinHash(auth.salt, role, p.pin || '') === auth.pins[role];
  const now = nowMs();

  if (p.token) {
    const tokenHash = sha(p.token);
    const device = await Device.findOne({
      tokenHash,
      revoked: false,
      role,
      outlet,
    });

    if (device) {
      if (device.lockedUntil && device.lockedUntil.getTime() > now) {
        return {
          ok: false,
          error: 'locked',
          wait: Math.ceil((device.lockedUntil.getTime() - now) / 1000),
        };
      }

      if (pinOk) {
        device.fails = 0;
        device.lockedUntil = null;
        device.lastSeen = new Date();
        await device.save();
        return {
          ok: true,
          token: p.token,
          role,
          outlet,
          pv: auth.pv,
          v: 3,
        };
      }

      const fails = device.fails + 1;
      const mins = fails >= 5 ? Math.min(15, 2 ** Math.min(fails - 4, 4)) : 0;
      device.fails = fails;
      device.lockedUntil = mins > 0 ? new Date(now + mins * 60 * 1000) : null;
      await device.save();

      if (mins > 0) {
        return { ok: false, error: 'locked', wait: mins * 60 };
      }
      return { ok: false, error: 'bad_pin' };
    }
  }

  let fail = auth.fail?.[role] || {};
  if (Number(fail.last || 0) < now - 86400000) {
    fail = {};
  }

  const until = Number(fail.until || 0);
  if (until > now) {
    return {
      ok: false,
      error: 'locked',
      wait: Math.ceil((until - now) / 1000),
    };
  }

  if (!pinOk) {
    let count = Number(fail.count || 0) + 1;
    let rounds = Number(fail.rounds || 0);
    let nextUntil = 0;

    if (count >= 10) {
      nextUntil = now + Math.min(1440, 15 * 2 ** Math.min(rounds, 7)) * 60000;
      rounds += 1;
      count = 0;
    }

    auth.fail = auth.fail || {};
    auth.fail[role] = {
      count,
      rounds,
      until: nextUntil,
      last: now,
    };
    await saveAuth(outlet, auth);

    if (nextUntil > 0) {
      return {
        ok: false,
        error: 'locked',
        wait: Math.ceil((nextUntil - now) / 1000),
      };
    }
    return { ok: false, error: 'bad_pin' };
  }

  auth.fail = auth.fail || {};
  auth.fail[role] = {
    count: 0,
    rounds: Number(fail.rounds || 0),
    until: 0,
    last: Number(fail.last || 0),
  };
  await saveAuth(outlet, auth);

  const token = randomToken();
  await Device.create({
    tokenHash: sha(token),
    role,
    outlet,
    label: String(p.device?.label || 'device').slice(0, 60),
  });

  return {
    ok: true,
    token,
    role,
    outlet,
    pv: auth.pv,
    v: 3,
  };
};

const findActiveDevice = async (token) => {
  if (!token) return null;
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return Device.findOne({
    tokenHash: sha(token),
    revoked: false,
    lastSeen: { $gt: cutoff },
  });
};

const setPinFromOwner = async (p = {}) => {
  const device = await findActiveDevice(p.token);
  if (!device) return { ok: false, error: 'auth' };
  if (device.role !== 'owner') return { ok: false, error: 'owner_only' };

  const role = p.role;
  const pin = String(p.pin || '');
  const signOut = p.signOut === true || p.signOut === 'true';

  if (!['barista', 'owner'].includes(role) || !/^[0-9]{4}$/.test(pin)) {
    return { ok: false, error: 'bad_request' };
  }

  await setPin({
    outlet: device.outlet,
    role,
    pin,
    signOut,
  });

  let token;
  if (signOut && role === 'owner') {
    token = randomToken();
    await Device.create({
      tokenHash: sha(token),
      role: 'owner',
      outlet: device.outlet,
      label: device.label,
    });
  }

  const auth = await getAuth(device.outlet);
  return { ok: true, pv: auth.pv, token };
};

module.exports = {
  ping,
  login,
  setPin,
  setPinFromOwner,
  findActiveDevice,
};
