require('dotenv').config();

const parsePorts = (raw, fallback) => {
  const list = String(raw || '')
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
  return list.length ? list : fallback;
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fatman_burgers_pos',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  defaultOutlet: process.env.DEFAULT_OUTLET || 'fatman',
  hrTokenSecret: process.env.HR_TOKEN_SECRET || 'fatman-hr-dev-secret-change-me',

  /**
   * Public URL the ZK device should reach (no trailing slash).
   * Example: http://api.yourdomain.com  OR  http://YOUR_VPS_IP:8088
   */
  admsPublicUrl: (process.env.ADMS_PUBLIC_URL || '').replace(/\/$/, ''),

  /** Extra ADMS listeners (ZK firmwares often use 8088 / 86). */
  admsExtraPorts: parsePorts(process.env.ADMS_EXTRA_PORTS, [8088, 86]),

  /** Set false on Hostinger ADMS-only production to stop LAN TCP pull noise. */
  zkPullEnabled: String(process.env.ZK_PULL_ENABLED || 'true').toLowerCase() !== 'false',
};

module.exports = config;
