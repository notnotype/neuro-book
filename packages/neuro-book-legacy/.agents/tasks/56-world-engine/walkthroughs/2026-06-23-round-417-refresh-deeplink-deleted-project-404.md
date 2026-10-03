# Round 417 - 新建 Project 刷新验收与已删除 Project 旧链接 404

## 背景

Round 416 修复了书架新建 Project 后 URL query 可能停在旧 `projectPath` 的问题。本轮原计划只做一个窄浏览器验收：新建临时 Project 后刷新页面，确认 URL 和顶栏仍停在新 Project，并能打开主 IDE World Engine Workbench。

## 实际发现

验收前先访问了上一轮已清理的旧 Project URL：

`/?project=workspace%2Fworld-engine-route-fix-1782206884039`

该 Project 已被删除且物理目录不存在。`/api/config/bootstrap`、`/api/config/editor-snapshot`、`/api/workspace-files/tree` 等常用入口都会走 `assertProjectWorkspaceDirectory()`，而该函数此前直接 `fs.stat(projectRoot)`，缺失目录时没有把 `ENOENT` 转成稳定业务错误。dev server 日志出现未处理 `ENOENT`，并一度退出。

这不是畸形输入问题，而是作者真实使用中会遇到的旧链接 / 刷新 / 删除后回访路径：Project 已从列表消失，但浏览器地址、历史记录或持久状态仍可能指向旧 Project。

## 代码变更

- `server/workspace-files/project-workspace.ts`
  - `assertProjectWorkspaceDirectory()` 捕获 `ENOENT`，统一返回 `404 Project Workspace 不存在`。
  - 非目录仍保持 `400 projectPath 必须指向 Project Workspace 目录`。
  - deleted marker 目录仍保持 `404 Project Workspace 已删除`。
- `server/workspace-files/project-workspace.test.ts`
  - 新增一条回归测试：旧链接指向不存在 Project 时返回稳定 404。

## 验证

- `bunx vitest run server/workspace-files/project-workspace.test.ts server/workspace-files/project-workspace-delete.test.ts`
  - 2 files / 4 tests passed。
  - 删除测试中仍可见 Windows `Move-Item` 被 `project.sqlite` 句柄挡住后落到 deleted marker 的 warn，这是 Round 414 设计的兜底路径，不是失败。

真实浏览器验收：

- 启动 `bun run dev -- --port 3001`。
- 旧 Project config API：
  - `GET /api/config/bootstrap?workspaceKind=novel&projectPath=workspace%2Fworld-engine-route-fix-1782206884039`
  - 返回稳定 `404`，服务继续存活。
- 通过书架 UI 新建临时 Project：
  - `World Engine Refresh 1782209004170`
  - 创建后 URL 立即为 `?project=workspace/world-engine-refresh-1782209004170`。
- 刷新页面：
  - URL 仍为 `?project=workspace/world-engine-refresh-1782209004170`。
  - 顶栏仍显示 `World Engine Refresh 1782209004170`。
- 打开主 IDE World Engine：
  - Workbench 打开成功。
  - 可见 `world-subject-bootstrap-panel`。
  - 可见 `subject-system-sync-panel`，模板内置 `player` 待接入。

清理：

- 通过 `DELETE /api/projects/item?projectPath=workspace%2Fworld-engine-refresh-1782209004170` 删除临时 Project，返回 200。
- `/api/projects?includeProjectPath=workspace%2Fworld-engine-refresh-1782209004170` 不再返回该 Project。
- Windows 下物理目录按预期以 `workspace/world-engine-refresh-1782209004170/.nbook/deleted-project.json` marker 兜底残留。
- 已停止 dev server，`3001` 无监听。

## 与计划出入

原计划只做 Round 416 后的刷新 / deep link 验收；实际先撞到“已删除 Project 旧链接”的后端 404 边界缺口，因此增加了一个小后端修复和一条回归测试。没有继续扩大输入边界测试，也没有改前端。

## 后续

- 如果后续仍看到 deleted marker 物理残留，应继续检查后台清理生命周期，不要把作者删除动作重新卡到同步物理删除上。
- 旧链接现在后端会稳定返回 404；前端是否要在这种情况下主动切回可用 Project / 打开书架，是另一个产品体验问题，可后续单独设计。
