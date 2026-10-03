# Round 03 — Phase 3：Profile artifact 减重（切边 + 依赖门禁）

日期：2026-07-27。前置：Phase 1/2（fixture 所有权 + 有界 GC）已随 `c1f52fc2` 推送。

## 用户需求

Phase 2 落地后暴露出预算标定失真：单个 profile artifact 27.3 MiB、一次全量发布 14 profile = 382 MiB，512 MiB orphan 预算只买到 1.3 代回滚余量。用户同意按三步方案（切断渗漏边 / 宿主能力注入 / metafile 门禁）制定并执行 Phase 3，目标是把 artifact 压回个位数 MiB 并建立门禁防止宿主实现再进图。

## 调研结论（推翻计划前提的部分）

- **「点名 external」方案不可行**：`runtimeRequireBanner` 只服务 esbuild 的 CJS interop；format:esm 下 external 裸包保留为 ESM `import`，由 artifact 自身位置解析——Product 的 `.output/server/node_modules` 不在向上查找路径上，source dev 也没有 `node_modules/nbook`。
- 但也不需要：esbuild metafile BFS 探针证明三个重依赖族**各只有一条进入边**，全在 profile-dsl 自己的 import 上，源头切断即可，编译器 resolve 策略零改动。
- `bun:ffi` 在编译器里**早已 external**（`isPlatformBuiltinModule`），此前「另一个 agent」报告中「512 MiB 预算被单次发布撑爆」的说法不成立，真问题是标定失真。

## 实施（四处切边 + 一道门禁）

计划为三处切边；实施中发现第四条边（writer→project-workspace），同模式处理。

1. **切边 1**：`profile-dsl.ts` 的 `defaultSqlSchemaSummaryText` 删掉两个动态 import（esbuild bundle:true 下动态 import 照样打包，曾拖进整个 server 树 262 文件 → jsdom/prisma/@libsql）。改为 `ctx.runtime.sqlSchemaSummary` 注入：`types.ts` runtime 加可选字段；新模块 `server/agent/tools/project-sql-schema-summary.ts` 承载 helper（不能放 agent-sql-project-module——project-session 反向 import 它做注册，会成环）；harness 3 处 + profile-http-service 1 处接线。
2. **切边 2**：token 估算器（presentation 唯一的 pi-agent-core 值导入，拖进全部 Provider SDK ≈5 MiB）拆到新模块 `server/agent/messages/stored-message-tokens.ts`。消费方 4 个改 import：compaction、neuro-agent-harness、trace-segments（计划漏数了这个）、presentation.test。
3. **切边 3**：新纯模块 `server/agent/plan-mode-directory.ts` 承载 `PLAN_MODE_DIRECTORY` + `planModeToolDirectory`；`plan-mode-path.ts` re-export 保持宿主 API；profile-dsl 改从纯模块导入（甩掉 session-file-scope→project-workspace→@libsql 链）。
4. **切边 4（计划外）**：writer.profile.tsx 直接 import `readProjectManifest`，而它住在值导入 @libsql 的 project-workspace.ts。manifest 读取（常量、类型、read 三函数）拆到 `server/workspace-files/project-manifest.ts`，project-workspace re-export。
5. **门禁**：`profile-artifact-compiler.ts` 在 dependencies 产出后、staging 前执行 `assertProfileArtifactDependencyGate()`——server/ 白名单 + 禁止依赖族 + 4 MiB 字节上限，违规包装成 `compile_failed`。**与计划的偏差**：不新增 `dependency_violation` issue code（`"compile_failed"` 字面量被 14 个文件消费，扩 union 波及 DTO 与前端），改为 message 固定前缀「依赖门禁违规」。白名单在跑测试时补了两处合法创作面：`server/agent/test/`（catalog 测试 fixture 的 profileToolsFromKeys）与 variables 纯闭包三文件（registry/schema-resolver/types；不能整目录放行，accessor→session-repo 是重链）。

## 结果（对照 round-02 基线）

| 指标 | 前 | 后 |
| --- | ---: | ---: |
| 单 artifact（leader.default） | 27.3 MiB / 3948 inputs | 1.20 MiB / 759 inputs |
| 单 artifact 范围（14 个） | ~27 MiB | 1.16–1.63 MiB |
| 一代 release 总量 | 382 MiB | **17.24 MiB** |
| 512 MiB orphan 预算余量 | ~1.3 代 | ~30 代 |
| jsdom/@prisma/@libsql/@mistralai/pi-ai/openai | 在图中 | 全部「不在图中」（探针确认） |

预算常量未改（Phase 2 拍板维持）。

## 验证

- `bun scripts/build/prepare-system-assets.ts --force`：14/14 loaded，全过门禁。
- 门禁单测 `profile-artifact-dependency-gate.test.ts` 4/4；`catalog.test.ts` **44/44**（此前另一 agent 报告回不去 44/44 的正是它）；presentation/compaction/gc/store/fixture/runtime-import 套件全绿。
- `bun run typecheck`：除 `llmlint.test.ts` 既有漂移（`ignoreTerms` 字段，llmlint sync 带入）外零错误。
- **确认与本轮无关的既有失败**（工作区在途未提交漂移，不修）：
  - `config-service.test.ts` 26 失败：`config-service.ts`+`config.dto.ts` 有未提交的 projectPath→projectRoot API 迁移（Task 118 方向），测试没跟上。
  - `rp-profiles` / `leader-assets-profile` / `simulation-director-profiles` 若干失败：断言的提示词文本（如「Runtime Location」）与工具清单在 HEAD 后被其他在途改动更新（harness 有 +133 行非本轮改动），测试没跟上。

## 后续 TODO

- Product 形态发布前冒烟（本轮只删 import 边、未动编译器 resolve/banner，Product 路径零改动）。
- 浏览器验证 SQL schema 摘要注入链路（建议用户让 Agent 在有 Project 的 session 里确认 `<sql-schema-summary>` 内容非「暂不可用」）。
