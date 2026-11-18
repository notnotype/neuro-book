---
schema: nbook.task/v2
taskId: t20-startup-required-base-plugins
status: planned
updated: 2026-11-18
---

# 启动必需只留基础插件

## 目标与范围

现在服务端把第三方以外的全部插件列为启动必需（packages/neuro-book/src/server/start.ts 的 requiredPlugins，w00027 t03 起），必需插件的入口不看 activationEvents、启动时全部激活：贴纸、剧情、Agent 这类可选功能激活失败一次，整个服务端就起不来，它们声明的懒激活也不起作用。改成只有基础插件（state、settings、storage、files、projects、commands 与宿主插件）启动必需，其余按激活事件激活，失败显示在插件页；顺手改正 docs/specs/runtime/server-host.md 里过时的必需插件数。用户停用内置插件不做（开发者 2026-11-18：内置插件是应用的一部分，接受取舍）。来源：w00043 的耦合审查汇总（.agents/works/w00043-neurobot/research/2026-11-18-coupling-audit.md）；开发者 2026-11-18 定以后再做，现在启动不慢。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-18 经 nbdev 新建，尚未开工。

## 下一步

待补充。
