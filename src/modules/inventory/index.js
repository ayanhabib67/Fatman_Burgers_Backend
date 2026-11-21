/**
 * Inventory module — daily stock ledger.
 * Exposed through the POS RPC dispatcher: POST /api/v1/rpc/<fn> with { p: {...} }.
 */
const service = require('./inventory.service');

const rpc = {
  inv_items: service.listItems,
  inv_item_save: service.saveItem,
  inv_item_delete: service.deleteItem,
  inv_move: service.addMovement,
  inv_move_bulk: service.addMovementsBulk,
  inv_move_delete: service.deleteMovement,
  inv_day: service.daySummary,
  inv_history: service.history,
};

module.exports = { name: 'inventory', rpc };
