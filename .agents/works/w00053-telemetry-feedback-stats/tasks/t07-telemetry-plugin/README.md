---
schema: nbook.task/v2
taskId: t07-telemetry-plugin
status: planned
updated: 2026-11-24
---

# 遥测插件

## 目标与范围

nbook.telemetry：告知记录与各形态的告知时机、开关的层次、每日上报与在线心跳与立即事件、查看将要发送的内容、非发行构建不发；首批一级只有稳定性一类。

合同：[`telemetry.client`](../../../../../docs/specs/telemetry/client.md)、[`telemetry.protocol`](../../../../../docs/specs/telemetry/protocol.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：`nbook.telemetry` 插件：告知记录与各形态的告知（首次启动向导加一页、工作台里的非模态告知）、三个设置与设置页、每日上报与重试、在线心跳、立即事件、“查看将要发送的内容”、清单变更的处理、只有发行构建发。

前置：[t06](../t06-stats-plugin/README.md)（只读接口）；收集清单的包在 w00037 的脚手架里建，端到端的验证要 [w00037 t06](../../../w00037-official-site/tasks/t06-telemetry-ingest/README.md)。告知的文字要 [t08](../t08-terms/README.md) 的遥测说明。向导的新一页与设置页是界面，要先过设计评审。

## 下一步

开工时写实施计划。
