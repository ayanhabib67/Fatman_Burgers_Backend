/**
 * Quick LAN test for a ZKTeco device.
 *
 *   node src/scripts/zk-test.js 192.168.1.201 4370
 */
require('dotenv').config();
const ZKLib = require('node-zklib');

const ip = process.argv[2] || '192.168.1.201';
const port = Number(process.argv[3] || 4370);

(async () => {
  const zk = new ZKLib(ip, port, 12000, 4000);
  console.log(`Connecting to ${ip}:${port} …`);
  try {
    await zk.createSocket();
    console.log('Connected via', zk.connectionType);
    console.log('Info:', await zk.getInfo());
    const users = await zk.getUsers();
    console.log('Users:', users?.data?.length ?? 0);
    const logs = await zk.getAttendances();
    console.log('Attendance logs:', logs?.data?.length ?? 0);
    if (logs?.data?.[0]) console.log('Sample log:', logs.data[0]);
    await zk.disconnect();
    console.log('OK');
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.message || err);
    try {
      await zk.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
})();
