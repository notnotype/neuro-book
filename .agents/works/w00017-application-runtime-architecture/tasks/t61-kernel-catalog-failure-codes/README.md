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

进行中：实施计划见 [plan.md](plan.md)，开发者 2026-10-08 确认。
