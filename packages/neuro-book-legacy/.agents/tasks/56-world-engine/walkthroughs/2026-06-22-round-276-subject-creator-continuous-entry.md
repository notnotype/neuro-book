# Round 276: Subject Creator Continuous Entry

## Context

继续从“作者真的开始写世界时，第一个卡住的地方在哪”审查正流程。空 Project 除了同步主体系统和一键示例世界，还会走手动创建 subject。当前 `WorldEngineSubjectCreator` 创建成功后仍保留刚提交的 `id/name/time/type`，作者连续创建第二个 subject 时，最容易直接再次提交同一个 id 并撞 duplicate。

另外，创建请求飞行中表单字段仍可编辑，而成功回调构造给父层的 subject 使用的是 await 之后的表单值；如果作者在慢请求期间改了字段，父层可能拿到与真实请求不一致的 type/name。

## Changes

- `WorldEngineSubjectCreator.vue`
  - 创建请求前先拍下 `requestBody`，提交和成功回调都使用同一份数据，避免请求飞行中表单变化污染父层 subject 信息。
  - 创建成功后清空 `form.id` 与 `form.name`，保留当前 `type` 和 `time`，让作者可以连续录入下一个 subject，而不是停在刚创建的 id 上。
  - 新增 `formDisabled`，保存中或父级 busy 时用 `fieldset disabled` 禁用整组表单字段。

- `world-engine-ide-entry.test.ts`
  - 补充 Subject Creator 连续录入、请求体快照和表单禁用的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：手动创建一个 subject 后，表单的 id/name 应清空，type/time 保持可继续录入；慢请求期间字段不可编辑。

## Result

实际结果与本轮目标一致：没有继续扩大后端边界测试，也没有改 schema / API；只修正手动创建 subject 这条正门里的连续录入卡点和请求飞行中的表单状态风险。
