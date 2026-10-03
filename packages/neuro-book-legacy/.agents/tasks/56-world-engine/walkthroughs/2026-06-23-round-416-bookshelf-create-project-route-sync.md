# Round 416: 书架新建 Project 后同步 URL query

## 背景

Round 415 浏览器验收时观察到：通过书架新建临时 Project 后，顶栏已经切到新 Project，但 URL query 仍短暂停在旧 `projectPath`。这会影响刷新、复制链接、以及后续从 URL / deep link 进入 World Engine 的可靠性。

## 根因

`NovelBookshelfDialog.vue` 在新建后会调用 `createNovel()`、`switchNovel(newNovelId)`，再向父页面 emit `switched`，父页面用 `router.replace(buildProjectRoute(newNovelId))` 规范 URL。

问题在 store 层：`createNovel()` 创建成功后刷新 Project 列表时只调用 `loadNovels()`，没有把新建 Project 作为 `includeProjectPath` 传给 `/api/projects`。如果列表刷新没有立刻包含新 Project，页面 route watcher 会认为 URL 指向的 Project 不在当前列表中，后续可能把 URL 规范回旧 Project。

这和已有初始化逻辑是同一类问题：初始化时已经会用 `includeProjectPath` 保证 URL 指定 Project 被补进列表，新建 Project 后也应使用同样兜底。

## 实现

- `app/stores/novel-ide.ts`
  - `createNovel()` 创建成功后改为 `loadNovels({includeProjectPath: novel.id})`。
- `app/stores/novel-ide.test.ts`
  - 新增回归测试：新建 Project 后刷新列表会带 `includeProjectPath: "workspace/created-book"`，并确认本地 `novels` 列表包含新 Project。

## 验证

- `bunx vitest run app/stores/novel-ide.test.ts`
  - 1 file / 4 tests passed。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 3 tests passed。
- 真实浏览器窄复验：
  - 打开主 IDE。
  - 从书架新建临时 Project：`World Engine Route Fix 1782206884039`。
  - 提交后浏览器 URL 立即变为 `?project=workspace/world-engine-route-fix-1782206884039`。
  - 顶栏同步显示新 Project 标题。

## 与计划出入

- 原计划只验证 URL 同步；实际也尝试通过书架 UI 删除临时 Project。
- 删除确认时 Nuxt dev server 正在因本轮源码改动热重载，UI 删除请求被干扰，页面仍显示临时 Project。随后停止 dev server 释放句柄，并在确认目录名和路径都属于本轮临时 Project 后手动清理目录。
- 本轮没有重复跑完整 World Engine Workbench 作者流；Round 415 已覆盖默认模板、`world` 创建、`player` 同步和 slice 写入。本轮只针对新建 Project 后的 URL 同步回归。

## 清理

- dev server 已停止。
- `3001` 已确认空闲。
- 临时目录 `workspace/world-engine-route-fix-1782206884039` 已删除。
