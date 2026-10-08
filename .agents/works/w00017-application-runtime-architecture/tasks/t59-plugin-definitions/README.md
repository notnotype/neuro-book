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

2026-10-08 完成。计划经开发者确认；omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）6 条发现已吸收进计划；S0–S4 已实现，omp 实现审查 3 条已修正。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `2aab9e25` | ADR 0026；ADR 0025 标为被 0026 取代，索引同步 |
| S1 | `06847f12` | 内核按运行位置判服务 id 不重复；`plugins.md`、`plugin-manifest.md` 修订并补场景。把唯一性改回跨全部入口的变异被新用例抓住 |
| S2 | `e862b1e0` | 宿主能力 `stateRootKey`、`windowNavigationKey`（`src/shared/host.ts`），`currentProjectKey` 移到 `src/shared/projects.ts`；插件定义改为常量（`commandsPlugin` 与 `storageBackendPlugin` 各含两个位置的入口）；三个宿主各分定义表与宿主适配器的工厂表；“打开项目”的测试改为经命令服务在真实浏览器内核里执行、导航记在宿主能力上；Storage 补缺能力受阻用例；随片的 Spec 与 AGENTS 修订，`projects.md`、`commands.md` 的“证据”一节与正文 Task 引用一并清理 |
| S3 | `8930532b` | 示例插件改为常量（`clockBackendPlugin` 等）；示例宿主给出时钟能力 `example/clock`（键在 `examples/shared/host.ts`），`Stage` 收 `capabilities`；场景 1 补“宿主不给时钟时 clock 受阻”。让 clock 绕过宿主能力直接读系统时间的变异被场景 1 抓住 |
| S4 | `55412a3c` | omp 实现审查（[evidences/impl-review.txt](evidences/impl-review.txt)）重要 2、建议 1，全部成立并修正：浏览器宿主装配时核对表项与定义的插件 id，不一致即启动失败（原来会装进引导集合之外的插件）；三端宿主适配器表的键收窄到适配器 id（原来任意键都能放，普通插件可以借工厂拿宿主上下文）；`commands.md` 删去“命令服务的键由宿主交进来”的旧句。`window.test.ts` 补 id 错配一例与适配器表的编译期反例，去掉 id 核对、把表放宽为任意键的两个变异分别被抓住。计划审查的复审（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）剩 1 条建议：验收映射改写为 Spec 条目，已改 |

实施中两处偏离计划：`currentProjectKey` 原在项目宿主目录（`src/project/current-project.ts`），Storage 的项目入口依赖它就得引用宿主目录，所以移到 `src/shared/projects.ts`，宿主能力的键都在 `src/shared/`。示例的时钟能力 id 由 `example.host/clock` 改为 `example/clock`，与应用包的 `nbook/…` 同一写法。

收口验证在 `48cbc7fb` 上运行（其后已有 t56 的文档与 store 两个提交，它们改了 `bun.lock`，所以 `--since 079f7544` 选中了全部包）：

- [test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)：内核 286 例、应用 294 例与组件 57 例、各包类型检查通过。另有三个本 Task 没碰过的包失败：llmlint 的 vitest 找不到 `web/` 的 tsconfig、nb-ui 的 colorway 测试里 `localStorage` 未定义、neuro-book-test-support 的超长路径断言依赖本机临时目录的长度；这三个包的代码与依赖版本都没变，只是因为 `bun.lock` 改动才被选中运行，不是本 Task 引入的。
- [test-e2e.txt](evidences/test-e2e.txt)：44/45 通过；失败的是开发会话里 Lab 命令场景的首次加载，追踪里是 Chrome 的 `net::ERR_INSUFFICIENT_RESOURCES`（开发模式下 Lab 页一次请求大量未打包的模块），单独重跑该文件 11 例全部通过。S2 时的完整运行 45 例全部通过。
- [smoke-server.txt](evidences/smoke-server.txt)：S1–S8 全部 `ok`。
- `docs:check`、`governance:check` 无失败。

