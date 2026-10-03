# 2026-06-20 Inspector Subject Focus

## Scope

本轮继续推进 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点检查右侧 `Slice Context` 与底部 `Mutation Editor` 的 subject 视角是否能形成一个连续工作流。

## UX Finding

浏览器巡检发现：Inspector 的 `Touched Subjects` 只是静态标签。用户在右侧看到当前 slice 触及 `雨城 / 王都 / 东塔` 后，最自然的动作是点击一个 subject，马上查看该 subject 的状态和本切片变更。但此前必须再到底部 Editor 左侧列表里重新选择一次，动作重复且上下文断开。

## Changes

- 页面层新增 `focusedSubjectId`，作为 Inspector 与 Mutation Editor 之间的轻量上下文焦点。
- Inspector 的 `Touched Subjects` 从静态标签改为按钮：
  - 点击 subject 会触发 `focusSubject`。
  - 当前 focused subject 使用绿色选中态。
  - State Snapshot 会自动展开 focused subject 的 details。
- Mutation Editor 支持 `focusedSubjectId`：
  - 外部 Inspector 点击 subject 时自动切换 active subject。
  - Editor 内点击 subject 时也会把焦点回传给页面，保持 Inspector 高亮同步。
  - 外部 subject 过滤仍会优先用于初始化单 subject 视图。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
- 浏览器 1366x768 复验：
  - 点击 Inspector `Touched Subjects` 里的 `王都`。
  - Mutation Editor 自动切到 `王都 capital`。
  - Editor 展示 `王都` 当前状态 `name / events` 和本切片变更 `name set 王都`。
  - Inspector `王都` chip 高亮，State Snapshot 自动展开 `王都`。
  - 页面 `scrollWidth` 保持 1366，无全局横向溢出。

## Notes

- 截图时浏览器环境出现一次 Statsig 网络超时日志，但截图和 DOM 复验成功；该日志来自浏览器插件环境，不影响本地页面功能。
- 后续可以继续推进从 Slice Card subject group 直接聚焦底部 subject，但需要避免在整个 slice card button 中嵌套 button。
