/**
 * Module registry — modular monolith.
 * POS module owns business logic (MongoDB is data only).
 */
const modules = [
  require('./health'),
  require('./auth'),
  require('./pos'),
  require('./hr'),
];

const registerModules = (app, { apiPrefix = '/api/v1' } = {}) => {
  modules.forEach((mod) => {
    if (!mod?.routes || mod.basePath == null) {
      throw new Error(`Invalid module registration: ${mod?.name || 'unknown'}`);
    }

    const mount = `${apiPrefix}${mod.basePath}`;
    app.use(mount, mod.routes);
    console.log(`Module loaded: ${mod.name} -> ${mount || apiPrefix}`);
  });
};

module.exports = { modules, registerModules };
