# 2026-06-20 Collection Remove Value Input

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 编辑体验，不接真实 API，不改后端 DTO。重点把 schema-aware value input 补到 `collectionRemove` 场景，让用户从当前 subject 状态里选择要移除的 collection item。

## Finding

上一轮 value input 已支持 ref / number / bool / enum / JSON 等控件，但 `collectionRemove` 仍然容易退回“手写 value”的心智。实际使用时，用户更自然的动作是：查看 subject 当前状态，然后从已有 collection 项里选出要移除的值。

这对 World Engine Workbench 很重要，因为 `collectionAdd` / `collectionRemove` 是人物背包、地点出入、阵营成员等状态最常见的变更方式之一。

## Changes

- mock slices 新增 `slice-erina-hands-sword`：
  - `艾莉娜` 的 `inventory collectionRemove subject://old-sword`。
  - `莫然` 的 `inventory collectionAdd subject://old-sword`。
  - `旧剑` 的 `owner set subject://moran`。
  - `莫然` 的 `events listAppend 接过旧剑保管`。
- mock snapshot 增加交剑后的 reduce 结果：
  - `erina.inventory` 变为 `[]`。
  - `moran.inventory` 变为 `["subject://old-sword"]`。
  - `old-sword.owner` 变为 `subject://moran`。
- `WorldEngineWorkbenchPreviewValueInput` 增加 `collectionItem` 输入类型。
- `collectionRemove` 会根据当前 snapshot 中对应 subject attr 的数组状态生成候选项，并保留当前 mutation value 作为兜底候选。
- ref 值候选显示为 `name · id`，例如 `旧剑 · old-sword`，实际 value 仍是 `subject://old-sword`。
- Mutation Editor 将当前 slice snapshot subjects 传给 value input，避免 value input 自己读取全局状态。
- 目标测试补充 collectionRemove mock / 控件契约 / reducer 行为断言。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 页面显示 `6 / 6 slices · 25 mutations`。
  - 新增 `艾莉娜把旧剑交给莫然` 卡片可见。
  - 选中 `slice-erina-hands-sword` 后，Inspector 同步显示该 slice 的 time / title / summary。
  - 点击卡片内 `聚焦 艾莉娜` 后，Mutation Editor 自动展开并进入 subject 检查路径。
  - `inventory collectionRemove` 的 value 渲染为下拉。
  - 下拉候选为 `旧剑 · old-sword`，value 为 `subject://old-sword`。
  - 页面 `scrollWidth` 未超过 viewport width，没有横向溢出。
- 浏览器 dev logs 里仍有 2026-06-19 的旧 HMR / Vue error 残留；本轮检查没有把这些旧日志当成当前错误依据。

## Plan Deviation

- 本轮没有新增真实 API 接入，也没有把 collectionRemove 候选抽成共享前端 util；当前实现仍限制在 preview 目录边界内。
- 浏览器实际 viewport 由内置浏览器保持为默认 1280×720；自动化尝试设置 1366×768 后检查结果仍显示默认 viewport，因此本轮记录按实际 viewport 说明。

## Next Notes

- 如果后续接真实 Workbench，需要把 collectionRemove 当前状态候选和主 IDE Mutation Builder 的候选推导对齐，避免 preview 与正式编辑器出现两套语义。
- 如果 collection item 支持 object 值，候选文案需要继续优化，避免下拉里显示过长 JSON。
