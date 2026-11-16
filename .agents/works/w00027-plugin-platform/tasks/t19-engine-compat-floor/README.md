---
schema: nbook.task/v2
taskId: t19-engine-compat-floor
status: active
updated: 2026-11-16
---

# 插件兼容起点：插件 API 没破时提产品版本不挡已构建的插件

## 目标与范围

宿主声明插件 API 的兼容起点，插件的 `engines.neurobook` 与“起点到当前版本”有交集就兼容；发布手册加提起点的一步。来源：开发者 2026-11-16 装插件时看到“插件要求 NeuroBook ^0.12.1，当前是 0.13.0”，认为 0.12 到 0.13 插件 API 没怎么变，应该能装。

合同：[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md) 的“兼容”、[`runtime/plugin-install.md`](../../../../../docs/specs/runtime/plugin-install.md) 的“产品版本”与 `incompatible-engine`、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md) 的 `engines.neurobook`；发布手册的“发版”第 2 步。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-16 | 开发者同意做法（w00032 会话里讨论）：根因是拿产品版本当插件 API 的版本，产品按功能提版（0.13.0 是桌面版首发）时所有插件都被挡；改为宿主声明兼容起点，按交集判断。否决只改构建缺省为下限（已发的插件照样被挡、以后破了没法拦） |
| 2 | 2026-11-16 | 开发者：做，排在 w00032 t29 之前 |
| 3 | 2026-11-16 | 起点取 0.12.1：0.12.0 到 0.12.1 之间 nb-ui 有改名（nb-ui 的 `migration-0.4`），0.12.1 之后 SDK 的导出只有新增（`agentSkills`、视图容器），nb-ui 组件的提交只有新增写法与新组件 |

## 当前状态

2026-11-16 实现，分支 `feat/w00027-t19-engine-compat-floor`（worktree `.worktree/w00027-t19-engine-floor`），提交 `e766b1f9e`：

- `PLUGIN_API_SINCE = "0.12.1"`（`src/shared/product.ts`），`product.test` 核对它是规范版本、不晚于产品版本。
- 平台档案加 `pluginApiSince`；`engineAccepts` 改为 `semver.intersects(范围, ">=起点 <=当前")`；安装与启动两处共用，说明由 `engineMismatch` 写（起点早于当前版本时带“兼容 X 起的插件”）。
- 测试：`plugins.test.ts` 加“兼容起点”一例（`^0.12.1`、`>=0.1.0`、`^0.13.0` 能装，`^0.11.0`、`^0.13.5` 不能装，说明的原文；起点提到 0.13.0 后重启，按 0.12 写的不再登记）。变异检查：判断换回 `satisfies(当前版本)` 时这一例失败。
- SDK 作者文档的“发布”、应用变更记录 `[Unreleased]` 的“改动”。Spec 与发布手册在主工作区。

验证：应用 `typecheck` 过；插件平台、产品常量、架构、插件页与构建预设的测试 94 过、1 失败（`builtin-names` 缺 `nbook.desktop`，master 上同样失败，与本 Task 无关）；发布脚本 `prepare.test.ts` 用 Vitest 跑 6 过（`bun test` 跑它会报运行器错误，master 上相同）。

没派独立审查：改动是一处判断、两处调用与档案的一个字段，测试与变异检查覆盖。

已合入 master（`bddff471d`，`--no-ff`），合入后在 master 上重跑插件平台与产品常量的测试都过；分支与 worktree 已删。

## 下一步

无。已发布的 0.13.0 里判断是写死的，下个版本才生效；在那之前，要求 `^0.12.1` 的插件要改范围（例如 `>=0.12.1 <0.14.0`）、提插件版本后重装。
