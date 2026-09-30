const dir = (v) => new URL(`./plugins/demo/${v}/`, import.meta.url).pathname;
const registry = new Set();
const evict = (v) => { for (const k of Object.keys(require.cache)) if (k.startsWith(dir(v))) delete require.cache[k]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cycle(v, {leak}) {
  const ns = await import(dir(v) + "entry.mjs");
  const ctx = {register: (f) => registry.add(f)};
  await ns.activate(ctx);
  const probe = new WeakRef(ctx);                       // 内核持有的“激活上下文”弱引用
  if (!leak) registry.clear();                          // 正常卸载：撤回贡献
  else globalThis.__leaked = [...registry];             // 违规：插件把东西挂到全局
  evict(v);
  return probe;
}
async function collected(probe) {
  for (let i = 0; i < 5; i++) { Bun.gc(true); await sleep(20); if (!probe.deref()) return `第 ${i + 1} 轮 GC 后已回收`; }
  return "5 轮 GC 后仍存活";
}
for (let i = 0; i < 3; i++) console.log(`正常卸载 #${i + 1}：${await collected(await cycle(i % 2 ? "1.1.0" : "1.0.0", {leak: false}))}`);
console.log(`违规挂全局：${await collected(await cycle("1.0.0", {leak: true}))}`);
