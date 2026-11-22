/**
 * 服务入口的 Bun 版本门槛（同 CLI，`BUN_ENGINE`）：直接跑打包的 `server/main.js` 不经 CLI，也要在读配置、认领状态根之前就以明确的
 * 原因退出，而不是更晚因为运行时缺功能（例如按次 `proxy: false`）失败。`main.ts` 第一个导入它。
 */

import {BUN_ENGINE} from "nbook/shared/product";

if (!Bun.semver.satisfies(Bun.version, BUN_ENGINE)) {
    process.stderr.write(`NeuroBook needs Bun ${BUN_ENGINE}, but this is ${Bun.version}; run \`bun upgrade\` and start again.\n`);
    process.exit(2);
}
