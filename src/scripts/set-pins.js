/**
 * Dev/bootstrap: set Counter + Owner PINs for an outlet in MongoDB.
 *
 * Usage:
 *   node src/scripts/set-pins.js fatman 1234 5678
 */
require('dotenv').config();

const mongoose = require('mongoose');
const config = require('../config');
const { setPin } = require('../modules/pos/services/auth.service');

const run = async () => {
  const outlet = process.argv[2] || 'fatman';
  const baristaPin = process.argv[3] || process.env.DEV_BARISTA_PIN || '1234';
  const ownerPin = process.argv[4] || process.env.DEV_OWNER_PIN || '5678';

  await mongoose.connect(config.mongoUri);
  console.log(`Connected: ${config.mongoUri}`);

  console.log(await setPin({ outlet, role: 'barista', pin: baristaPin }));
  console.log(await setPin({ outlet, role: 'owner', pin: ownerPin }));

  await mongoose.connection.close();
  console.log('Done.');
};

run().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
