// Release preflight 专用 zod shim。
// vite-node 对「`export { z }` 再导出 namespace import 绑定」的转换会丢失该绑定
// （zod 官方入口 index.js 恰好用此模式），导致 `z` 为 undefined；本 shim 改为
// 先 const 再导出的等价形态，并保留与官方入口一致的命名空间语义。
import * as ns from "../../node_modules/zod/v4/classic/external.js";

const z = ns;
export {z};
export * from "../../node_modules/zod/v4/classic/external.js";
export default z;
