---
schema: nbook.task/v2
taskId: t59-plugin-definitions
---

# 插件定义统一为常量，宿主的东西走宿主能力服务

## 目标与范围

开发者 2026-10-08 问插件工厂参数的作用后同意统一：普通插件没有工厂参数、定义是常量，时钟、整页导航、Storage 的库目录这类宿主的东西改为宿主能力服务；只有 `nbook.http`、`nbook.diagnostics` 这类宿主自己的基础设施插件保留工厂；`nbook.commands` 一份定义声明两端入口。让内置插件与以后按清单装载的第三方插件拿宿主的东西走同一条路。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

[t58](../t58-service-ids-backend-dir/README.md)（服务键按 id 识别、`backend/` 目录）；t58 的 omp 审查修正完成后再实施。

## 当前状态

2026-10-08 计划经开发者确认；omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）6 条发现已吸收进计划，按 S0–S4 实施中。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `2aab9e25` | ADR 0026；ADR 0025 标为被 0026 取代，索引同步 |
| S1 | `06847f12` | 内核按运行位置判服务 id 不重复；`plugins.md`、`plugin-manifest.md` 修订并补场景。把唯一性改回跨全部入口的变异被新用例抓住 |
| S2 | `e862b1e0` | 宿主能力 `stateRootKey`、`windowNavigationKey`（`src/shared/host.ts`），`currentProjectKey` 移到 `src/shared/projects.ts`；插件定义改为常量（`commandsPlugin` 与 `storageBackendPlugin` 各含两个位置的入口）；三个宿主各分定义表与宿主适配器的工厂表；“打开项目”的测试改为经命令服务在真实浏览器内核里执行、导航记在宿主能力上；Storage 补缺能力受阻用例；随片的 Spec 与 AGENTS 修订，`projects.md`、`commands.md` 的“证据”一节与正文 Task 引用一并清理 |
| S3 | （待提交） | 示例插件改为常量（`clockBackendPlugin` 等）；示例宿主给出时钟能力 `example/clock`（键在 `examples/shared/host.ts`），`Stage` 收 `capabilities`；场景 1 补“宿主不给时钟时 clock 受阻”。让 clock 绕过宿主能力直接读系统时间的变异被场景 1 抓住 |

实施中两处偏离计划：`currentProjectKey` 原在项目宿主目录（`src/project/current-project.ts`），Storage 的项目入口依赖它就得引用宿主目录，所以移到 `src/shared/projects.ts`，宿主能力的键都在 `src/shared/`。示例的时钟能力 id 由 `example.host/clock` 改为 `example/clock`，与应用包的 `nbook/…` 同一写法。
