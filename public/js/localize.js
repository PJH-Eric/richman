
(function (root) {
  function fields(table, prefix) { Object.keys(table).forEach(function (id) { ['name', 'desc'].forEach(function (field) { Object.defineProperty(table[id], field, { configurable: true, enumerable: true, get: function () { return root.I18N.t(prefix + id + '.' + field); } }); }); }); }
  fields(root.Rules.ITEMS, 'item.'); fields(root.Rules.GODS, 'god.');
})(window);
