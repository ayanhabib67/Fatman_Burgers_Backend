const RECORD_KINDS = [
  'orders',
  'voided',
  'expenses',
  'customItems',
  'accounts',
  'days',
  'moves',
  'stock',
  'recipes',
  'stockmoves',
  'vendors',
  'vendormoves',
  'people',
  'outs',
  'customers',
  'signoffs',
  'feed',
];

const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const isText = (value, maxLen) => {
  if (value == null) return true;
  return typeof value === 'string' && value.length <= maxLen;
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const jsonSizeOk = (record) => {
  try {
    return JSON.stringify(record).length <= 20000;
  } catch {
    return false;
  }
};

const plain = (record) => {
  if (!isPlainObject(record) || !jsonSizeOk(record)) return false;
  if (record.u != null && !isNumber(record.u)) return false;
  return true;
};

const isValidRecord = (kind, record) => {
  if (!RECORD_KINDS.includes(kind)) return false;
  if (!isPlainObject(record) || !jsonSizeOk(record)) return false;
  if (record.u != null && !isNumber(record.u)) return false;

  if (kind === 'recipes') {
    return typeof record.id === 'string' && record.id.length >= 1 && record.id.length <= 130 && plain(record);
  }

  if (['accounts', 'days', 'moves', 'stock', 'stockmoves', 'vendors', 'vendormoves', 'outs', 'customers', 'signoffs', 'people', 'feed'].includes(kind)) {
    const idOk =
      (typeof record.id === 'number' && /^[0-9]{1,16}$/.test(String(record.id))) ||
      (typeof record.id === 'string' && record.id.length >= 1 && record.id.length <= 80);
    return idOk && plain(record);
  }

  if (kind === 'customItems') {
    return (
      typeof record.n === 'string' &&
      record.n.length >= 1 &&
      record.n.length <= 60 &&
      isNumber(record.p) &&
      isNumber(record.k)
    );
  }

  if (!(typeof record.id === 'number' || typeof record.id === 'string')) return false;
  if (!/^[0-9]{1,16}$/.test(String(record.id))) return false;

  if (kind === 'expenses') {
    return (
      typeof record.name === 'string' &&
      record.name.length <= 80 &&
      isNumber(record.amount) &&
      isText(record.iso, 10) &&
      isText(record.date, 30) &&
      isText(record.time, 30) &&
      isText(record.by, 30)
    );
  }

  // orders + voided
  if (!isNumber(record.no) || !isNumber(record.total) || !Array.isArray(record.items)) return false;
  if (!['Cash', 'Card', 'Transfer', 'Unpaid'].includes(record.payment || '')) return false;
  if (record.sub != null && !isNumber(record.sub)) return false;
  if (record.cogs != null && !isNumber(record.cogs)) return false;
  if (record.discount != null && !isNumber(record.discount)) return false;
  if (record.discountPct != null && !isNumber(record.discountPct)) return false;
  if (
    !(
      isText(record.customer, 60) &&
      isText(record.channel, 30) &&
      isText(record.iso, 10) &&
      isText(record.date, 30) &&
      isText(record.time, 30) &&
      isText(record.paidIso, 10) &&
      isText(record.paidAt, 30) &&
      isText(record.paidDate, 30) &&
      isText(record.voidedIso, 10) &&
      isText(record.voidedAt, 30) &&
      isText(record.voidedDate, 30) &&
      isText(record.voidedBy, 30) &&
      isText(record.reason, 80)
    )
  ) {
    return false;
  }
  if (record.items.length > 80) return false;

  for (const item of record.items) {
    if (!isPlainObject(item)) return false;
    if (typeof item.n !== 'string' || item.n.length > 80) return false;
    if (!isNumber(item.q) || !isNumber(item.p) || !isNumber(item.k)) return false;
    if (!isText(item.c, 40)) return false;
  }

  return true;
};

const recordIdFor = (kind, record) => {
  if (kind === 'customItems') return `ci:${String(record.n || '').toLowerCase()}`;
  return String(record.id);
};

const dayFor = (kind, record) => {
  switch (kind) {
    case 'orders':
    case 'expenses':
    case 'days':
    case 'moves':
    case 'stockmoves':
      return String(record.iso || '');
    case 'voided':
      return String(record.voidedIso || record.iso || '');
    default:
      return '';
  }
};

module.exports = {
  RECORD_KINDS,
  isValidRecord,
  recordIdFor,
  dayFor,
};
