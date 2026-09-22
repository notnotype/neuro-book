# 抽取 spike 报告：truncate 与 agent-sse-writer（2026-09-11）

> Task：`t01-product-host-success-research`；执行者：Leader；授权：开发者「可以跑 spike」（2026-09-11）。
> 目的：在正式建包前，用一次性最小实验验证「把领域无关代码抽成独立包后，能否独立构建与独立测试」，并暴露接线细节。
> 位置：`.local/spike-extract-20260911/`（`.gitignore` 覆盖 `.local/*`，不进入仓库；建包完成后可删）。

## 结果

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| RED（测试先行） | `bun x vitest run --config .local/spike-extract-20260911/vitest.config.ts` | 3 files failed：`Cannot find module './truncate.js'` / `'./sse-writer.js'`（预期失败） |
| GREEN（移植实现） | 同上 | 3 files / **10 tests passed**（212ms） |
| 类型检查 | `bun x tsc --noEmit -p .local/spike-extract-20260911/tsconfig.json` | 干净通过 |
| 适配改写后复跑 | 同上两条 | 3 files / **10 tests passed**；tsc 干净 |

测试构成（关键面，非全部）：truncate 6 条（不截断/按行截断/首行超字节、尾部按行截断/按字符边界部分行、formatSize）；sse-writer 3 条（顺序写出并 end+关闭订阅、`write(false)` 等 drain 后续写、abort 打断等待并销毁 response）；smoke 1 条（两模块可导入 + 最小真实路径）。

## 关键发现

1. **两个目标文件都是零依赖可移植**：`truncate.ts`（151 行）与 `agent-sse-writer.ts`（135 行）都没有 `nbook/*`、workspace、prisma 或 Pi 依赖，只需 Node `Buffer` 与自身类型；**不需要任何 seam 注入即可独立成包**。
2. **最小配置就够**：`package.json`（`type: module`）+ `tsconfig.json`（`moduleResolution: Bundler`、`types: ["node"]`、`lib ≥ ES2024`）+ `vitest.config.ts`（显式 `root` + `include`）。vitest/tsc 从仓库根 `node_modules` 解析即可运行，无需 install。
3. **移植需要一次适配改写**：`new Promise((resolve, reject) => …)` 在仓库默认 lint 规则下需改写为 `Promise.withResolvers()`；`lib` 随之需要 `ES2024`（或 `ES2024.Promise`）。改写后测试与类型检查仍全绿。
4. **测试可用最小假件覆盖关键合同**：一个 fake response（记录写入、可编排 `write` 返回值、可触发 `drain/close/error`）+ 一个 fake subscription（可 abort、记录 close）即可覆盖"顺序/背压/中止"三条合同；真实 socket 路径已有产品级测试，不必重复。
5. **未覆盖的接线项**（留给建包）：接 CI/全量 `bun run test` 的 include 或清单；登记 root `workspaces` 对 `bun.lock` 的影响；包级脚本命名（`bun run --cwd packages/<pkg> test`）；`docs/testing` 的"通用包测试合同"一节落地。

## 结论

**抽取可行，且成本低于预期**：两个文件可原样迁入新包（仅一处 lint 适配），配套约 3 个小文件（package/tsconfig/vitest 配置）+ 测试即可自洽运行；测试对这两个领域足够小、足够快（200ms 级），符合"只测关键 + smoke"的规范。

下一步（已获授权）：直接建两个真包——`packages/agent-file-tools`（首成员 `truncate`）与 `packages/agent-sse`（首成员 `agent-sse-writer`），登记 root `workspaces`，评估 `bun.lock` 变更，并把 D-TEST-01 规范落到 `docs/testing/`。

## 复现

```sh
bun x vitest run --config .local/spike-extract-20260911/vitest.config.ts
bun x tsc --noEmit -p .local/spike-extract-20260911/tsconfig.json
```
