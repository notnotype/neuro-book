---
schema: nbook.task/v2
taskId: t64-sdk-stable-declarations
status: done
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

## 结果

2026-11-26 完成，coder 子代理实施（`5141e6556`，变基后合入），主会话审 diff 并做了 master 对照：

- `plugin-sdk/pack.ts` 新函数 `buildLibraryDeclarations`：在 `dist/.sdk-types/` 写一份继承 `tsconfig.web.json` 的临时配置（入口进 `files`、`include: []`，因为 web 配置的 `exclude` 排掉了 `agent.ts` 这两个入口；`rootDir` 固定成 `packages/`；`noCheck`：语义检查是 `typecheck` 的事，声明输出的错误照样报），用 Node 跑 vue-tsc 一次出全部声明，再用 `dts({dtsInput: true, resolver: "tsc"})` 只打包 `.d.ts`（路径映射改指到临时目录里的声明），rolldown 有日志就失败，用完删临时目录。nb-ui 的模板类型补充与 `tagLayoutComponents` 照旧。
- 判据：改后连跑三次 `build:sdk` 逐文件相同、tarball 的 sha256 相同；与改前比，177 个声明 region 的集合逐字相同、14 个入口的导出名单逐一相同，差别是组件属性的先后与声明在内部共享块之间的分配（`.d.ts` 文件 28 个变 26 个、入口文件的 import 行变了）；作者侧类型检查的类型数 313505 变 313501。`bun test src/sdk` 与快照不变，应用 typecheck 过，提交后工作树干净时 `release:smoke` 过（含 `nbooke create` 构建与类型检查、`nbook plugin install`）。
- `pack.test.ts`：coder 在负载 20 下有 2 条 60 秒超时；主会话在负载 7 下单跑仍有 3 条超时，于是和 master 交替各跑两轮（负载 6.6 到 7.8）：master 第 1 轮 `icon` 那条超时、第 2 轮全过，分支两轮全过（各 13 条）。超时是作者项目里 `skipLibCheck: false` 跑 vue-tsc 撞 60 秒上限，master 上同样，不是这次的改动。
- 没做：同一个检出里并发跑两次 SDK 构建会互相冲掉临时目录（注释写明，没加防护）；共享块重新分配的成因只是推断。
