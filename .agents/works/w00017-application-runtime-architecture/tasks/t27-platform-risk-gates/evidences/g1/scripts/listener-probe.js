// 与 g1-verify.mjs 中 LISTENER_PROBE 相同：文档开始时记账全局目标上的监听器。
(() => {
  const active = new Map();
  const ids = new WeakMap();
  let next = 0;
  const idOf = (o) => { if (!ids.has(o)) ids.set(o, ++next); return ids.get(o); };
  const label = (t) => t === window ? "window" : t === document ? "document" : t === document.documentElement ? "html" : (document.body && t === document.body) ? "body" : null;
  const capture = (o) => typeof o === "boolean" ? o : Boolean(o && o.capture);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const l = label(this);
    if (l && listener) {
      const key = l + "|" + type + "|" + capture(options) + "|" + idOf(listener);
      active.set(key, {l, type});
      if (options && typeof options === "object" && options.signal) options.signal.addEventListener("abort", () => active.delete(key));
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const l = label(this);
    if (l && listener) active.delete(l + "|" + type + "|" + capture(options) + "|" + idOf(listener));
    return remove.call(this, type, listener, options);
  };
  window.__G1_LISTENERS__ = () => {
    const out = {};
    for (const {l, type} of active.values()) { const k = l + ":" + type; out[k] = (out[k] || 0) + 1; }
    return out;
  };
})();
