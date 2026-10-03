# 2026-06-20 Resizable Panels And Triage Segment

## Context

前面几轮已经把 `/world-engine.workbench-preview` 推进成 mock-only 的技术工作台：左侧 Sidebar、中间 Slice List / Mutation Editor、右侧 Inspector 都承担了稳定职责。继续按用户计划检查时，有两个影响日常浏览的问题需要收口：

- 三栏工作台在不同桌面宽度下需要可调尺寸，尤其是 subject 列、右侧 Inspector 和底部 Mutation Editor。
- Inspector `Review Issues` 里的 issue triage 原先更像“当前可执行动作按钮”，状态位置不稳定；用户连续处理 open / confirmed / ignored 时，最好看到固定三段状态控件。

本轮仍不接真实 API，不改后端 DTO，只维护 preview mock 页面和静态契约测试。

## Changes

- 页面本地草稿升级到 `version: 4`，localStorage key 改为 `neuro-book:world-engine-workbench-preview:draft:v4`。
- 页面层新增三栏尺寸状态：
  - `sidebarWidth`，默认 `280`，恢复时限制在 `220..420`。
  - `inspectorWidth`，默认 `360`，恢复时限制在 `300..560`。
  - `mutationEditorHeight`，默认 `292`，恢复时限制在 `160..520`。
- `WorldEngineWorkbenchPreviewSidebar`、`WorldEngineWorkbenchPreviewInspector`、`WorldEngineWorkbenchPreviewMutationEditor` 统一通过 `useResizablePanel` 暴露拖拽手柄，并通过 `update:width` / `update:height` 回传页面层。
- `reset mock` 会恢复默认面板尺寸，避免异常本地布局继续影响视觉评估。
- Inspector `Review Issues` 的 issue triage 改为稳定三段控件：
  - `待处理` -> `open`
  - `确认` -> `confirmed`
  - `忽略` -> `ignored`
- 三段控件补充 `aria-pressed="issue.status === option.status"`，当前状态和可点击状态在语义上保持一致。
- 静态契约测试同步更新：
  - 草稿版本从 v3 改为 v4。
  - 覆盖面板默认尺寸、恢复校验、持久化字段和三栏 resize 事件。
  - 覆盖 triage 三段控件类型、选项、点击行为和 `aria-pressed`。
  - 将已 i18n 化的显示文案断言改为稳定 i18n key。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- HTTP route smoke：尝试访问 `http://localhost:3000/world-engine.workbench-preview`，当前本地没有 dev server，连接被拒绝；未发现页面运行时错误信号，但本轮没有启动服务做页面 smoke。

## Browser Verification

- 未做自动浏览器视觉验收，遵守项目约束。
- 后续用户确认后建议检查：
  - 左侧 Sidebar 拖拽宽度、收起、重置恢复默认。
  - 右侧 Inspector 拖拽宽度、隐藏后再打开仍保持布局。
  - Mutation Editor 展开后拖拽高度、收起后只显示标题条。
  - Review Issues 每条 issue 的 `待处理 / 确认 / 忽略` 三段控件状态稳定。
  - 刷新后 v4 浏览器草稿能恢复面板尺寸和 triage 状态。

## Notes

- 本轮保持 mock-only UI / UX 方向，不接真实 API。
- 这次改动让三栏布局更接近真实 workbench 的长期使用场景：用户可以把空间让给“世界切片列表”，也可以临时放大 Inspector 或 Mutation Editor 做局部检查。
