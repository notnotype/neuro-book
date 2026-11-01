#!/usr/bin/env bun
/**
 * `nbook` 命令行入口（docs/specs/runtime/cli.md）：给用户与 Agent 用，随应用的 npm 包发布，打包成 `server/nbook.js`。
 *
 * `nbook start` 在本进程里起服务端，所以这里先做两件事，再加载命令行本体（`run.ts`）：拍下启动环境（server/startup-env.ts），
 * 接管 OMP 装的进程级处理（server/omp-process.ts）。本体用 `await import` 加载、打包时开代码分割，是因为 OMP 不打进 bundle
 * （scripts/pack-app.ts 的 SERVER_EXTERNALS）：同一个文件里对外部包的静态导入会被提到最前、先于这两件事求值；放进另一个
 * chunk 才排在它们后面。
 */

import "nbook/server/startup-env";
import "nbook/server/omp-process";

await import("./run");
