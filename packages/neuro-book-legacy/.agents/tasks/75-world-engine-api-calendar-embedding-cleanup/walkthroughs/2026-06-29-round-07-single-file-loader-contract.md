# Round 07：schema/calendar 单文件 Loader 契约收口

## 背景

用户已明确决策：`world-engine/calendar.ts` 与 `world-engine/schema/index.ts` 强制单文件，不支持 Project 本地拆分 helper。前一轮的内容 hash import 已解决入口文件热加载，但仍留下一个容易误解的边界：入口文件如果 import 了本地 helper，helper 内容变化不在缓存键内。

本轮不做依赖图热加载，也不使用随机路径假装支持拆分文件，而是把 loader 契约收紧为可验证的单文件配置入口。

## 修复内容

1. 单文件 TS 配置 importer：
   - 将旧 `fresh-typescript-import` helper 替换为 `single-file-typescript-config-import`。
   - 保留入口内容 hash + 稳定临时模块路径 + 导入后清理临时文件。
   - 导入前校验 `import` / `export ... from` / dynamic `import()` / `require()`，本地文件、绝对路径和 URL/protocol specifier 直接报错。
   - 使用 esbuild 解析运行时 import/export，并用 TypeScript AST 补充捕获 `import type`、TS import type expression 和非静态 dynamic import / require。
   - 包级 import 与 `node:` 内置模块继续允许，例如 `zod`、`nbook/world-engine/schema`、`node:path`。

2. Loader 接入：
   - `WorldCalendarLoader` 与 `WorldSchemaLoader` 统一走单文件 importer。
   - 注释改为单文件配置入口，不再暗示保留相对 import 语义。

3. 文档与模板：
   - `reference/world-engine/schema-system.md`、`calendar-system.md` 明确单文件入口规则。
   - 默认模板 `world-engine/index.md`、`calendar.ts`、`schema/index.ts` 增加单文件配置说明。
   - 根包级 helper `world-engine/schema/index.ts` 的示例注释移除“可拆分到独立文件”说法。
   - task README 与 Round 05/06 walkthrough 改为最终契约：入口内容变化可热加载，本地文件、绝对路径和 URL/protocol import 被拒绝，不留下依赖图热加载 TODO。

## 验证

- `bun test server/world-engine/codeact.test.ts`：通过，31 tests。覆盖：
  - `calendar.ts` 入口内容变化后同 facade 再读使用新内容。
  - `schema/index.ts` 入口内容变化后同 facade 再读使用新内容。
  - `calendar.ts` 使用 `import "./calendar-config"` 时加载失败，错误说明单文件限制。
  - `schema/index.ts` 使用 `import "./character"` 时加载失败，错误说明单文件限制。
  - `schema/index.ts` 使用 `import type "./types"` 时加载失败，错误说明单文件限制。
  - `schema/index.ts` 使用 TS import type expression `import("./types")` 时加载失败。
  - `schema/index.ts` 使用 `file://` URL import 时加载失败。
  - `schema/index.ts` 使用 Windows / POSIX 绝对路径 import 时加载失败。
  - `schema/index.ts` 使用非静态 dynamic import 时加载失败。
  - `schema/index.ts` 使用 `zod` 与 `nbook/world-engine/schema` 包级 import 时可加载。
  - `schema/index.ts` 使用 `node:path` 内置模块 import 时可加载。
- `bun test server/world-engine`：通过，258 tests。
- `bunx vitest run server/agent/tools`：通过，13 files / 116 tests。
- `bun run typecheck`：失败，但错误均来自既有 `assets/workspace/.nbook/agent/skills/llmlint/src/**`：`.ts` extension import 未启用 `allowImportingTsExtensions`，以及 `reporter.ts` 中若干 possibly undefined。未出现 World Engine / loader 相关错误。
- `Get-ChildItem -Path . -Recurse -Force -Filter '.world-engine-*.ts'`：无输出，没有残留临时模块文件。
- 静态扫描 `server/world-engine`、`reference/world-engine`、默认模板与根包级 schema helper：不再命中 `importFreshTypeScript`、`fresh-typescript-import`、`保持相对 import 语义`、`可按需拆分到独立文件`。
- `git ls-files --error-unmatch`：已能命中本轮新增 importer、Round 03-07 walkthrough、WorldIssue catalog / reference 相关新增文件，避免 runtime/doc 文件漏提交。

## 与计划出入

本轮额外用 TypeScript AST 捕获 type-only import、TS import type expression 和非静态 dynamic import / require。原因是 esbuild 会擦除部分类型层引用，也无法证明运行时拼接出来的 specifier 符合单文件契约；这不是放宽契约，而是让“强制单文件”更一致。

## 待完成

- `bun run typecheck` 的剩余失败属于既有 `llmlint` skill 类型问题，不在本轮 World Engine loader 范围；若后续要让全仓 typecheck 绿，需要单独修该 skill。
