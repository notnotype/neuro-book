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
| 2026-11-27 | 开发者同意（资源管理器的注意力排序，参考了 `@designer` 的意见）：1. 分三组、组间一条淡分隔线、不加组标题：作品（项目、用户资产）、Agent（会话、Profile 笔记、临时文件）、参考资料（Skill、表情、文档）；2. 首次只展开“项目”，当前会话由跟随展开到 `home/`，之后记住手动展开状态；3. 根用中文名，不显示方案名，悬停与“复制路径”时用；4. 会话根：当前会话置顶、再列最近 10 个、末尾“显示更多（还有 N 个）”，不按日期分组；5. 会话展开后 `home/` 与 `session.jsonl` 都露出，`home/` 在前并连带展开，`session.jsonl` 调淡、标只读；6. 跟随当前对话只把当前会话滚进视野，不收起别的目录，拖动、改名、输入时不跳 |

## 待确认

- 挂载点那一层（某个会话、某个 Profile 的目录本身）不能改名、删除。先按此定。
- 浏览器可以改 `home/` 下的全部文件，包括宿主写的 `attachments/`、`artifacts/`、`jobs/`；删了附件，消息里的图会显示为不存在。先按此定。

## 当前状态

2026-11-27 写好[计划](plan.md)；注意力排序已定，出第一轮静态稿与评审板。

## 下一步

开发者确认计划后，开 Work 分支与 worktree，从切片 1（编辑器入口拦截）开始。
