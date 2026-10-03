# Round 389 - Clear Subject Context

## Context

Round 382 为左栏 subject 卡片增加了独立 `语境` 入口，让作者可以在整体 timeline 下把主体文件建议语境设为某个真实 subject，而不改变中间的 `只看` / subject filter。Round 383 又为 subject filter 增加了 `清空过滤` 出口。

本轮继续观察作者真实使用路径时发现一个概念卡点：主体文件建议语境有入口但没有显式出口。作者在整体时间线下把 `薇洛丝` 设为语境后，历史 `files N` 和 proposal 会继续按该语境计算；如果作者之后想回到无主体语境，只能靠其它隐式状态变化，不够可发现。

## Scope

- 给左栏 `Subjects` 标题区域增加 `清语境` 按钮，仅在已有 `focusedSubjectId` 时显示。
- 让当前语境 subject 卡片的按钮显示为 `语境中`，并设置 `aria-pressed`。
- `清语境` 只清空主体文件建议语境，不改变中间 timeline subject filter。
- 同步真实 Workbench 与 mock `/world-engine.workbench-preview`。

## Implementation

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 新增 `focusedSubjectId` prop。
  - 新增 `clearSubjectContext` emit。
  - 当前语境按钮显示 `语境中`，普通按钮仍为 `语境`。
  - `Subjects` 标题右侧在有语境时显示 `清语境`。
- `WorldEngineWorkbenchDialog.vue`
  - 新增 `clearSubjectContext()`，会检查保存 / busy 状态，清空 `focusedSubjectId` 与 `highlightedMutationFocus`，并提示 `已清空主体文件建议语境。`
  - 将 `focusedSubjectId` 和 `clearSubjectContext` 传给 Sidebar。
- `world-engine.workbench-preview.vue`
  - mock preview 同步新增设置 / 清空主体文件建议语境的状态流。
- 静态契约测试同步断言真实 Workbench 与 mock preview 都存在该入口。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件，9 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

步骤：

1. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
2. 点击顶部 `World` 打开主 IDE Workbench。
3. 点击左栏 `薇洛丝` 的 `语境`。
4. 确认页面显示：
   - `当前视角：主体语境 薇洛丝`
   - `清语境`
   - 当前 subject 按钮为 `语境中`，且 `aria-pressed=true`
5. 点击 `清语境`。

结果：

- `清语境` 按钮消失。
- `当前视角：主体语境 薇洛丝` 消失。
- 当前视角回到 `整体世界视角`。
- 所有 subject 卡片按钮回到 `语境`，且 `aria-pressed=false`。
- 页面没有出现 `清空过滤`，说明没有改变 timeline subject filter。
- 出现提示：`已清空主体文件建议语境。`

验收后关闭浏览器标签，并关闭临时 `bunx nuxt dev --port 3001`。

## Actual vs Plan

- 计划：补上主体文件建议语境的显式清空出口，并确认它不影响 subject timeline filter。
- 实际：真实 Workbench 与 mock preview 都已接入；真实浏览器确认 `清语境` 只清空 focused subject，不触发 `清空过滤` / subject filter。
- 与计划出入：无。没有保存、删除或写入 Project SQLite。

## Follow-up

- 主体语境和 subject filter 现在都有独立入口和出口：`语境 / 清语境` 管 proposal context，`只看 / 清空过滤` 管 timeline filter。
- 下一步回到作者连续推演本身，继续观察 `files N`、主体文件建议和六文件人工处理是否仍有概念摩擦。
