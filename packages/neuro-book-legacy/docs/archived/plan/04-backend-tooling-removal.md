# 阶段 4：旧后端与 agent tools 移除

## 目标

在文件树基础设施可用后，硬删除 VFS 抽象、旧 lorebook CRUD/API/UI/tools，并移除 chapter / volume 专用 agent tools。Prisma schema 与 Plot 的 `chapterId` 兼容层不在本阶段处理。

## 移除顺序

### 1. 停用专用 agent tools

从 agent tool 注册表与导出入口移除：

- lorebook 创建、更新、移动、删除、搜索、读取、列表 tools。
- chapter / volume 创建、移动、树读取 tools。
- 文档读写提示中关于 `db://chapter`、`db://lorebook`、`vfs://novel` 的推荐说明；只保留“旧路径不支持”的禁用提示。

替代说明：

- 浏览使用 `execute_shell("bun scripts/workspace-ls.ts ...")`。
- 创建使用 `execute_shell("bun scripts/workspace.ts new ...")`。
- 校验使用 `execute_shell("bun scripts/workspace.ts validate")`。
- 编辑使用通用文件工具。

### 2. 删除 VFS

移除或废弃：

- `db://chapter/<id>`
- `db://lorebook/<id>`
- `vfs://novel/...`

删除 `server/vfs/*`。通用文件工具只接收真实项目路径。路径仍需做项目根目录逃逸校验。

### 3. 后端 API 清理

删除旧 lorebook CRUD API：

- `/api/novels/:id/lorebook`
- `/api/novels/:id/lorebook/tree`

暂保留旧 chapter / volume API：

- `/api/novels/:id/chapters`
- `/api/novels/:id/volumes`

原因是 Plot 与 Bookshelf 仍依赖它们；删除需要独立迁移 Plot 的 `chapterId/chapterSortOrder`。

### 4. 数据库职责收缩

lorebook 内容不再作为数据库主存储。本阶段不删除 Prisma 表，避免和 Plot 引用、历史迁移混在同一补丁。

数据库可以继续保留：

- agent thread。
- checkpoint。
- 模型与设置。
- 暂未迁移的 plot 状态。

## 注意事项

- 不删除数据库表。
- plot 当前仍有 `chapterId` 关联，本阶段只保证 Plot 入口仍能打开。
- agent drawer 主入口传空 `selectedChapterId`，后续再把 agent scope 切到 active file。
- execute_sql 的安全提示需要更新，避免继续建议使用旧 chapter/lorebook tools。
- World / Character 旧入口从主侧栏移除，后续用 workspace 文件树重建。

## 第一版验收

- agent tool 列表不再暴露旧 chapter/lorebook 专用 tools。
- 通用文件工具不再解析 `db://` 与 `vfs://`。
- 前端主 IDE 不再调用旧 lorebook CRUD API。
- 访问旧 lorebook API 返回 404。
- `bun run typecheck` 通过。

