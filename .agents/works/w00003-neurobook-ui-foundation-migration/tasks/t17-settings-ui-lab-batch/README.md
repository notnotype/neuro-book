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
- 已迁资产：`settings/views/AgentProfileSettingsView.vue`（t15 金标 + 十个 Lab 场景）。

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

- `settings/views/ObservabilitySettingsView.vue` + 同名文档：Pi 请求记录的受控视图（总开关 + 每会话保留条数 + 隐私说明）。就地保存，合法输入立刻写回并夹到 `0..10000`；空串与非数字不写回，避免清空输入框时把 0 落进配置。旧面板 `NovelIdeObservabilitySettingsPanel` 继续负责快照读写与 `saveGlobal`，产品接线时再消费本视图。
- `component-lab/fixtures/ObservabilitySettingsViewFixture.vue`（default / disabled / boundary / saving / save-error）与注册表条目；`NovelIdeSettingsViewFixture` 增加第二个区段「可观测」，两个场景的内容槽按 `activeSection` 分派真实视图。
- smoke 扩展：区段数 2、切到可观测区段后挂载真实视图（开关数 1 + 标题命中）、再切回 Agent Profile 区段。

实测：`sectionCount 2`、`activeSections 1`，切段断言全绿；Lab 组件树从 17 → 18 个组件。

## 切片 3：费用显示区段（已完成）

产出：

- `settings/views/CostSettingsView.vue` + 同名文档：展示币种（USD / CNY，各带说明，因此用 `RadioGroup` 而不是下拉）、当前 `1 USD = x CNY（缓存）` 与取回时间、手动刷新按钮。汇率只影响展示、不写配置；刷新由 `refreshRate` 交给宿主，视图不解析响应。旧面板 `NovelIdeCostSettingsPanel` 继续负责快照、`saveGlobal` 与汇率请求。
- `component-lab/fixtures/CostSettingsViewFixture.vue`（default / cny / stale / missing-rate / refreshing / save-error）与注册表条目；fixture 的刷新只换一个确定值并记录事件。
- 外壳第三个区段「费用显示」；smoke 断言区段数 3，切到该段后挂载真实视图（2 个 radio + 刷新按钮 + 汇率行）。

实测：`sectionCount 3`、切段断言全绿；Lab 组件树 18 → 19 个组件。`exchangeRateFetchedAt` 解析不出日期时按空串处理，不渲染残行。

## 切片 4：向量嵌入区段（已完成）

产出：

- `settings/views/embedding/embedding-settings-draft.ts`：草稿模型与序列化规则的唯一出口（`createEmbeddingSettingsDraft()`、`buildGlobalEmbeddingPayload()`、`buildProjectEmbeddingPayload()`、`buildSecretPayload()`）。空串统一表示「未配置/继承上层」，密钥留空表示保留原值、显式清除才写空串，启用但模型为空时按三处默认值补齐。
- `settings/views/EmbeddingSettingsView.vue` + 同名文档：global 渲染整段服务配置（开关 / Provider / 模型 / 维度 / Timeout / Base URL / API Key + 清除 / 请求扩展参数 JSON），project 只渲染模型与维度覆盖。短字段并排由视图自身容器宽度（`@container min-width: 620px`）决定，不看窗口宽度。
- `component-lab/fixtures/EmbeddingSettingsViewFixture.vue`（global-disabled / global-enabled / global-api-key / project-inherit / project-override / saving / save-error）与注册表条目；外壳第四个区段「向量嵌入」，只登记在 global 下（旧宿主的 scope→区段矩阵里 embedding 只属于 global，project 场景由该视图自己的 fixture 覆盖）。
- smoke 断言区段数 4，切到该段后挂载真实表单（开关 1、输入 ≥5、多行 1、含 Base URL）且栅格为一或两栏。

实测：`sectionCount 4`、切段断言全绿；Lab 组件树 19 → 20 个组件。

## 切片 5：Web 工具区段（已完成）

产出：

- `settings/views/web/web-settings-draft.ts`：草稿模型与序列化规则的唯一出口（优先级规范化、上下移边界、provider 密钥三态、数字回落默认值、`buildWebPayload()`），并配 `web-settings-draft.test.ts` 覆盖这四类边界（4 用例）。
- `settings/views/WebSettingsView.vue` + 同名文档：搜索服务（默认服务下拉 + `Fallback:` 顺序提示、两个 provider 行含上移下移与开关、密钥 + 清除、超时，Brave 另有国家与搜索语言）、本地抓取（开关 + 五个限额）、Tavily 兜底（开关 + 超时）。短字段并排按视图自身容器宽度决定。
- `component-lab/fixtures/WebSettingsViewFixture.vue`（default / configured / brave-first / local-fetch-off / saving / save-error / disabled）；外壳第五个区段「Web 工具」。
- smoke 断言区段数 5，切到该段后挂载真实表单（2 个 provider 行、4 个开关、4 个上移/下移按钮、含 Fallback 提示）。

