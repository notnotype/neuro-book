/**
 * 后端进程入口（产品）：加载产品清单。
 *
 *   NBOOK_STATE_ROOT=<状态根> [NBOOK_HOST=127.0.0.1] [NBOOK_PORT=4217] [NBOOK_RPC_PORT=4218] [NBOOK_WEB_ROOT=<目录>] bun src/server/main.ts [--stop-stdin]
 *
 * 先拍下启动环境（startup-env.ts）、接管 OMP 装的进程级处理（omp-process.ts），其余用 `await import` 加载：打包时开代码分割，
 * 对外部包 OMP 的静态导入落在另一个 chunk 里，排在这两件事之后（理由同 cli/main.ts）。
 */

import "./startup-env";
import "./omp-process";

const [{productPlugins}, {runServerProcess}] = await Promise.all([import("nbook/manifest"), import("./process")]);
await runServerProcess(productPlugins);
