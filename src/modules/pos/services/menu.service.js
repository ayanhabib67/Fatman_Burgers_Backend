const MenuItem = require('../models/MenuItem');
const AppError = require('../../../shared/errors/AppError');

/** Default FatMan menu — mirrors former config.js MENU (seed once). */
const FATMAN_SEED = [
  { category: 'Burgers', name: 'OG Smash Single', price: 1250, cost: 529, imageKey: 'og-single' },
  { category: 'Burgers', name: 'OG Smash Double', price: 1649, cost: 829, imageKey: 'og-double' },
  { category: 'Burgers', name: 'Oklahoma Smash Single', price: 1190, cost: 529, imageKey: 'ok-single' },
  { category: 'Burgers', name: 'Oklahoma Smash Double', price: 1600, cost: 829, imageKey: 'ok-double' },
  { category: 'Burgers', name: 'FatMan Special Single', price: 1325, cost: 579, imageKey: 'sp-single' },
  { category: 'Burgers', name: 'FatMan Special Double', price: 1719, cost: 879, imageKey: 'sp-double' },
  { category: 'Fries', name: 'Salted Fries', price: 450, cost: 140, imageKey: 'fries-salted' },
  { category: 'Fries', name: 'Masala Fries', price: 450, cost: 150, imageKey: 'fries-masala' },
  { category: 'Fries', name: 'Peri Peri Fries', price: 450, cost: 150, imageKey: 'fries-peri' },
  { category: 'Fries', name: 'FatMan Loaded Fries', price: 950, cost: 380, imageKey: 'fries-loaded' },
  { category: 'Chicken', name: 'Chicken Strips, 4 pcs + fries', price: 965, cost: 420, imageKey: 'chicken-strips' },
  { category: 'Add-ons', name: 'Pickles', price: 100, cost: 20, imageKey: 'addon-pickles' },
  { category: 'Add-ons', name: 'Extra Patty', price: 350, cost: 170, imageKey: 'addon-patty' },
  { category: 'Add-ons', name: 'Beef Bacon', price: 300, cost: 140, imageKey: 'addon-bacon' },
  { category: 'Add-ons', name: 'Cheese Slice', price: 125, cost: 65, imageKey: 'addon-cheese' },
  { category: 'Add-ons', name: 'Jalapeno', price: 100, cost: 20, imageKey: 'addon-jalapeno' },
  { category: 'Drinks', name: 'Soft Drink', price: 200, cost: 90, imageKey: 'drink-soft' },
  { category: 'Drinks', name: 'Water', price: 100, cost: 40, imageKey: 'drink-water' },
  { category: 'Drinks', name: 'Slush', price: 400, cost: 120, imageKey: 'drink-slush' },
  { category: 'Drinks', name: 'Creamy Vanilla Shake', price: 700, cost: 250, imageKey: '' },
  { category: 'Drinks', name: 'Chocolate Shake', price: 700, cost: 250, imageKey: '' },
  { category: 'Drinks', name: 'Strawberry Shake', price: 700, cost: 250, imageKey: '' },
  { category: 'Dessert', name: 'Cheesecake', price: 850, cost: 450, imageKey: 'dessert-cheesecake' },
  { category: 'Dessert', name: 'Brownie', price: 500, cost: 250, imageKey: 'dessert-brownie' },
];

const toTillShape = (doc) => ({
  id: String(doc._id),
  c: doc.category,
  n: doc.name,
  p: Number(doc.price),
  k: Number(doc.cost || 0),
  i: doc.imageKey || '',
  active: doc.active !== false,
});

const normalizeOutlet = (outlet) => {
  const o = String(outlet || 'fatman')
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,19}$/.test(o)) {
    throw new AppError('Invalid outlet', 400);
  }
  return o;
};

const seedOutlet = async (outlet = 'fatman', { force = false } = {}) => {
  const o = normalizeOutlet(outlet);
  const count = await MenuItem.countDocuments({ outlet: o });
  if (count > 0 && !force) {
    return { outlet: o, seeded: false, count };
  }
  if (force) {
    await MenuItem.deleteMany({ outlet: o });
  }
  const docs = FATMAN_SEED.map((row, idx) => ({
    outlet: o,
    category: row.category,
    name: row.name,
    price: row.price,
    cost: row.cost,
    imageKey: row.imageKey || '',
    sortOrder: idx,
    active: true,
  }));
  await MenuItem.insertMany(docs);
  return { outlet: o, seeded: true, count: docs.length };
};

const ensureSeeded = async (outlet = 'fatman') => {
  const o = normalizeOutlet(outlet);
  const count = await MenuItem.countDocuments({ outlet: o });
  if (count === 0) {
    await seedOutlet(o);
  }
  return o;
};

const listMenu = async ({ outlet = 'fatman', activeOnly = true } = {}) => {
  const o = await ensureSeeded(outlet);
  const filter = { outlet: o };
  if (activeOnly) filter.active = true;
  const rows = await MenuItem.find(filter).sort({ sortOrder: 1, category: 1, name: 1 }).lean();
  return {
    outlet: o,
    items: rows.map(toTillShape),
  };
};

const upsertItem = async (outlet, payload = {}) => {
  const o = normalizeOutlet(outlet);
  const category = String(payload.category || payload.c || '').trim();
  const name = String(payload.name || payload.n || '').trim();
  if (!category || !name) throw new AppError('category and name required', 400);
  const price = Number(payload.price ?? payload.p);
  if (!Number.isFinite(price) || price < 0) throw new AppError('Invalid price', 400);

  const doc = await MenuItem.findOneAndUpdate(
    { outlet: o, category, name },
    {
      $set: {
        price,
        cost: Number(payload.cost ?? payload.k ?? 0) || 0,
        imageKey: String(payload.imageKey || payload.i || '').trim(),
        active: payload.active !== false,
        sortOrder:
          payload.sortOrder != null ? Number(payload.sortOrder) : undefined,
      },
      $setOnInsert: { outlet: o, category, name },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return toTillShape(doc);
};

const setActive = async (outlet, id, active) => {
  const o = normalizeOutlet(outlet);
  const doc = await MenuItem.findOneAndUpdate(
    { _id: id, outlet: o },
    { $set: { active: Boolean(active) } },
    { returnDocument: 'after' }
  );
  if (!doc) throw new AppError('Menu item not found', 404);
  return toTillShape(doc);
};

module.exports = {
  FATMAN_SEED,
  listMenu,
  seedOutlet,
  ensureSeeded,
  upsertItem,
  setActive,
  toTillShape,
};
