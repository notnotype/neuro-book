# Round 419 - 已删除 Project 旧链接携带 openPath 时丢弃文件路径

## 背景

Round 418 已让已删除 Project 旧链接恢复到可用 Project，并显示 `Project 已不可用`。但还有一个作者流风险：World Engine 的 schema / calendar 入口会生成带 `openPath` 的深链。如果旧链接指向已删除 Project，同时带着 `openPath=world-engine/schema.yaml`，页面 fallback 到另一个 Project 后可能打开 fallback Project 的同名文件，让作者误以为仍在原 Project 中编辑 schema。

本轮只处理这个恢复路径，不新增后端 API，不改 World Engine 内部工作流。

## 代码变更

- `app/pages/index.vue`
  - 增加 `discardOpenPathForProjectFallback`。
  - `initializeWorkspaceFromRoute()` 发现 route 指向的 Project 不在项目列表中时，标记本轮 fallback 需要丢弃 `openPath`。
  - `consumeWorkspaceOpenPathFromRoute()` 看到该标记时，只从 URL 中删除 `openPath`，不打开文件。
  - fallback warning 在旧链接带 `openPath` 时追加提示：`已忽略原链接中的文件路径。`
- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言：fallback 时设置丢弃标记、消费时删除 `openPath`、提示忽略原链接文件路径。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/stores/novel-ide.test.ts`
  - 2 files / 7 tests passed。

真实浏览器验收：

- 启动 `bun run dev -- --port 3001`。
- 打开旧链接：
  - `/?project=workspace%2Fworld-engine-route-fix-1782206884039&openPath=world-engine%2Fschema.yaml`
- 轮询观察 12 秒：
  - 第 1 秒：页面仍在初始恢复中，显示旧 URL 与 `未选择小说`。
  - 第 2 秒：URL 变为 `?project=workspace/world-tools-test-1782112300560-8e024c11bf56d`，`openPath` 已移除。
  - 第 2-5 秒：页面显示 `Project 已不可用`，并显示 `已忽略原链接中的文件路径`。
  - 顶栏显示 `World Tools Test`。
  - 未打开 `world-engine/schema.yaml` 内容，页面没有出现 schema 编辑内容。

清理：

- 已关闭浏览器。
- 已停止 dev server。
- `3001` 无监听。

## 与计划出入

本轮按 Round 418 后续观察点推进，实际改动很窄：只在 Project fallback 时丢弃 `openPath`，避免跨 Project 误打开同名文件。没有扩大 Project 删除、schema、World Engine API 的测试矩阵。

## 后续

- 旧 Project 恢复目前仍是“切到列表第一项”。如果作者觉得自动切换不够明确，再单独讨论是否改为打开书架让作者选择。
- 常规有效 Project 的 `openPath` 深链不受影响，仍用于 schema / calendar 真相源文件入口。
