/**
 * 后端进程入口（产品）：加载产品清单。
 *
 *   NBOOK_STATE_ROOT=<状态根> [NBOOK_HOST=127.0.0.1] [NBOOK_PORT=4217] [NBOOK_RPC_PORT=4218] [NBOOK_WEB_ROOT=<目录>] bun src/server/main.ts [--stop-stdin]
 */

// 第一条导入：启动环境要在任何导入 OMP 的模块之前拍下（startup-env.ts）。
import "./startup-env";

import {productPlugins} from "nbook/manifest";

import {runServerProcess} from "./process";

await runServerProcess(productPlugins);
