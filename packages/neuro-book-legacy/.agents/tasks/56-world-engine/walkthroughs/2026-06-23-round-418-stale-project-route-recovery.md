# Round 418 - 已删除 Project 旧链接的前端恢复

## 背景

Round 417 已把 Project Workspace 缺失目录从未处理 `ENOENT` 收敛为稳定 `404 Project Workspace 不存在`，并确认新建 Project 后刷新可进入 Workbench。

本轮继续补作者真实入口体验：如果作者从浏览器历史、收藏或复制链接打开一个已删除 Project 的 URL，页面不应停在“未选择小说”或继续用旧 `projectPath` 请求 config / 文件树 / World Engine。

## 问题

真实浏览器访问：

`/?project=workspace%2Fworld-engine-route-fix-1782206884039`

该 Project 已不存在。Round 417 后端会稳定返回 404，但前端仍可能先把 URL target 当成当前 Project 初始化，随后出现：

- 顶栏显示 `未选择小说`。
- URL 仍停在旧 Project。
- 打开 World Engine 时仍可能用旧 `projectPath` 打 `/api/projects/world-engine/*`，只得到 404。
- 作者看不到“发生了什么、现在切到哪里”的恢复反馈。

这属于真实旧链接 / 删除后回访路径，不是异常输入矩阵扩张。

## 代码变更

- `app/pages/index.vue`
  - `initializeWorkspaceFromRoute()` 在处理 `project` route target 时，先调用 `loadNovels({includeProjectPath: target.projectPath})`。
  - 如果返回列表中没有该 Project，则直接切到列表第一项或交给默认 Project 初始化，不再把已删除 Project id 交给 workspace 初始化。
  - 增加 `notifyProjectRouteFallback(target)`：
    - URL Project 不存在或已删除时，显示 `Project 已不可用` warning。
    - 文案说明旧 `projectPath` 已不可用，并告知已切换到当前可用 Project。
    - 同一旧 target 只提示一次，避免 route normalize / watch 重复弹。
  - 既有 `normalizeNovelRouteQuery()` 继续负责把 URL 规范到实际 Project。
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言：route 初始化先查列表、缺失时切 fallback、并显示恢复提示。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/stores/novel-ide.test.ts`
  - 2 files / 7 tests passed。

真实浏览器验收：

- 启动 `bun run dev -- --port 3001`。
- 打开旧链接：
  - `http://localhost:3001/?project=workspace%2Fworld-engine-route-fix-1782206884039`
- 页面自动规范为：
  - `http://localhost:3001/?project=workspace/world-tools-test-1782112300560-8e024c11bf56d`
- 顶栏显示实际 Project：
  - `World Tools Test`
- 页面出现 warning：
  - `Project 已不可用`
  - `Project workspace/world-engine-route-fix-1782206884039 不存在或已删除，已切换到 World Tools Test。`
- 点击 `WORLD`：
  - World Engine Workbench 可正常打开。

清理：

- 已关闭浏览器。
- 已停止 dev server。
- `3001` 无监听。

## 与计划出入

本轮按 Round 417 的前端恢复缺口推进，没有新增后端 API，也没有改 World Engine 内部工作流。实际修复范围比“只验证”多一点，因为浏览器验收证明旧链接仍会卡作者。

## 后续

- 当前恢复策略是“切到列表第一项并提示”。如果后续希望作者更明确地选择目标 Project，可以把恢复目标改成自动打开书架；这需要单独产品决策。
- 如果旧链接还带 `openPath`，后续可再观察是否需要丢弃 `openPath` 并提示，避免在 fallback Project 中打开同名路径造成误解。
