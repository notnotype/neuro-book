---
schema: nbook.task/v2
taskId: t01-command-contracts
role: leader
---

# 命令系统规范收窄与任务重排

## 目标

把 `docs/specs/workbench/commands.md` 与 `quick-open.md`（均为 `planned`）原位修订为本轮收窄后的行为合同，并同步提案、组件标准与 nb-ui 开发规范；旧 t01–t08 任务已删除并重排为 t01–t06。

## 范围

1. `commands.md`：第一批目录只保留本批六个命令（`nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line`、`nbook.quick-open.open-commands`、`nbook.quick-open.open-line`）；删除活动栏/桌面 15 别名接线/save/`Mod+S`/文件打开/`Mod+P`/视图派生命令等本批不交付的验收承诺，保留 alias 机制与域词表；快捷键冲突段改为「同规范化键两环境均不启用后来绑定、报告一次」；`readOnly/destructive` 提示与 `effect` 阻断语义分开。
2. `quick-open.md`：把「无前缀=实体」「MRU 持久化」「损坏 Storage 回退」「后续主页面接入」从本轮输出/状态/验收移除，改为命令/行号两模式、Lab 会话内 MRU、关闭后焦点交接；`@` 保持明确非目标。
3. `docs/proposals/workbench-commands.md` 本批交付段同步。
4. `docs/standards/code/components.md` 增补宿主命令契约写法（宿主发出、组件响应、状态通过既有通道上报）与 CodeEditorView 文档链接。
5. nb-ui `docs/ui-development-spec.md` 与 `docs/design-language.md` 原位记录 S4 role/9200、modal 键盘、QuickInput 公共 API 与打开动效/关闭交接；`README` 公开组件清单加入 QuickInput。

## 验证

- 文档互相链接可达，无「本批不做」条目仍留在验收中；`git diff --check` 通过。
- 与实现后的实际接口一致（t02–t05 完成后回看）。

## 边界

- 不改产品代码；不新增旁路规范；不把 `@` 或文件搜索写成已交付。

## 依赖

无。
