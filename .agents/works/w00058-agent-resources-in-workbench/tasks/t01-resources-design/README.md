---
schema: nbook.task/v2
taskId: t01-resources-design
status: planned
updated: 2026-11-27
---

# 设计：注册方案进浏览器、资源管理器与引用

## 目标与范围

Agent 写进 `session://`、`tmp://`、`profile://` 的文件，用户在资源管理器里看得到，在编辑器里能打开、修改；从对话里点文件不再让编辑区卡死。实现 [workspace/resources.md](../../../../../docs/specs/workspace/resources.md) 里 `(planned)` 的“浏览器访问已注册的方案”。

范围外（另开 Task）：Composer 的 @ 跨方案、拖到 Composer、Agent 用链接引用文件、`bots://`。

合同：改 `workspace/resources.md`、`agent/resources.md`、`workbench/files-explorer.md`、`workbench/editor.md`、`agent/conversation.md`，见[计划](plan.md)的“Spec 与文档改动”。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-11-27 | 开发者：除 `projects://` 外，注册方案都在资源管理器里显示 |
| 2026-11-27 | 开发者：挂载方案是真实目录，要支持改名、删除、移动、监视 |
| 2026-11-27 | 开发者同意：根固定、用全局地址；当前会话在 `sessions://`、`temps://` 里排第一并标出，当前 Profile 在 `profiles://` 里标出；切换对话时自动展开定位，可关；根本身不跟着会话换 |

## 待确认

- 挂载点那一层（某个会话、某个 Profile 的目录本身）不能改名、删除。先按此定。
- 浏览器可以改 `home/` 下的全部文件，包括宿主写的 `attachments/`、`artifacts/`、`jobs/`；删了附件，消息里的图会显示为不存在。先按此定。

## 当前状态

2026-11-27 写好[计划](plan.md)，等开发者确认。

## 下一步

开发者确认计划后，开 Work 分支与 worktree，从切片 1（编辑器入口拦截）开始。
