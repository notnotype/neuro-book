---
schema: nbook.task/v2
taskId: t61-kernel-catalog-failure-codes
---

# 远程提供方查询与失败码收敛

## 目标与范围

来源：开发者 2026-10-08 在 t60 的讨论与决定。

1. **提供方查询与 `not-provided`**：远程调用增加失败码 `not-provided`，让调用方分清“没装这项功能”和“暂时不可用”；内核提供不激活提供方的查询 `context.remote.lookup`，回答别的实例是否提供某份远程合同。[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md) 的“可选功能”随之改写。原记的“本实例有哪些插件与服务”的查询不做（开发者 2026-10-08 确认，理由见 [plan.md](plan.md)）。
2. **写请求结果未知时的失败码**：写请求的帧已发出、ACK 还没回来就断线时，现在报 `unavailable`（确定失败），服务端其实可能已经执行，store 的重试可能把同一次修改做两次。改为帧发出后断线、超时或取消的写请求一律报 `unknown-outcome`（t56 汇报时提出，开发者同意并入本 Task）。进程内链路增加模拟网络中断的 `cut()` 覆盖这种时序。
3. **作者 API 的取服务写法与内核一致**：`plugin-api.md` 的 `ctx.services.require(id)`（字符串 id、返回转发器、未声明时返回 `undeclared-service` 失败值）改为内核的 `context.services.require(键)`（提供方 `shared/contracts.ts` 里的键对象，返回服务本身，未声明时抛错）。同一张表里的 `ctx.config`、`ctx.secrets` 随 K6 配置改，不在本 Task。
4. **同步服务只限内置插件**：`CommandService` 的 `get`、`list`、`isEnabled` 与 `PublicStateService` 的 `read`、`declaration` 是同步的，按选用规则只限内置插件之间使用；在两个服务的注释与 [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`state/public-state.md`](../../../../../docs/specs/state/public-state.md) 里写明。第三方读公开状态的异步写法随第三方 API 设计。

可能涉及的行为合同：[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、`plugin-api.md`、`workbench/commands.md`、`state/public-state.md`。

## 前置

[t60](../t60-plugin-api-ergonomics/README.md) 完成。

## 当前状态

2026-10-08 完成。计划经开发者确认；omp 计划审查（[evidences/omp-plan-review.md](evidences/omp-plan-review.md)，9 条）与实现审查（[evidences/omp-impl-review.md](evidences/omp-impl-review.md)，4 条）全部成立并已处理，处理与对应提交记在计划末尾的“实施中的调整”。原记的“本实例的插件与服务目录”不做；插件一侧的激活事件触发另记为 [t63](../t63-plugin-activation-trigger/README.md)。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `b620d521` | `runtime/plugin-channel.md`、`plugin-api.md`、`workbench/commands.md`、`state/public-state.md`、`storage/persistence.md` 与拓扑稿的决策记录；两个服务合同注明同步读取只限内置插件 |
| S1 | `038abd76` | 请求阶段改为 `undispatched`、`sent`、`acked`，写请求从帧发出起被中断即 `unknown-outcome`；进程内链路加 `cut()` |
| S2 | `9274b17f` | 没有提供方为 `not-provided`，声明它的插件正在停止仍为 `unavailable`；`runtime/` 开头的合同 id 留给内核 |
| S3 | `e25aa86c` | `context.remote.lookup(合同, 目标?)`：经 `runtime/catalog` 查询，不激活提供方，调用方种类先于版本核对 |
| 计划审查修正 | `a7aaca55`、`1fdf31ef`、`26e940a9`、`b9506967`、`3ab9df51` | 门面工厂重入后不再执行方法；wire 升为 4；打开项目时登记结果未知的文案；激活产出的合同必须是声明的那一个；ACK 丢失逐跳覆盖 |
| 实现审查修正 | `12e0011a`、`0fe5ad99`、`98ddabe4` | 调用与查询共用候选选择；订阅随订阅方停止取消、编码途中取消的写请求结果未知；重复声明同一合同 id 登记即拒绝 |

收口验证（实现审查修正与 t62 合回之后，HEAD `98ddabe4`）：

- [test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)：`--since 3cd7b386` 选中内核与应用，内核 299 例、应用 333 例与组件 57 例、两包类型检查通过。
- [test-e2e.txt](evidences/test-e2e.txt)：应用 e2e 48 例全部通过。
- [smoke-server.txt](evidences/smoke-server.txt)：S1–S8 全部 `ok`。
- `docs:check`、`governance:check` 无告警。

未验证：真实 WebSocket 在 ACK 在途时中断的时序没法稳定制造，由进程内链路的 `cut()` 按同一语义覆盖；查询与 `not-provided` 在真实浏览器里的界面用法由 t62 的示例在进程内演示，还没有产品界面使用。
