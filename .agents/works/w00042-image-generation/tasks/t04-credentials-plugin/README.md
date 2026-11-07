---
schema: nbook.task/v2
taskId: t04-credentials-plugin
status: planned
updated: 2026-11-06
---

# 凭据插件

## 目标与范围

把凭据库从 nbook.models 抽成独立插件，模型与图像共用；第一版只做 API Key，OAuth 以后单加。同步改模型服务 Spec 与平台提案里的相关规则。

凭据库文件路径不变，不用迁移。“密钥不出 `nbook.models`”改成“密钥不出服务端、不进浏览器”。合同：改 [`models/service.md`](../../../../../docs/specs/models/service.md)，同步平台提案第 195、379 行与 [`plugin-manifest`](../../../../../docs/specs/runtime/plugin-manifest.md) 的示例。

## 当前状态

2026-11-06 经 nbdev 新建，尚未开工。

## 下一步

读 `packages/nb-harness/src/models/credentials.ts` 与 `nbook.models` 的入口，写计划。
