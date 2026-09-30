const heap = () => { Bun.gc(true); return process.memoryUsage().heapUsed / 1048576; };
const dir = (v) => new URL(`./plugins/demo/${v}/`, import.meta.url).pathname;
const registry = new Set();                                             // 模拟宿主持有的贡献注册表
const pluginKeys = (v) => Object.keys(require.cache).filter((k) => k.startsWith(dir(v)));
async function load(v) { const handles = []; await (await import(dir(v) + "entry.mjs")).activate({register: (f) => { registry.add(f); handles.push(f); }}); return handles; }
function revoke(handles) { for (const h of handles) registry.delete(h); }
function evict(v) { const keys = pluginKeys(v); for (const k of keys) delete require.cache[k]; return keys.length; }

const base = heap();
let handles = await load("1.0.0");
console.log(`加载 1.0.0 后 require.cache 中属于该插件的模块：${pluginKeys("1.0.0").length} 个；堆 +${(heap() - base).toFixed(1)}MB`);
// 情况 1：只删缓存，不撤回贡献（宿主注册表仍引用插件闭包）
evict("1.0.0");
console.log(`只删缓存、未撤回贡献：堆 +${(heap() - base).toFixed(1)}MB（仍被注册表引用）`);
// 情况 2：撤回贡献后
revoke(handles); handles = null;
console.log(`撤回贡献后：堆 +${(heap() - base).toFixed(1)}MB`);
// 情况 3：反复 禁用/启用 与 升级，共 40 次
const N = Number(process.argv[2] ?? 40);
for (let i = 0; i < N; i++) {
  const v = i % 2 ? "1.1.0" : "1.0.0";
  handles = await load(v);
  const out = [...registry][0]();
  revoke(handles); handles = null; evict(v);
  if (i < 2) console.log(`  第 ${i + 1} 次：${out}`);
}
console.log(`${N} 次启用、禁用与升级后：堆 +${(heap() - base).toFixed(1)}MB`);
