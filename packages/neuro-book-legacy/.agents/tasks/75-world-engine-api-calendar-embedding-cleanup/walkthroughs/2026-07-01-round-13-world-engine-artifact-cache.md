# Round 13：World Engine artifact 物理缓存导入补强

## 背景

用户在 Windows Product portable `0.5.4-canary` 中继续报告 World Engine 全部不可用，错误形态为 `ResolveMessage: Cannot find module '...\world-engine\.world-engine-calendar-<hash>.mjs' from ''`。

本地用用户提供的 `calendar.ts` 与 `schema/index.ts` 跑完整 `executeCodeActWorld` 读写链路通过，配置内容不是根因。release asset 也确认包含 Round 12 的 native dynamic import seam。新的关键发现是：World Engine loader 虽然已经调用 `importRuntimeArtifact(cachePath)`，但没有传 `cacheKey/cacheNamespace/expectedBytes`，因此仍直接导入 Project Workspace 下短生命周期 `.world-engine-*.mjs`，没有像 profile / variable artifact 一样落到统一物理 artifact cache。

## 修复内容

1. World Engine 单文件 TS loader 保持外部契约不变：`calendar.ts` / `schema/index.ts` 继续先校验单文件 import/export，再转译为内容 hash `.mjs`。
2. 导入转译 artifact 时改为传入 `cacheKey`、`cacheNamespace` 和 `expectedBytes`：
   - calendar 使用 `runtime-artifact-import-cache/world-engine-calendar/<hash>.mjs`。
   - schema 使用 `runtime-artifact-import-cache/world-engine-schema/<hash>.mjs`。
   - Project Workspace 下的 `.world-engine-*.mjs` 只作为转译中转文件，导入后继续清理。
3. 转译成功但 runtime artifact 导入失败时，包装成 World Engine loader 层错误，包含 source、临时 artifact、hash 与原始错误，避免把临时 `.mjs` 缺失误判为 schema/calendar 源文件损坏或数据库损坏。
4. 新增用户提供配置形态的 CodeAct smoke，并把现有 TS-only schema 测试升级为同时断言临时文件清理和物理 cache 命中。

## 设计边界

- 不改变 World Engine API、数据库、`execute_world` 工具协议或配置文件格式。
- 不放宽 Project 本地 helper import；单文件契约不变。
- 不新增 runtime 抽象或依赖；复用 Round 12 已建立的 `importRuntimeArtifact()` cache options。
- 这轮是 infrastructure hardening：本地仍未 100% 复现用户机器的 Product `ResolveMessage`，但报错路径与裸项目临时 artifact 导入链路完全吻合。

## 验证结果

已执行：

- `bun run test server/utils/runtime-artifact-import.test.ts server/world-engine/codeact.test.ts server/agent/tools/world-engine-tools.test.ts`：3 files / 41 tests passed。
- `bun run test server/world-engine`：12 files / 156 tests passed。
- `bun run nuxt:build`：通过；第一次运行曾在 Vite 读取 `.nuxt/tsconfig.json` 时遇到瞬时 ENOENT，确认文件随后存在并重跑通过，最终验证以重跑结果为准。
- `bun run product:stage`：通过，输出 `Product runtime staged: product`。
- 静态检查 runtime chunks：`.output/server/chunks` 与 `product/.output/server/chunks` 均不再命中裸 `importRuntimeArtifact(cachePath)`；`index2.mjs` 中可见 `cacheKey: hash`、`cacheNamespace: \`world-engine-${label}\`` 与 `expectedBytes`。

## 与计划出入

实现意图与计划一致：没有引入新配置格式、现场修补脚本、数据库迁移或 Product 启动方式变化。实际实现中没有新增单独的 cache 清理策略；沿用现有 `runtime-artifact-import-cache` 行为，后续如需统一 GC 再单独处理。
