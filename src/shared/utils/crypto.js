const crypto = require('crypto');

const sha = (value) =>
  crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

const randomToken = () =>
  crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

const randomSalt = () =>
  crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

const pinHash = (salt, role, pin) => sha(`${salt}|${role}|${pin}`);

module.exports = {
  sha,
  randomToken,
  randomSalt,
  pinHash,
};
