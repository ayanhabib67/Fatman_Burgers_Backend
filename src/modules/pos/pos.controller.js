const asyncHandler = require('../../shared/utils/asyncHandler');
const authService = require('./services/auth.service');
const syncService = require('./services/sync.service');
const menuService = require('./services/menu.service');
const uploadService = require('./services/upload.service');

const payload = (req) => {
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'p')) {
    return req.body.p;
  }
  return req.body || {};
};

const rpcOk = (res, data) => res.status(200).json(data);

const getMenu = asyncHandler(async (req, res) => {
  const data = await menuService.listMenu({
    outlet: req.query.outlet || 'fatman',
    activeOnly: req.query.activeOnly !== 'false',
  });
  return rpcOk(res, { ok: true, ...data });
});

const seedMenu = asyncHandler(async (req, res) => {
  const p = payload(req);
  const data = await menuService.seedOutlet(p.outlet || req.query.outlet || 'fatman', {
    force: Boolean(p.force || req.query.force === 'true'),
  });
  return rpcOk(res, { ok: true, ...data });
});

const upsertMenuItem = asyncHandler(async (req, res) => {
  const p = payload(req);
  const item = await menuService.upsertItem(p.outlet || req.query.outlet || 'fatman', p);
  return rpcOk(res, { ok: true, item });
});

const ping = asyncHandler(async (req, res) => {
  const data = await authService.ping();
  return rpcOk(res, data);
});

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(payload(req) || {});
  return rpcOk(res, data);
});

const sync = asyncHandler(async (req, res) => {
  const data = await syncService.sync(payload(req) || {});
  return rpcOk(res, data);
});

const setPin = asyncHandler(async (req, res) => {
  const data = await authService.setPinFromOwner(payload(req) || {});
  return rpcOk(res, data);
});

/**
 * Supabase-compatible dispatcher:
 * POST /api/v1/rpc/:fn  with body { p: {...} }
 */
const rpcDispatch = asyncHandler(async (req, res) => {
  const fn = String(req.params.fn || '');
  const p = payload(req);

  switch (fn) {
    case 'pos_ping':
      return rpcOk(res, await authService.ping());
    case 'pos_login':
      return rpcOk(res, await authService.login(p || {}));
    case 'pos_sync':
      return rpcOk(res, await syncService.sync(p || {}));
    case 'pos_set_pin':
      return rpcOk(res, await authService.setPinFromOwner(p || {}));
    case 'pos_menu':
      return rpcOk(res, {
        ok: true,
        ...(await menuService.listMenu({
          outlet: p?.outlet || 'fatman',
          activeOnly: p?.activeOnly !== false,
        })),
      });
    default:
      return res.status(404).json({
        ok: false,
        error: 'unknown_rpc',
        message: `RPC not implemented yet: ${fn}`,
      });
  }
});

const uploadImage = asyncHandler(async (req, res) => {
  const p = payload(req) || {};
  const data = await uploadService.uploadImageDataUrl(p.image || p.dataUrl, {
    folder: p.folder || 'fatman/transfers',
  });
  return rpcOk(res, { ok: true, ...data });
});

const deleteImage = asyncHandler(async (req, res) => {
  const p = payload(req) || {};
  const data = await uploadService.deleteImage(p.publicId || p.url || p.image);
  return rpcOk(res, { ok: true, ...data });
});

module.exports = {
  ping,
  login,
  sync,
  setPin,
  getMenu,
  seedMenu,
  upsertMenuItem,
  uploadImage,
  deleteImage,
  rpcDispatch,
};