实测：`sectionCount 5`、切段断言全绿；Lab 组件树 20 → 21 个组件。

过程中被 smoke 的 console 守卫抓到一处真实缺陷：provider 行曾用 `settings.panels.web.disabled` 这个不存在的 i18n key。旧面板本来没有启用状态文字（开关本身表达状态），因此删掉那枚重复徽标而不是新增文案。

## 切片 6：密码保护 / 编辑器 / 桌面应用三小节（已完成）

产出：

- `settings/views/editor/editor-prefs.ts` + 测试：数值区间与步长（`MARKDOWN_NUMBER_LIMITS` / `MONACO_NUMBER_LIMITS`）、字体候选、`clampEditorNumber` / `clampMonacoNumber` 与 `editorFontLabel`。区间同时是控件 `min` / `max` / `step` 与夹紧逻辑的唯一来源。5 个用例覆盖越界夹紧、区间内小数透传、空串与非数字返回 `null`、候选表完整性。
- `settings/views/EditorSettingsView.vue` + 同名文档：Markdown 正文档（字体 / 字号 / 行高 / 正文宽度 / 段首缩进）与 Monaco 段（字体 / 字号 / 行高 / Tab Size / 四个开关），两块各带「重置」，重置只发 `reset` 事件由宿主决定重置成什么。
- `settings/views/DesktopSettingsView.vue` + 同名文档：说明块（连接方式 + 版本）、缩放滑杆（0.75–2，百分比贴在标题右侧）、托盘开关、关闭行为下拉。视图里没有 `window.neuroBookDesktop`——探测与拉取时机是宿主策略；`status` 为 `null` 时只少一行版本说明。
- `settings/views/SecuritySettingsView.vue` + 同名文档：只读三件套（说明、`auth.enabled` 三态徽标、`config.yaml` 示例 + 警告），无 emit、无保存入口。
- 三个 fixture（EditorSettingsView 4 场景 / DesktopSettingsView 3 场景 / SecuritySettingsView 3 场景）与注册表条目；外壳 fixture 解禁 `启动` 与 `本机` 两档作用域并各挂三个新区段体，四个作用域现在都能进入。
- smoke 扩展：`scopeDisabled` 2 → 0；新增「启动作用域（1 区段 + `auth.enabled` + 示例 YAML + 三态文案）」「本机作用域（2 区段）」「编辑器区段（7 个数字字段 + 两处字体联想 + 5 个开关 + 段首缩进禁用态）」「桌面应用区段（0.75–2 滑杆 + 100% + 1 开关 + 1 下拉）」四段。

实测（Lab smoke 输出）：`scopeDisabled 0`、`sectionCount 5`、`nestedViews 1`、`overflow 0`；启动段 1 区段（当前项「密码保」）、本机段 2 区段、编辑器段 7 个数字输入 / 2 处字体输入 / 5 个开关 / 1 个禁用数字输入、桌面段滑杆 `0.75–2` 与 `100%`。

两处与计划文本的有意偏差：

- 字体的候选联想用 nb-ui `Autocomplete`（真输入框 + 联想浮层），不是 `FormInput` + `datalist`：`FormInput` 不透传 `list`，`datalist` 挂不上。smoke 相应改为断言两处 `input[placeholder="输入 CSS font-family"]`，而不是 `datalist` 计数。
- 段首缩进关闭时，缩进量输入框保持可见但 `disabled`（计划里曾写「默认态禁用数为 0」，实际是 1）：这与旧宿主一致，也让「关闭后缩进量是否还在」可预期。

## 切片 7：模型区段渲染层（已完成）

产出：

