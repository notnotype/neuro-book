---
schema: nbook.task/v2
taskId: t63-plugin-activation-trigger
---

# 插件触发自己定义的激活事件

## 目标与范围

来源：开发者 2026-10-08 在 t62 计划后的讨论中决定。t52 实现了拥有者定义的激活事件（插件以 `activationEventPrefixes` 声明前缀，别的入口写 `activationEvents: ["<前缀>:<参数>"]`，拥有者请内核触发时激活它们），但只做了内核与宿主一侧：触发接口 `PluginHost.triggerActivationEvent(事件, {requester})` 只有宿主拿得到，插件的激活上下文里没有入口；`requester` 是调用方自报的插件 id；产品里没有一处使用，贡献命令的入口只能启动即激活。开发者选择补上插件一侧，不删除这个机制，但等第一个真实使用者出现时一起做。

1. **插件触发入口**：激活上下文提供触发本插件所拥有前缀的事件的接口（例如 `context.activation.trigger("<前缀>:<参数>")`），内核按当前入口所属的插件认定拥有者，不再收调用方自报的 `requester`；宿主一侧的接口是否保留，开工时按当时的用法定。
2. **第一个使用者**：`nbook.commands` 拥有 `onCommand` 前缀，命令面板照常从声明列出命令，执行时才触发 `onCommand:<命令 id>` 激活贡献方；贡献命令的入口不必再启动即激活。应用包 `AGENTS.md` 里“还没有按命令触发的激活事件，贡献命令的入口要启动即激活”一句随之改写。
3. **示例**：t62 的 `menu`、`file-menu` 改为打开菜单时才激活贡献方，演示这一机制。

可能涉及的行为合同：[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 输出第 21 条、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

[t61](../t61-kernel-catalog-failure-codes/README.md)、[t62](../t62-plugin-examples-in-app/README.md) 完成；`nbook.commands` 需要按需激活贡献方时开工。

## 当前状态

未开工：2026-10-08 先建，记下已确认的方向。开工时按当时的代码与 Spec 修订范围，按 [implementation-planning](../../../../skills/implementation-planning/SKILL.md) 写 `plan.md`，交开发者确认后再实施。
