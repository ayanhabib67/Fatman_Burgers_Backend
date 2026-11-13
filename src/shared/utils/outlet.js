const OUTLET_RE = /^[a-z][a-z0-9_-]{1,19}$/;

const isOutletOk = (outlet) => OUTLET_RE.test(String(outlet || ''));

const authKey = (outlet) => (outlet === 'whipped' ? 'auth' : `auth:${outlet}`);

const seqKey = (outlet) => (outlet === 'whipped' ? 'seq' : `seq:${outlet}`);

const normalizeOutlet = (outlet, fallback = 'fatman') => {
  const value = String(outlet || fallback).toLowerCase();
  return isOutletOk(value) ? value : fallback;
};

module.exports = {
  OUTLET_RE,
  isOutletOk,
  authKey,
  seqKey,
  normalizeOutlet,
};
