# Round 230: 主体系统同步显示初始化时间

本轮继续从作者真实使用路径审查主 IDE World Engine Workbench。上一轮已经修正待接入 subject 过滤后的空 timeline、旧 slice 残留和焦点串线问题；继续往下看时，新的卡点是“同步主体系统”按钮本身：作者能看到还有多少 `simulation/subjects` 待接入，但点击前不知道这些 subject 会被初始化到哪个 World Engine 时间点。

当前后端契约里，`createSubject` 的 schema default 初始化只能自动写入 `kind=init` 切面；如果目标 instant 已经是普通事件切面，后端会拒绝自动合并。因此这轮没有把同步时间改成当前选中 slice 或最新 timeline 时间，而是保留现有安全语义：使用 schema calendar 的第一个示例时间作为 subject 身份初始化时间。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `主体系统待接入` 面板新增“初始化时间”一行，直接显示 `subjectSystemSyncTime`。
  - 如果 schema 没有可用示例时间，则显示“未配置”，按钮原有禁用逻辑不变。
  - 同步请求体、`createSubject` 调用顺序、init 追加语义均未改变。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确保同步面板继续暴露 `subjectSystemSyncTime` 和“初始化时间”。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划中的目标是继续找作者真实流程里的第一个卡点。实际实现只做了同步面板的信息补齐，没有改同步时间策略，也没有继续扩展后端边界或新增大测试；这与“不要过度测试、不要继续抠畸形输入”的方向一致。
