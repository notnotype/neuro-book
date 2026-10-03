# Round 203: Preview Project 默认标题与 slug 可读性

## 背景

P0 真实驾驶测试记录到独立 `/world-engine.preview` 新建 Project 后的默认标题和目录 slug 难读：

- 标题形如 `世界引擎试用 2026620`，日期缺少分隔。
- slug 形如 `workspace/shi-jie-yin-qing-shi-yong-2-0-2-6-6-2-0`，数字被逐字拆开。

这会影响作者在 Project 下拉或列表中找回刚创建的试用 Project。该问题不依赖 P2 分叉，因此作为 P1 体验小修处理。

## 本轮目标

- Preview 默认 Project 标题使用带分隔的本地日期时间。
- Project slug 生成保留连续英文 / 数字片段，不再把日期数字逐字拆开。
- `/api/projects` 和旧兼容 `/api/novels` 使用同一套 slug 基础名生成逻辑。

## 实际变更

- `app/pages/world-engine.preview.vue`
  - 新增 `formatPreviewProjectTitleTimestamp()`。
  - 默认标题从 `世界引擎试用 2026620` 改为类似 `世界引擎试用 2026-06-20 23-56`。
- `server/workspace-files/novel-workspace.ts`
  - `buildWorkspaceSlugBase()` 改为先用 `pinyin-pro` 转写，再保留连续英文 / 数字段。
  - 中文拼音仍按音节分隔，例如 `世界引擎试用` -> `shi-jie-yin-qing-shi-yong`。
  - 日期时间会生成 `2026-06-20-23-56` 这种可扫读片段。
- `server/api/projects/index.post.ts`
  - 新建 Project 时改用 `buildWorkspaceSlugBase()`。
- `server/api/novels/index.post.ts`
  - 旧兼容新建入口同步改用同一 helper，避免两个入口 slug 规则漂移。
- `server/workspace-files/novel-workspace.test.ts`
  - 覆盖中文 + 日期、英文 + 数字和空标题 fallback。
- `app/utils/world-engine-ide-entry.test.ts`
  - 钉住 Preview 默认标题使用格式化时间戳。

## 验证

- `bunx vitest run server/workspace-files/novel-workspace.test.ts`：通过，1 test。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，1 test。
- `bun run typecheck`：通过。

## 与计划出入

- 原 P0 记录把该项列为 P2/UX；实际判断它不依赖分叉，且直接影响作者找项目，因此提前作为 P1 小修完成。
- 本轮没有自动浏览器验证；仍需用户明确允许后再复验 Preview 新建 Project 的真实展示。

## 后续

- P1 清单中已修：下一条写入默认撞同 instant、写入 / 编辑后 State Query 不刷新、同 instant 错误暴露工具名、Timeline 操作不可见、Project 列表污染、默认标题 / slug 难读。
- 后续主线应转向 P2 append-only 分叉计划；动手实现前必须先提交 Prisma schema / repository 查询 / API Agent 行为迁移计划并等待用户确认。
