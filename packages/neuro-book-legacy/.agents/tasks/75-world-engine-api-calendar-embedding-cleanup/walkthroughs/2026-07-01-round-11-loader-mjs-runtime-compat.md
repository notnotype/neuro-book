# Round 11：schema/calendar loader 转译为 mjs 再加载

## 背景

用户转发的外部错误报告指出：`calendar.ts` / `schema/index.ts` 的 hash 临时副本仍是 `.ts`，如果宿主进程不是 Bun 或新版本 Node，动态 `import()` 可能因为运行时不支持 TypeScript 文件而失败。

当前实现的单文件契约是正确的，但 loader 不应把“宿主能直接 import `.ts`”作为运行前提。本轮修复目标是保持用户配置入口仍为 TypeScript，同时让运行时只导入 JavaScript。

## 修复内容

1. `importSingleFileTypeScriptConfig()` 保持入口文件内容 hash 缓存，但临时模块从 `.world-engine-<label>-<hash>.ts` 改为 `.world-engine-<label>-<hash>.mjs`。
2. loader 在导入前使用 esbuild 转译配置入口：
   - Project 本地相对 import、绝对路径、URL/protocol import/export 与非静态 dynamic import/require 仍被拒绝。
   - `node:` 内置模块保持 external。
   - 普通包级 import 解析成当前 runtime vendor 的 file URL，避免从 Project Workspace 目录向上找依赖。
   - `nbook/*` / `neuro_book/*` 作为 repo alias 解析，允许 `nbook/world-engine/schema` 这类公共 helper 被转译进配置产物。
3. Product runtime 的 `nbook` 包补复制根目录 `world-engine/`，并增加断言，确保产品包里存在 `nbook/world-engine/schema/index.ts`。
4. 临时文件清理同时覆盖旧 `.world-engine-*.ts` 残留和新 `.world-engine-*.mjs` 残留。

## 验证计划

- `bun run test server/world-engine/codeact.test.ts server/agent/tools/world-engine-tools.test.ts`
- 若 `.output` 可用，继续运行 `bun run product:stage`，确认 staged product 内包含 `node_modules/nbook/world-engine/schema/index.ts`。

## 与计划出入

实现不改变 World Engine 外部 API、schema/calendar 用户入口、数据库结构或 `execute_world` 工具协议；修复点只在 loader 和 Product runtime helper 携带层。
