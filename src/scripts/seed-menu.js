/**
 * Seed FatMan POS menu into MongoDB.
 *
 *   node src/scripts/seed-menu.js
 *   node src/scripts/seed-menu.js --force
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const { seedOutlet } = require('../modules/pos/services/menu.service');

(async () => {
  const force = process.argv.includes('--force');
  await mongoose.connect(config.mongoUri);
  const result = await seedOutlet('fatman', { force });
  console.log(result);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
