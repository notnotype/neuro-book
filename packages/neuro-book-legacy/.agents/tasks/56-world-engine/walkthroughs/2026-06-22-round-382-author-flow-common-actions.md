# Round 382: 作者流常用动作补验与 Composer 草稿边界修复

## 背景

Round 381 修复了真实作者流里的两个 P0：`files N` 直达绑定当前 slice / proposal subject，以及 Composer 编辑 text value 后真实落库。本轮继续补验常用动作：proposal 复制、打开主体文件、State Snapshot / Query 和草稿保护；同时先做一轮轻量代码审查，避免把明显的草稿覆盖风险带进浏览器验收。

## 代码调整

- 修复 `WorldEngineMutationEditor.vue` 中删除 / 移动 mutation 后的 Builder 草稿同步边界：
  - 删除 mutation 后，如果仍有剩余 mutation，会把新的当前 mutation 重新载入 Builder。
  - 删除到空列表时清理 `builderDraftDirty`。
  - 移动 mutation 后重新载入移动后的当前 mutation。
- 目的：避免作者先编辑 Builder value、再删除 / 移动 mutation、随后直接保存时，`applyDirtyBuilderDraftBeforeSubmit()` 用旧 Builder 草稿覆盖刚完成的列表操作。
- 为左栏 `simulation/subjects`-backed subject 卡片增加 `语境` 按钮：
  - `语境` 只设置主体文件建议使用的 `focusedSubjectId`，不改变中间 timeline 过滤。
  - 顶部视角文案会显示 `主体语境 薇洛丝`。
  - 真实 Dialog 使用 `focusSubjectContext()` 接线，不自动展开底部编辑器。
- 修复 Slice Composer 草稿保护的父层感知：
  - `WorldEngineMutationEditor.vue` 的 dirty 判定现在包含未应用 Builder 草稿，dirty watcher 使用同步 flush。
  - `WorldEngineMutationEditor.vue` 暴露 `hasUnsavedDraft()`，父层关闭 Composer / Workbench 前会同步查询子组件实时草稿状态。
  - `WorldEngineWorkbenchDialog.vue` 的 Composer 容器会捕获原生 `input/change`，兜底标记 title/time/kind/summary/mutations 等表单草稿，避免只改 slice 元数据时父层漏判。
  - 父层 `dirty-change` / `saving-change` 改为显式 handler，避免模板内直接给 ref 赋值的状态同步不透明。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：2 files / 9 tests passed。
- 启动临时 `localhost:3001` 当前源码 Nuxt dev server，并用真实浏览器打开 `workspace/ming-ding-zhi-shi-2`。
  - 打开 World Engine Workbench：通过。
  - 真实 Project 加载：通过，显示 7 个 subject、4 条当前验收主线 slice。
  - Step C State Snapshot：通过，能看到 `world.events` 3 items，`issues` 未出现。
  - 选中 `player / 薇洛丝` subject filter：通过，顶部变为 `当前视角：主体(任一 subject) 薇洛丝`。
- 新增 `语境` 入口后，使用直接 `nuxt dev --port 3001` 做补充浏览器验收：
  - 整体时间线下点击 `薇洛丝` 的 `语境`：通过，顶部显示 `当前视角：主体语境 薇洛丝`。
  - 三条 `[验收]` `world.events` 主线 slice 都显示 `files 1`：通过。
  - 点击 Step C 的 `files 1`：通过，Inspector 直达 `Subject file proposals`，显示 `薇洛丝 / 当前主体语境下的 world 事件建议 / simulation/subjects/player`。
  - `events.jsonl draft` 与 `state.md review` 展示：通过。
- 继续使用真实浏览器补验 proposal 常用动作：
  - `复制建议`：通过，剪贴板读回完整 `# Subject file proposal: 薇洛丝 (player)` 文本。
  - `复制全部`：通过，当前 Step C 只有 1 条 proposal，剪贴板读回同一完整建议文本。
  - `复制 events.jsonl 行`：通过，剪贴板读回 `{"text":"我经历了这件事：...","time":"复兴纪元488年 1月15日 14:00:08"}`。
  - `复制 state.md 审查提示`：通过，剪贴板读回 `slice summary 可能包含位置、关系压力、短期目标或可见状态变化，需要人工确认 state.md 是否要更新。`。
  - `打开 events.jsonl`：通过，Workbench 关闭，主 IDE 打开 `simulation/subjects/player/events.jsonl`。
  - `打开 state.md`：通过，Workbench 关闭，主 IDE 打开 `simulation/subjects/player/state.md`。
  - 历史 slice 回看：通过，Step A/B/C 的 `files 1` 分别显示 14:00:06 / 14:00:07 / 14:00:08 对应 proposal，没有串到 Step C。
- 草稿保护补验：
  - 发现问题：只修改 Slice Composer title 后点击关闭，浏览器自动化路径显示 Composer 会直接关闭，说明父层对 Composer dirty 的感知不可靠或原生 `window.confirm` 被自动化通道自动同意。
  - 已补代码侧保护：父层现在同步查询子组件 `hasUnsavedDraft()`，并捕获 Composer 内表单输入事件标记 dirty。
  - 浏览器自动化限制：当前 in-app browser / Playwright 通道无法可靠证明原生 `window.confirm` 的“取消”分支；多次点击后 `getJsDialog()` 均拿不到活动 dialog，表现为自动继续。后续如需人工确认，需要用户手动在可见浏览器里试一次关闭取消。

## 发现的问题

### 已修: proposal 语境和 subject filter 混在一起

当前 `world.events` 切片要生成角色六文件 proposal，需要一个 `focusedSubjectId` 作为“当前主体语境”。但 UI 里作者能自然触达的是左侧 subject filter：

- 在整体世界视角下，Step C 没有稳定出现 `files 1`。
- 选中 `薇洛丝` 后，确实设置了 subject filter，但 timeline 变成单 subject 视角，只剩 init 这类直接触及 player 的 slice；Step C 作为 `world.events` 切片被过滤语义挡出，无法继续复制 proposal。
- 已补最小修复：左栏新增 `语境` 按钮，把“当前主体语境”从 subject filter 中拆出来。

### P1: 清空 subject filter 的可发现性不足

进入 subject filter 后，本轮浏览器视口内没有明显看到 `清空 subject 过滤` 入口；作者容易卡在单 subject 视角，误以为其它 slice 消失。

### 未完成验收项

- `memory.jsonl` 打开 / 复制行：本轮 Step C 没有 memory 候选，未单独构造 memory slice 去验，避免继续污染真实 Project。
- 原生 `window.confirm` 的取消分支：自动化通道无法可靠捕获，需要一次人工可见浏览器确认。
- subject filter 的清空入口可发现性仍是 P1。

## 与计划的出入

- 原计划是补验 proposal 复制、打开文件和草稿保护。
- 实际先修掉了一个小型 Composer 草稿覆盖风险，并在浏览器里发现更靠前的作者流卡点：`focused subject` 不是一个独立、可见、可控的作者概念；随后补了最小 `语境` 入口并复验 Step C proposal 直达通过。
- 继续验收时又发现 Slice Composer 只改 title 的关闭保护不可靠，本轮追加了父层实时 dirty 查询与输入捕获兜底。
- 本轮没有写入或删除真实 Project 数据；Round 380 留下的三条 `[验收]` 主线 slice 仍保留。

## 下一步建议

- 人工可见浏览器复验原生确认框取消分支。
- 继续改善 subject filter 的清空入口可发现性，避免作者卡在单 subject timeline。
