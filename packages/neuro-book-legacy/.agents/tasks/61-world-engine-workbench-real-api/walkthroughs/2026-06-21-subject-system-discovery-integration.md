# 2026-06-21 Subject System Discovery Integration

## Summary

- 用户指出上一轮“主体系统适配”仍然不够：Workbench 的主体系统摘要来源是 World Engine reduce state，而不是 NeuroBook 已有的 `simulation/subjects` 主体系统本体。
- 本轮把真实 Workbench 的主体系统来源改为 Project Workspace 文件系统 discovery：直接复用 `/api/projects/rag/overview` 读取 `simulation/subjects/*`。
- World Engine subject 表现在只用于判断连接状态：已连接、待接入或孤儿；不再把 World Engine state 当成主体系统事实源。

## Changes

- `shared/dto/project-rag.dto.ts`
  - `ProjectRagSubjectSummaryDto` 增加轻量 `metadata`：
    - `id / name / kind / profile / controlledBy / canonicalSource / frontmatterError`
  - 增加 `soulFileExists`，让 overview 覆盖六文件主体系统的关键文件存在性。
- `server/rag/project-rag-visualization.ts`
  - `readProjectRagOverview()` 读取每个 `simulation/subjects/{id}/subject.md` 的 YAML frontmatter。
  - 继续只读轻量 metadata 与计数，不暴露 `subject.md / soul.md / mind.md / state.md` 正文。
- `app/utils/world-engine-workbench-real.ts`
  - 新增 `buildWorldWorkbenchSubjectSystemSummariesFromRagOverview()`：从真实 RAG overview 生成 Workbench 主体系统摘要。
  - 新增 `mergeWorldWorkbenchSubjectsWithSubjectSystem()`：左栏以 World Engine subjects 为底，补上尚未注册到 World Engine 的 `simulation/subjects`。
  - Workbench 视图排除模板 `sample-npc`，避免示例主体进入当前项目世界。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 加载真实 Workbench 时并行读取：
    - `/api/projects/world-engine/schema`
    - `/api/projects/world-engine/subjects`
    - `/api/projects/world-engine/slices`
    - `/api/projects/rag/overview`
  - `subjectSystemSummaries` 改为来自 RAG overview，而不是 `/world-engine/state/query` 的摘要字段。
  - 一键示例世界的“已存在 subject”判断继续使用 World Engine subjects，避免把尚未注册的主体系统文件误当作 World Engine subject。
- `WorldEngineWorkbenchPreviewSidebar.vue`
  - subject badge 区分：
    - `主体系统`：文件系统主体已连接 World Engine subject。
    - `待接入`：`simulation/subjects` 中存在，但 World Engine subject 表里还没有。
    - `孤儿`：保留给旧 state 摘要 fallback。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - `Subject System` 文案改为“来自 simulation/subjects 的真实主体系统摘要”。
  - 增加连接状态与 RAG index 状态显示。
- `app/stores/novel-ide.ts`
  - 修复首页深链接初始化：`?project=workspace/ming-ding-zhi-shi-2` 指定的 Project 会通过 `/api/projects?includeProjectPath=...` 补进项目列表。
  - 这解决了默认 Project 列表被历史测试项目挤占时，真实项目无法被选中、Workbench 停在“未选择小说”的问题。
- `app/stores/novel-ide.test.ts`
  - 增加初始化回归测试，钉住 URL 指定 Project 必须进入 `includeProjectPath` 查询。
- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 新增 `pendingSubjectSystemSummaries` 与 `syncPendingSubjectSystemSubjects()`。
  - 当 `simulation/subjects` 中存在尚未注册到 World Engine 的主体时，左栏 actions 显示 `主体系统待接入` 面板。
  - 点击 `同步主体系统` 会调用现有 `POST /api/projects/world-engine/subjects`，把 pending 主体注册为 World Engine subject 身份。
  - 同步动作只创建 subject 身份与 schema default 初始化；不把主体六文件正文或路径全文复制进 World Engine state。

## Verification

- `bunx vitest run server/rag/project-rag-visualization.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bunx vitest run app/stores/novel-ide.test.ts server/rag/project-rag-visualization.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`
- 浏览器验证：
  - 打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`。
  - 页面选中 `命定之诗2`，不再停在“未选择小说”。
  - 点击 `WORLD` 后打开真实 Workbench。
  - 网络请求包含 `/api/projects/rag/overview`。
  - 左栏显示 6 个真实主体的 `主体系统` badge 与 events / memory 计数。
  - `sample-npc` 未出现在 Workbench subject 列表。
  - 截图保存：`.agent/workspace/world-engine-real-subject-system-workbench.png`。
- 后续补充浏览器 smoke：
  - 已接入的 `ming-ding-zhi-shi-2` 不显示 `主体系统待接入 / 同步主体系统` 误报。
  - Inspector 仍显示 `events:dirty / memory:dirty` 或 `events:synced / memory:synced` 这类 RAG index 状态。
  - 截图保存：`.agent/workspace/world-engine-real-subject-system-sync-smoke.png`。

## Notes

- 本轮有意不把主体全文复制进 World Engine state，继续遵守主体系统信息边界。
- 临时 `tsx -e` 服务函数脚本受本地运行时包导出限制失败；没有采用绕过方案。实际服务模块已由 `server/rag/project-rag-visualization.test.ts` 覆盖。
- 相比前一轮计划，本轮确实改变了 API DTO：这是为了让现有 `Project RAG overview` 成为真实主体系统 discovery，而不是继续在 World Engine state 里造镜像字段。
