#!/usr/bin/env bun
/**
 * `nbook` 命令行入口（docs/specs/runtime/cli.md）：给用户与 Agent 用，随应用的 npm 包发布，打包成 `server/nbook.js`。
 *
 * 第一件事是拍下启动环境（server/startup-env.ts），然后才加载命令行本体（`run.ts`）。本体用 `await import` 加载、打包时开代码
 * 分割，是因为 OMP 不打进 bundle（scripts/pack-app.ts 的 SERVER_EXTERNALS）：同一个文件里对外部包的静态导入会被提到最前、先于
 * 这件事求值，放进另一个 chunk 才排在后面。接管 OMP 的进程级处理只在 `start` 命令里做（run.ts），别的命令不求值 OMP。
 */

import "nbook/server/startup-env";

await import("./run");
