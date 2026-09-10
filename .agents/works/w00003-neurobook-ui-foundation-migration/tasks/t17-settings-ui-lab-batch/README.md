---
schema: nbook.task/v2
taskId: t17-settings-ui-lab-batch
role: tasker
---

# 设置界面在 Lab 重做

## 目标

按 t13 walkthrough 002 的金标配方，把 NeuroBook 设置界面（`NovelIdeSettingsDialog` 及其面板）重做成 Lab 可预览、可调试的 nb-ui 组合。本 Task 只覆盖「组件 + Lab」：不接产品宿主，不动 store / API / 后端 / 主题 authority。

## 已批准边界

开发者 2026-09-10 决定：设置界面先保证在 Lab 可用、可调试即可，不要求接入产品路径。

配方沿用 t15：先定承载关系再定外观；零件只来自 nb-ui；冲突回 owner 层修；形态一变就清账；每处不显然的缺陷落成可证伪规则 + 回归；Lab 是唯一验收面。

## 事实基准

- 现状宿主 `packages/neuro-book/app/components/novel-ide/NovelIdeSettingsDialog.vue`（1333 行）：旧模态 `Dialog` + 卡片语言 + 顶部保存/恢复栏 + `activeSection` 内联分支。
- 面板规模：`NovelIdeModelSettingsPanel` 726、`NovelIdeAgentProfileModelSettingsPanel` 705、`NovelIdeWebSettingsPanel` 561、`NovelIdeEmbeddingSettingsPanel` 392、`NovelIdeCostSettingsPanel` 220、`NovelIdeObservabilitySettingsPanel` 161、`theme/*` 222。
- 作用域与区段：`boot`（security）、`global`（models / embedding / cost / web-tools / agent-profile-models / observability）、`project`（agent-profile-models）、`browser`（frontend / editor / desktop）；区段列表按作用域过滤。
- 已迁资产：`settings/agent-profile/AgentProfileSettingsView.vue`（t15 金标 + 十个 Lab 场景）。

## 切片

1. **设置外壳**：`settings/NovelIdeSettingsView.vue` —— 作用域切换 + 区段导航 + 内容槽。承载关系沿用窗口内单层线条：导航轨 276px、栏间竖线与横线同款、内容列封顶、就地保存（无保存/恢复栏）。Lab 场景与 `AgentProfileSettingsView` 组合。
2. **逐面板迁移**：顺序按依赖与体量排为 cost / observability → embedding → web-tools → models → theme / frontend / editor / desktop；每片重复「承载关系 → 视图抽取 → Lab 场景 → 文档」。
3. 每个切片自带：迁移前后对照、宿主依赖上移记录、删除清单、smoke 断言、同名文档。

## 验收

必须观察到：

- Lab 场景在真实浏览器里渲染外壳与已迁移面板，作用域切换、区段切换与键盘可达性可用；
- 窄容器（390 × 844 画布）退化为单列并可靠切换条往返；
- 导航轨 276px、栏间竖线两端留边距且不被横线穿过、内容列封顶；
- `bun run --cwd packages/neuro-book smoke:component-lab` 通过；`bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` 通过；
- 无新增产品接线、store/API 访问、浏览器持久化或主题 authority 改动。

## 非目标

- 不接产品宿主 `NovelIdeSettingsDialog`（路线第 5–7 步）；
- 不改 shared DTO、后端 schema、真实配置文件；
- 不迁移旧 `Dialog` 组件本身（t16 负责 DialogWindow 迁移）。

## 切片 1：设置外壳（已完成）

产出：

- `settings/NovelIdeSettingsView.vue` + `.types.ts` + 同名文档：受控的外壳（作用域与区段都受控），内容由默认插槽提供；作用域切换后若当前区段在新作用域不存在，视图自行改选新作用域的第一个区段，宿主不必兜底。
- `component-lab/fixtures/NovelIdeSettingsViewFixture.vue`（五个场景：global / project / dialog-window / loading / load-error）与 `component-index` 派生的组件树条目（`NovelIdeSettingsView`）；`global`、`project` 在内容槽里挂真实的 `AgentProfileSettingsView`，另外两档作用域用 `disabledReason` 标为不可进入。
- `scripts/smoke/settings-view.ts` + `agent-profile-nav.ts` 的 `closeLeftoverDialogWindow` 共享助手：外壳结构、作用域四档（含两档禁用）、区段导航、内容槽挂载、作用域切换与目标行显隐、嵌套区段体按自身容器宽度决定单栏或双栏、页面无横向溢出。

实测（Lab smoke 输出）：`railWidth 276`、`railLineWidth 1px`、`scopeCount 4` / `scopeDisabled 2`、`sectionCount 1` / `activeSections 1`、`nestedViews 1`、`overflow 0`。

过程中的两个坑：

- 外壳根宽度塌成 0：fixture 用 `flex` 行容器包住视图，视图自带 `min-w-0` 且没有宽度约束，flex 行里被压到 0。内容槽包装改为块级 `min-h-0 flex-1`。
- smoke 读到别的 fixture 的视图：文档里可能同时存在多个 `.settings-view-root`（还有 teleport 出去的窗口内容），查询必须用外壳独有的 `[aria-label="配置作用域"]` 定位再 `closest()` 取根。

`AgentProfileSettingsView` 嵌入外壳后在 460px 内容列里会按容器查询退化为单列——这是规则的正确表现；要看到「两级双栏」组合，需要在 Lab 里把画布放宽（收起左右检查栏或用更宽的画布）。

## 切片 2：可观测区段（已完成）

产出：

- `settings/observability/ObservabilitySettingsView.vue` + 同名文档：Pi 请求记录的受控视图（总开关 + 每会话保留条数 + 隐私说明）。就地保存，合法输入立刻写回并夹到 `0..10000`；空串与非数字不写回，避免清空输入框时把 0 落进配置。旧面板 `NovelIdeObservabilitySettingsPanel` 继续负责快照读写与 `saveGlobal`，产品接线时再消费本视图。
- `component-lab/fixtures/ObservabilitySettingsViewFixture.vue`（default / disabled / boundary / saving / save-error）与注册表条目；`NovelIdeSettingsViewFixture` 增加第二个区段「可观测」，两个场景的内容槽按 `activeSection` 分派真实视图。
- smoke 扩展：区段数 2、切到可观测区段后挂载真实视图（开关数 1 + 标题命中）、再切回 Agent Profile 区段。

实测：`sectionCount 2`、`activeSections 1`，切段断言全绿；Lab 组件树从 17 → 18 个组件。

## 切片 3：费用显示区段（已完成）

产出：

- `settings/cost/CostSettingsView.vue` + 同名文档：展示币种（USD / CNY，各带说明，因此用 `RadioGroup` 而不是下拉）、当前 `1 USD = x CNY（缓存）` 与取回时间、手动刷新按钮。汇率只影响展示、不写配置；刷新由 `refreshRate` 交给宿主，视图不解析响应。旧面板 `NovelIdeCostSettingsPanel` 继续负责快照、`saveGlobal` 与汇率请求。
- `component-lab/fixtures/CostSettingsViewFixture.vue`（default / cny / stale / missing-rate / refreshing / save-error）与注册表条目；fixture 的刷新只换一个确定值并记录事件。
- 外壳第三个区段「费用显示」；smoke 断言区段数 3，切到该段后挂载真实视图（2 个 radio + 刷新按钮 + 汇率行）。

实测：`sectionCount 3`、切段断言全绿；Lab 组件树 18 → 19 个组件。`exchangeRateFetchedAt` 解析不出日期时按空串处理，不渲染残行。