- 模型子组件与纯模块搬进 `settings/views/model/`：`NovelIdeModelSelect.vue`、`SavedModelsList.vue`、`AgentVisibleModelsEditor.vue`、`model-settings-view.ts`、`model-settings-draft.ts`、`model-draft-factory.ts`、`model-cost-draft.ts` 与三个测试。四个会话文件留在 `settings/`（它们做 I/O，本片不动）。导入点全量重写：除旧面板外还有 `AgentSessionModelControls.vue`（会话级模型下拉）与四个会话及其测试，共 20 个文件。
- `views/model/ModelSettingsView.types.ts` + `ModelSettingsView.vue` + `ModelProviderRail.vue` + `ModelProviderDetail.vue` + 同名文档：区段标题与说明、草稿问题横幅、默认模型与「新增 Provider」、Agent 可见模型，以及 global 下的 Provider 双栏（导轨 + 连接表单 + `SavedModelsList`）。视图吃 props、emit 动作，字段改动统一走 `update:draft`；唯一自持状态是分组折叠。
- `component-lab/fixtures/ModelSettingsViewFixture.vue`（default / project / no-provider / disabled-models / saving / save-error / loading）与 `fixtures/model-settings-fixture-data.ts`（假数据构造与设置外壳 fixture 共用）；外壳第六个区段「模型设置」，smoke 断言区段数 6 与模型段结构。
- `SavedModelsList.vue` 的模型行加 `data-saved-model-row`（唯一新增钩子，不改渲染）。

实测（Lab smoke 输出）：`sectionCount 6`、`activeSections 1`、`nestedViews 1`、`overflow 0`；模型段 1 个 Provider 导轨项 / 2 个已保存模型行 / 1 个密钥输入 / 2 个数字字段 / 1 个多行输入。组件级实测（1920 宽画布）：模型视图容器宽度 1156px、双栏 `260px 896px`、导轨项 1、已保存模型行 2；外壳组合（444px 内容列）下退化单列仍渲染 1 个导轨项。

三处与计划文本的有意偏差：

- 计划里模型段 smoke 要断言「1 个开关（Provider 启用开关）」，但旧宿主的 Provider 启停本来就是按钮而不是开关，本片保留按钮：改为断言结构性钩子（密钥输入、两个数字字段、一个多行输入），不为了断言去改控件形态。
- 双栏阈值从计划的 900px 改成 700px：产品里模型区段的内容列最宽约 780px（1100px 窗口 − 276px 导轨 − 内边距），900px 永远不成立；700px 与外壳的单列阈值同档。
- `modelInputOptions`（模型输入能力下拉项）只在编辑对话框里用到，按切片边界挪到切片 8 再加，本片不先摆一个没人用的 prop。

过程中的一个坑：新增 fixture 后 Lab 有时不会重挂画布（HMR 只换了组件树条目），第一次截图拿到的是上一个组件的画面——验证新 fixture 要整页刷新，不能只看画布标题。

## 剩余工作（尚未开始）

模型区段的渲染层已迁完，剩对话框层一个切片：

1. **模型区段对话框层**：`NovelIdeModelEditDialog.vue`、`ModelDiscoveryDialog.vue`、`ModelLibraryDialog.vue` 搬进 `views/model/`，连同校验问题全列表与删除 Provider 确认两个内联 `Dialog`，一起挂到 `ModelSettingsView` 上（props / emits 命名规则同渲染层；fixture 与外壳 fixture 都要补 `*Open` 开关与 handler，否则在外壳里点不开）。

产品宿主接线仍属路线第 5–7 步，不在本 Task 内。

## 返工风险清单（接线前必须处理）

这几项属于「现在不管、以后返工很贵」的类型，按严重度排：

1. **双份序列化逻辑**：`NovelIdeEmbeddingSettingsPanel` / `NovelIdeWebSettingsPanel` / `NovelIdeCostSettingsPanel` / `NovelIdeObservabilitySettingsPanel` 各自还留着一套 payload 构造与密钥语义，`views/*` 下的 draft 模块是另一套。产品接线时必须让旧面板改调新模块（或直接删除旧面板），不能让两套长期并存——配置写回规则一旦漂移，两边都会写错同一个配置段。
2. **`SettingsSavePanelExpose` 协议会整体消失**：旧宿主靠 `defineExpose({dirty, loading, saving, saveSettings, restoreSettings})` 驱动顶部保存 / 恢复栏，新视图是就地保存。接线时这套 expose 合同、保存栏、`settingsPanelKey` 重置逻辑要一次性删干净，不能留一半。
3. **作用域→区段矩阵目前是 fixture 自造的**：产品真值在 `NovelIdeSettingsDialog` 的 `globalConfigSections` / `projectConfigSections` / `browserSections` / `bootConfigSections` 里。外壳吃的是 props，接线时必须从产品矩阵喂进去（或先把矩阵抽成共享模块），否则 Lab 里的区段集合会和产品不一致，而这种不一致看起来完全正常。
4. **尺寸只有一个来源**：`DialogWindow` 的 `size` 字面量是缺省，显式 `width` / `height` 覆盖对应维度。场景里不要同时写死预设与同样的数字（设置外壳 fixture 已改成拖动后才接管受控值），否则预设一改就会静默停在旧尺寸。
