# 阶段 5：迁移与验证清单

## 目标

将现有数据库中的 chapter / lorebook 内容导出为文件树，并在切换前后用脚本验证一致性。

## 迁移前准备

- 使用 `workspace/` 作为项目文件树根目录。
- 确定正文约定目录，例如 `manuscript/`。
- 确定设定约定目录，例如 `lorebook/`。
- 准备 `workspace/.nbook/icons.json`，用于迁移后文件树默认图标展示。
- 确认 `workspace-ls` 与 `workspace.ts new/validate/schema` 已可运行。
- 暂停会写 chapter / lorebook 数据库的 agent tools。

## 导出 chapter

导出规则：

- 原 Volume 变成目录。
- 原 Chapter 优先导出为目录节点 `index.md`，例如 `manuscript/001-开篇/001-雪夜/index.md`。
- `status`、`summary`、`characters`、`todos` 写入 frontmatter。
- `content` 写入 Markdown 正文。
- 原排序通过目录名前缀保留，例如 `001-标题/index.md`。

导出后检查：

- 文件数量等于原章节数量。
- 总字数大致一致。
- 每个文件 frontmatter 可解析。

## 导出 lorebook

导出规则：

- 原 `path` 映射为目录层级。
- entry 统一导出为目录节点 `index.md`。
- `type`、`status`、`aliases`、`tags`、`summary`、`retrieval`、`governance`、`refs` 写入 frontmatter。
- `content` 写入 Markdown 正文。

导出后检查：

- 文件节点数量等于原 lorebook entry 数量。
- 内容根目录内同一路径不存在 `.md` 与 `index.md` 冲突。
- refs 转换为 Markdown 相对路径。
- 迁移后 `lorebook/**/index.md` 的合法类型 entry 能显示 Lorebook detail。

## 引用迁移

旧引用：

```text
chapter://123
lorebook://101
db://chapter/123
db://lorebook/101
vfs://novel/...
```

新引用：

```text
../manuscript/001-开篇/001-雪夜/
../lorebook/location/神恩大陆/王国B/B-a城/孤儿院/
```

迁移要求：

- 建立旧 id 到新内容节点目录路径的映射表。
- 扫描 Markdown 正文、frontmatter refs、agent prompt 模板。
- 批量替换旧引用。
- 运行 `bun scripts/workspace.ts validate` 确认无断链。

## 切换步骤

1. 导出文件树。
2. 运行 `bun scripts/workspace.ts validate`。
3. 前端切换到文件树读取。
4. 停用旧专用 tools。
5. 停用 VFS。
6. 观察一轮真实编辑流程。
7. 确认稳定后再删除旧数据库主存储代码。

## 回滚策略

- 数据库表在第一轮切换后暂时保留。
- 导出脚本可重复执行到临时目录。
- 如果文件树编辑失败，可以临时恢复旧前端入口和旧 tools。
- 删除数据库表必须放在最后一个独立阶段。

## 验收

- `workspace.ts validate` 无 P1 问题。
- 前端能打开、编辑、保存导出的 `.md` 文件。
- 前端能点击导出的内容目录节点并自动打开对应 `index.md`。
- `.nbook/icons.json` 生效，内容节点图标按类型或 frontmatter 配置展示。
- agent 能通过脚本浏览并通过文件工具修改内容。
- 旧 id 引用不再出现在正文和 frontmatter 中。

