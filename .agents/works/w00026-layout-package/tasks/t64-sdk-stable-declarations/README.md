---
schema: nbook.task/v2
taskId: t64-sdk-stable-declarations
status: planned
updated: 2026-11-26
---

# 插件 SDK 的声明两次构建字节相同

## 目标与范围

build:sdk 的 components.d.ts 不再随构建变（组件属性的先后）：改成先 vue-tsc 一次出全部声明、再只打包声明，同 nb-layout 的 build:package；整轮重跑发布时发布计划不再误报

合同：行为不变（SDK 的公开面与快照 `src/sdk/*.txt` 不变）；判据是同一份源码两次 `build:sdk` 的产物逐文件相同。来由：Work 的“后续”第 1 条，[t47 探针](../t47-build-pipeline/evidences/probes.txt)第 3 节。

## 当前状态

2026-11-26 主会话在 master 上复现：连跑两次 `build:sdk`，只有 `components.d.ts` 不同（10 行，组件属性 `size` 在类型字面量里的先后），根因同 nb-layout 在 t47 修过的：`rolldown-plugin-dts` 的 `vue: true` 按文件处理先后给字面量类型编号。

## 计划

- `packages/neuro-book/plugin-sdk/pack.ts` 的库声明（第 431 行一带 `dts({... vue: true, emitDtsOnly: true})`）改成 nb-layout `scripts/pack.ts` 的 `buildTypes` 做法：先用 Node 跑 `vue-tsc` 一次把这些入口要的全部声明出到包目录下固定的临时目录（`//#region` 注释带相对路径，位置要固定），再用 `dts({dtsInput: true, emitDtsOnly: true})` 只打包 `.d.ts`，用完删临时目录。`tsconfig.web.json` 与 `typePaths()` 的路径映射照旧要生效（vue-tsc 用的 tsconfig 可以另写一份继承它、只开声明输出）。
- 后面的两步照旧：nb-ui 的模板类型补充插回 `components.d.ts`、`tagLayoutComponents`。构建预设（`build.ts`、`cli.ts`，不含 `.vue`）那次 `dts` 不用改，除非两次构建也不同。
- 判据：同一份源码连跑两次 `build:sdk`（两个输出目录），除 tarball 外逐文件相同；与改前的产物比，声明的内容只差字面量的先后（不能少导出、少类型），`bun test src/sdk` 与快照不变；工作树干净时 `prox bun run release:smoke` 通过（含 `bunx -p @notnotype/nb-plugin-sdk nbooke create` 生成插件、构建与类型检查）。

## 下一步

派 coder 照“计划”实施，主会话验收合入。
