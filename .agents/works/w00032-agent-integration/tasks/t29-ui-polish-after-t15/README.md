---
schema: nbook.task/v2
taskId: t29-ui-polish-after-t15
status: planned
updated: 2026-11-06
---

# Agent 界面打磨：设置页服务商列表与可定制的状态栏

## 目标与范围

开发者 2026-11-06 体验后的反馈里与 [t28](../t28-conversation-ui-followups/README.md) 无关的部分，等 t28、t14、t15 做完后再优化。

设置的“服务商与模型”：

1. 删除服务商现在在右上角，不好。放到左侧服务商列表的条目里，或者做上下文菜单。
2. 服务商列表的条目太方，高度调小。

状态栏（开发者原话是“也可以考虑加”，开工时再定做哪些）：

3. 像 Claude Code 一样能自定义状态栏。
4. 缓存 TTL、五小时限额、七天限额。这些数字要服务商给：限额只有订阅登录的账号才有，t09 第一版不做 OAuth 登录；TTL 取决于服务商的缓存规则和最近一次写缓存的时间。开工时先查哪些服务商能拿到。

另外，开发者说还有一些界面错误，到时候慢慢调。

合同：改 [`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md) 与 [`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)。

## 当前状态

未开工。

## 下一步

t28、t14、t15 做完后开工。
