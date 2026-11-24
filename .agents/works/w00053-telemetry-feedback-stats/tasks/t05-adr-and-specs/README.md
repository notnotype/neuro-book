---
schema: nbook.task/v2
taskId: t05-adr-and-specs
status: planned
updated: 2026-11-24
---

# 本机统计与遥测的 ADR 与 planned Spec

## 目标与范围

提案接受后，把长期决定写成 ADR，把本机统计、遥测（含收集清单与上报协议）写成 planned Spec，并给诊断的 Spec 加本机观察接口；按切片逐份写。动笔前把能力地图与每份 Spec 的假设交开发者确认。

合同：本 Task 的产出就是合同：[`telemetry.protocol`](../../../../../docs/specs/telemetry/protocol.md)、[`telemetry.client`](../../../../../docs/specs/telemetry/client.md)、[`stats.local`](../../../../../docs/specs/stats/local.md)，以及 [`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 里标着“（planned）”的本机观察一条。统计模块服务端的两份 Spec 在 [w00037 t04](../../../w00037-official-site/tasks/t04-adr-and-specs/README.md)。

## 当前状态

2026-11-24：开发者接受了提案与能力地图，要求先把 ADR、Task 与文档都写好。已写：ADR 0062，三份 `planned` Spec 并登记进注册表，诊断的 Spec 加了一条，`docs:check` 通过。Spec 没有另请审查者审。

## 写 Spec 时主会话替开发者选的假设（按“待确认默认追认”，有异议再改）

1. 运行形态只有 `desktop` 与 `cli` 两种取值（浏览器里打开的是 `cli` 起的服务）。
2. 大区分八个；次数分档是 0、1、2 到 4、5 到 9、10 到 49、50 以上；服务端日按 UTC。
3. 请求体至多 16 KiB；重发去重 48 小时。
4. 第一版的使用档只有“稳定性”一类（错误码计数、崩溃、升级结果）。
5. 在线心跳只在最近 15 分钟内有窗口连着并有过用户操作时发。
6. 每日上报失败后 1 分钟起逐次加倍重试，间隔至多 6 小时，存下超过 48 小时丢弃。
7. 使用档新增类别时“使用统计”的开关回到关，要用户重新打开。
8. 本机统计按机器的本地日期归日；异常退出时至多丢最后 5 秒的记数；设置里可以清除全部统计数据。
9. 第一版不做“别的插件往仪表盘加自定义卡片”的贡献点，只有指标声明这一个贡献点；仪表盘固定显示字数、模型用量与日历热力图。开发者 2026-11-23 提过仪表盘要有贡献点，11-24 说其它图不是重点、先有底层数据，这里按后一句处理。
10. 没有任何界面的运行不显示告知，所以不发。

## 下一步

开发者说开工后，应用这边从 [t06](../t06-stats-plugin/README.md) 开始。
