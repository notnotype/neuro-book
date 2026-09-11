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
- 已迁资产：`settings/sections/agent-profile/AgentProfileSettingsView.vue`（t15 金标 + 十个 Lab 场景）。

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

- `settings/sections/observability/ObservabilitySettingsView.vue` + 同名文档：Pi 请求记录的受控视图（总开关 + 每会话保留条数 + 隐私说明）。就地保存，合法输入立刻写回并夹到 `0..10000`；空串与非数字不写回，避免清空输入框时把 0 落进配置。旧面板 `NovelIdeObservabilitySettingsPanel` 继续负责快照读写与 `saveGlobal`，产品接线时再消费本视图。
- `component-lab/fixtures/ObservabilitySettingsViewFixture.vue`（default / disabled / boundary / saving / save-error）与注册表条目；`NovelIdeSettingsViewFixture` 增加第二个区段「可观测」，两个场景的内容槽按 `activeSection` 分派真实视图。
- smoke 扩展：区段数 2、切到可观测区段后挂载真实视图（开关数 1 + 标题命中）、再切回 Agent Profile 区段。

实测：`sectionCount 2`、`activeSections 1`，切段断言全绿；Lab 组件树从 17 → 18 个组件。

## 切片 3：费用显示区段（已完成）

产出：

- `settings/sections/cost/CostSettingsView.vue` + 同名文档：展示币种（USD / CNY，各带说明，因此用 `RadioGroup` 而不是下拉）、当前 `1 USD = x CNY（缓存）` 与取回时间、手动刷新按钮。汇率只影响展示、不写配置；刷新由 `refreshRate` 交给宿主，视图不解析响应。旧面板 `NovelIdeCostSettingsPanel` 继续负责快照、`saveGlobal` 与汇率请求。
- `component-lab/fixtures/CostSettingsViewFixture.vue`（default / cny / stale / missing-rate / refreshing / save-error）与注册表条目；fixture 的刷新只换一个确定值并记录事件。
- 外壳第三个区段「费用显示」；smoke 断言区段数 3，切到该段后挂载真实视图（2 个 radio + 刷新按钮 + 汇率行）。

实测：`sectionCount 3`、切段断言全绿；Lab 组件树 18 → 19 个组件。`exchangeRateFetchedAt` 解析不出日期时按空串处理，不渲染残行。

## 切片 4：向量嵌入区段（已完成）

产出：

- `settings/sections/embedding/embedding-settings-draft.ts`：草稿模型与序列化规则的唯一出口（`createEmbeddingSettingsDraft()`、`buildGlobalEmbeddingPayload()`、`buildProjectEmbeddingPayload()`、`buildSecretPayload()`）。空串统一表示「未配置/继承上层」，密钥留空表示保留原值、显式清除才写空串，启用但模型为空时按三处默认值补齐。
- `settings/sections/embedding/EmbeddingSettingsView.vue` + 同名文档：global 渲染整段服务配置（开关 / Provider / 模型 / 维度 / Timeout / Base URL / API Key + 清除 / 请求扩展参数 JSON），project 只渲染模型与维度覆盖。短字段并排由视图自身容器宽度（`@container min-width: 620px`）决定，不看窗口宽度。
- `component-lab/fixtures/EmbeddingSettingsViewFixture.vue`（global-disabled / global-enabled / global-api-key / project-inherit / project-override / saving / save-error）与注册表条目；外壳第四个区段「向量嵌入」，只登记在 global 下（旧宿主的 scope→区段矩阵里 embedding 只属于 global，project 场景由该视图自己的 fixture 覆盖）。
- smoke 断言区段数 4，切到该段后挂载真实表单（开关 1、输入 ≥5、多行 1、含 Base URL）且栅格为一或两栏。

实测：`sectionCount 4`、切段断言全绿；Lab 组件树 19 → 20 个组件。

## 切片 5：Web 工具区段（已完成）

产出：

- `settings/sections/web/web-settings-draft.ts`：草稿模型与序列化规则的唯一出口（优先级规范化、上下移边界、provider 密钥三态、数字回落默认值、`buildWebPayload()`），并配 `web-settings-draft.test.ts` 覆盖这四类边界（4 用例）。
- `settings/sections/web/WebSettingsView.vue` + 同名文档：搜索服务（默认服务下拉 + `Fallback:` 顺序提示、两个 provider 行含上移下移与开关、密钥 + 清除、超时，Brave 另有国家与搜索语言）、本地抓取（开关 + 五个限额）、Tavily 兜底（开关 + 超时）。短字段并排按视图自身容器宽度决定。
- `component-lab/fixtures/WebSettingsViewFixture.vue`（default / configured / brave-first / local-fetch-off / saving / save-error / disabled）；外壳第五个区段「Web 工具」。
- smoke 断言区段数 5，切到该段后挂载真实表单（2 个 provider 行、4 个开关、4 个上移/下移按钮、含 Fallback 提示）。

实测：`sectionCount 5`、切段断言全绿；Lab 组件树 20 → 21 个组件。

过程中被 smoke 的 console 守卫抓到一处真实缺陷：provider 行曾用 `settings.panels.web.disabled` 这个不存在的 i18n key。旧面板本来没有启用状态文字（开关本身表达状态），因此删掉那枚重复徽标而不是新增文案。

## 切片 6：密码保护 / 编辑器 / 桌面应用三小节（已完成）

产出：

- `settings/sections/editor/editor-prefs.ts` + 测试：数值区间与步长（`MARKDOWN_NUMBER_LIMITS` / `MONACO_NUMBER_LIMITS`）、字体候选、`clampEditorNumber` / `clampMonacoNumber` 与 `editorFontLabel`。区间同时是控件 `min` / `max` / `step` 与夹紧逻辑的唯一来源。5 个用例覆盖越界夹紧、区间内小数透传、空串与非数字返回 `null`、候选表完整性。
- `settings/sections/editor/EditorSettingsView.vue` + 同名文档：Markdown 正文档（字体 / 字号 / 行高 / 正文宽度 / 段首缩进）与 Monaco 段（字体 / 字号 / 行高 / Tab Size / 四个开关），两块各带「重置」，重置只发 `reset` 事件由宿主决定重置成什么。
- `settings/sections/desktop/DesktopSettingsView.vue` + 同名文档：说明块（连接方式 + 版本）、缩放滑杆（0.75–2，百分比贴在标题右侧）、托盘开关、关闭行为下拉。视图里没有 `window.neuroBookDesktop`——探测与拉取时机是宿主策略；`status` 为 `null` 时只少一行版本说明。
- `settings/sections/security/SecuritySettingsView.vue` + 同名文档：只读三件套（说明、`auth.enabled` 三态徽标、`config.yaml` 示例 + 警告），无 emit、无保存入口。
- 三个 fixture（EditorSettingsView 4 场景 / DesktopSettingsView 3 场景 / SecuritySettingsView 3 场景）与注册表条目；外壳 fixture 解禁 `启动` 与 `本机` 两档作用域并各挂三个新区段体，四个作用域现在都能进入。
- smoke 扩展：`scopeDisabled` 2 → 0；新增「启动作用域（1 区段 + `auth.enabled` + 示例 YAML + 三态文案）」「本机作用域（2 区段）」「编辑器区段（7 个数字字段 + 两处字体联想 + 5 个开关 + 段首缩进禁用态）」「桌面应用区段（0.75–2 滑杆 + 100% + 1 开关 + 1 下拉）」四段。

实测（Lab smoke 输出）：`scopeDisabled 0`、`sectionCount 5`、`nestedViews 1`、`overflow 0`；启动段 1 区段（当前项「密码保」）、本机段 2 区段、编辑器段 7 个数字输入 / 2 处字体输入 / 5 个开关 / 1 个禁用数字输入、桌面段滑杆 `0.75–2` 与 `100%`。

两处与计划文本的有意偏差：

- 字体的候选联想用 nb-ui `Autocomplete`（真输入框 + 联想浮层），不是 `FormInput` + `datalist`：`FormInput` 不透传 `list`，`datalist` 挂不上。smoke 相应改为断言两处 `input[placeholder="输入 CSS font-family"]`，而不是 `datalist` 计数。
- 段首缩进关闭时，缩进量输入框保持可见但 `disabled`（计划里曾写「默认态禁用数为 0」，实际是 1）：这与旧宿主一致，也让「关闭后缩进量是否还在」可预期。

## 切片 7：模型区段渲染层（已完成）

产出：

- 模型子组件与纯模块搬进 `settings/sections/providers/`：`NovelIdeModelSelect.vue`、`SavedModelsList.vue`、`AgentVisibleModelsEditor.vue`、`model-settings-view.ts`、`model-settings-draft.ts`、`model-draft-factory.ts`、`model-cost-draft.ts` 与三个测试。四个会话文件留在 `settings/`（它们做 I/O，本片不动）。导入点全量重写：除旧面板外还有 `AgentSessionModelControls.vue`（会话级模型下拉）与四个会话及其测试，共 20 个文件。
- `views/model/ProviderSettingsView.types.ts` + `ProviderSettingsView.vue` + `ModelProviderRail.vue` + `ModelProviderDetail.vue` + 同名文档：区段标题与说明、草稿问题横幅、默认模型与「新增 Provider」、Agent 可见模型，以及 global 下的 Provider 双栏（导轨 + 连接表单 + `SavedModelsList`）。视图吃 props、emit 动作，字段改动统一走 `update:draft`；唯一自持状态是分组折叠。
- `component-lab/fixtures/ProviderSettingsViewFixture.vue`（default / project / no-provider / disabled-models / saving / save-error / loading）与 `fixtures/model-settings-fixture-data.ts`（假数据构造与设置外壳 fixture 共用）；外壳第六个区段「模型设置」，smoke 断言区段数 6 与模型段结构。
- `SavedModelsList.vue` 的模型行加 `data-saved-model-row`（唯一新增钩子，不改渲染）。

实测（Lab smoke 输出）：`sectionCount 6`、`activeSections 1`、`nestedViews 1`、`overflow 0`；模型段 1 个 Provider 导轨项 / 2 个已保存模型行 / 1 个密钥输入 / 2 个数字字段 / 1 个多行输入。组件级实测（1920 宽画布）：模型视图容器宽度 1156px、双栏 `260px 896px`、导轨项 1、已保存模型行 2；外壳组合（444px 内容列）下退化单列仍渲染 1 个导轨项。

三处与计划文本的有意偏差：

- 计划里模型段 smoke 要断言「1 个开关（Provider 启用开关）」，但旧宿主的 Provider 启停本来就是按钮而不是开关，本片保留按钮：改为断言结构性钩子（密钥输入、两个数字字段、一个多行输入），不为了断言去改控件形态。
- 双栏阈值从计划的 900px 改成 700px：产品里模型区段的内容列最宽约 780px（1100px 窗口 − 276px 导轨 − 内边距），900px 永远不成立；700px 与外壳的单列阈值同档。
- `modelInputOptions`（模型输入能力下拉项）只在编辑对话框里用到，按切片边界挪到切片 8 再加，本片不先摆一个没人用的 prop。

过程中的一个坑：新增 fixture 后 Lab 有时不会重挂画布（HMR 只换了组件树条目），第一次截图拿到的是上一个组件的画面——验证新 fixture 要整页刷新，不能只看画布标题。

## 切片 8：模型区段对话框层（已完成）

产出：

- 三个对话框搬进 `views/model/`：`NovelIdeModelEditDialog.vue`、`ModelDiscoveryDialog.vue`、`ModelLibraryDialog.vue`（只有旧面板导入它们，改动面最小）。
- `ProviderSettingsView` 挂上五个对话框：编辑设置、模型发现、Model Library、校验问题全列表、删除 Provider 确认。开关全部是 props（`validationDialogOpen` / `deleteProviderDialogOpen` / `modelEditDialogOpen` / `discoveryDialogOpen` / `modelLibraryDialogOpen`），开关与关闭各有同名 emit；编辑对话框要用的五个派生文案（上下文窗口 / 最大输出 / 输入能力 / 推理能力 / 分组）由本层用共享纯模块算好，不额外占用 props。
- fixture 场景从 7 个增到 12 个（问题列表 / 删除确认 / 编辑模型 / 模型发现 / Model Library）；外壳 fixture 增加一个对话框开关与对应 handler（否则外壳里点不开），并复用同一份发现结果、Model Library 与手工草稿样例。
- smoke 新增「模型区段对话框」一段：点「编辑设置」应打开带四个页签的编辑对话框，Escape 关闭后不得残留可见 surface；点「从 Model Library 添加」应打开模型管理库对话框。

实测：`sectionCount 6` 不变，切段与对话框断言全绿，`overflow 0`；编辑对话框 980×760、页签「基本信息 / 能力与限制 / 请求参数 / 价格」齐全，同一时刻只有一个可见 `[data-dialog-surface]`，Escape 可关闭；模型管理库对话框标题与说明正常。

过程中被 smoke 的 console 守卫抓到的真实缺陷：app 公共 `Dialog` 默认 teleport 到产品外壳的 `.novel-ide-theme`（`IDE_THEME_HOST_CLASS`），Lab fixture 里没有这个宿主，于是挂载即报 `Failed to locate Teleport target` 加一次 unmount TypeError。当时的修法是两个 fixture 的根节点带上同一个宿主类名；**切片 9 已把设置视图里的 app `Dialog` 全部换成 nb-ui 对话框族，这条修法连同宿主类名一起撤掉了**。

另一个坑：模板里的 `$event` 只带第一个参数，多参 emit（`toggle-model-input`、`update:discovery-manual-field`）必须写成箭头函数或具名方法，否则第二个参数静默丢失。

## 切片 9：目录命名、窗口层级与对话框收口（已完成）

开发者 2026-09-10 反馈三条：模型区段要能嵌在 `DialogWindow` 里看；内部对话框要复用 `DialogWindow`，而 `DialogWindow` 得有层级；`views` / `model` 这类目录命名与层数要交代。

产出：

- **改名**：`settings/views/` → `settings/sections/`，与代码里已有的 section 词汇（`SettingsSectionOption`、`sectionCount`、`.settings-detail-section`）对齐，层级仍是两层；43 处引用（代码、fixture、spec、工作记录）一次性重写。命名规则写进本 README：区段目录内部超编时在该区段内加第三层，不整体加深。**切片 10 已把这个第三层落地为 `components/` 子桶。**
- **DialogWindow 层级**（nb-ui）：`z-index` 与浮层注入值改为按嵌套深度计算——外层窗口 8990 / 外层下拉 8991 / 内层窗口 8992 / 内层下拉 8993，整档压在模态 `Dialog`（9000）之下，最多 5 层；新增 `NB_DIALOG_WINDOW_DEPTH` 注入键与 `NB_DIALOG_WINDOW_Z_STEP`。nb-ui 新增一条嵌套测试（`components.test.ts`），测试数 265 → 266。
- **对话框迁到 nb-ui**：编辑设置、模型发现、Model Library、校验问题全列表改用 `DialogWindow`（非模态浮动窗口，正是「边改边看」的场景）；删除 Provider 是不可逆确认，留在**带遮罩的模态** `nb-ui Dialog` ——依据是 `DialogWindow` 自己的组件文档写着「不支持替代 Dialog 承担确认流程」。旧 app `Dialog` 在设置视图里清零，两个 fixture 因此不再需要 `fixture` 里那个 `.novel-ide-theme` teleport 宿主。
- **对话框成为独立组件**：三个对话框各有 `.md` + fixture（`NovelIdeModelEditDialog` 3 场景 / `ModelDiscoveryDialog` 4 场景 / `ModelLibraryDialog` 3 场景）并登记进 Lab；`ProviderSettingsView` 的对话框场景撤掉，改为新增 `dialog-window` 场景——把视图摆进 `DialogWindow`，也就是产品承载它的方式。Lab 组件树 25 → 28 个组件。
- **派生助手内收**：编辑对话框需要的七个函数型 props（分组默认值、上下文窗口 / Max Tokens 占位、输入能力与推理能力展示名、输入能力选项表）改为对话框内部计算，调用方只传数据。
- smoke 新增「模型对话框嵌在设置窗口里」一段：外壳窗口 8990、内层窗口 8992、Escape 只关内层。

实测：nb-ui 15 文件 / 266 测试通过；neuro-book 48 文件 / 364 测试通过；smoke 全绿（`sectionCount 6`、`overflow 0`、嵌套层级与 Esc 断言通过）；四个窗口实测几何：模型区段在窗口内 1100×820（left 250 / top 90）、编辑窗口 980×760、发现与模型库各 800×850，`z-index` 均为 8990，控制台无错误。

两个坑：

- Lab 会把上次选中的组件与场景记在 localStorage 里，截图脚本第二次运行会被上一次留下的浮窗挡住组件树；每个视图用独立浏览器上下文、并在场景已被自动选中时跳过点击，才稳定。人肉验证同理：画布上已有窗口时先按 Escape 关掉。
- 本轮我自己踩过一次取证错误：直接读 `packages/nb-ui/...` 读到的是**主工作区**（master）的旧版本文件，差点据此判断「DialogWindow 没有缩放手柄」。读本分支代码必须走 `.worktree/w00003-.../` 前缀或用带 `cwd` 的命令。

## 切片 10：区段目录按角色分类（已完成）

开发者 2026-09-10 反馈：两级目录不够用，`ProviderSettingsView` 的子组件应该放到一起——「这些子组件几乎没有被复用的可能，拆分组件就是为了好组织」。反馈同时暴露了一个真实的不一致：Lab 树的分类取决于「这个区段有没有自己的目录」，所以九个区段视图全挤在 `sections` 一组，而模型的却在 `model` 一组。

产出：

- **目录形状**：`settings/sections/<区段>/` 放**区段入口**（`.vue` + 同名 `.md` + `.types.ts`）与**纯模块**（草稿 / 序列化 / 夹紧 + 各自测试）；`settings/sections/<区段>/components/` 放**只被该区段使用的子组件**，包括三个模型对话框（各带同名 `.md`）。九个区段视图全部搬进自己的区段目录；外壳 `NovelIdeSettingsView` 留在 `sections/` 根——它是容器，不属于任何区段。
- **索引分组**：`component-index.ts` 的分组规则从「父目录名」改成「最近的、不叫 `components` 的那层目录」。`components/` 是私有子桶，它们与所属区段归成一组，而不是汇成一堆叫 `components` 的条目。
- **改动面**：约 60 个文件移动，引用分三类重写——`nbook/app/...` 绝对形式、fixture 里的相对形式、以及同一模块在「区段根」与「components 子桶」两种位置下不同的相对深度（`./x` 对 `../x`）。

实测（Lab 树分组）：`agent-profile: 9`、`model: 4`（含三个对话框）、`cost` / `desktop` / `editor` / `embedding` / `observability` / `security` / `web` 各 1、`sections: 1`（外壳）；`common` / `component-lab` 不受影响。测试 57 文件 / 399 项通过，nb-ui 15 文件 / 266 项通过，smoke 全绿，`vue-tsc` / `scripts:typecheck` / `docs:check`（5461 文件）/ `governance:check` 全通过。

一个坑：同一份模块在两种位置下的相对路径方向相反（区段根是 `./model-settings-draft`，子桶里是 `../model-settings-draft`），批量替换很容易只改对一半；这次以 `vue-tsc` 的报错清单逐条收尾，比肉眼可靠。

## 切片 11：Lab 树改成多级目录（已完成）

开发者 2026-09-10 追问：Lab 树的分组为什么没有多级目录。原因是数据模型而非 UI——`component-index.ts` 每个组件只产出一个 `group: string`（某一层目录名），`LabShell` 再把它渲染成同级组；而 nb-ui 的 `Tree` 本身支持 `children`。

产出：

- **索引**：`LabComponentEntry` 新增 `groupPath: string[]`——相对**组件根**的完整目录路径（按 glob 根段数裁掉 `../components` 与 `.`，它们是 glob 的前缀不是分类）。`group` 保留为「最近的、不叫 `components` 的那层」，右栏显示人类读的那一档。排序改为按完整路径。
- **LabShell**：按 `groupPath` 建多级树（目录在前、组件在后，各按名字排）；搜索直接在入口列表上过滤，没有命中的分支根本不会出现，不需要事后剪枝；折叠状态的 id 是路径前缀（`group:novel-ide/settings/sections/providers/components`）。

实测树（节选）：

```
common
  JsonViewer
component-lab
  CollapsibleSidePanel / EventLogPanel / HighlightBox / MarkdownView / SurfaceTierDemo / ViewportCanvas
novel-ide
  settings
    sections
      agent-profile
        components
          AgentProfileCustomSettingsSection / … / AgentProfileNavList
          AgentProfileSettingsView
      model
        components
          ModelDiscoveryDialog / ModelLibraryDialog / NovelIdeModelEditDialog
          ProviderSettingsView
      cost / desktop / editor / embedding / observability / security / web …
```

两个连带发现（都已修）：

- 排序改成按完整路径后，Lab 的**默认预览组件**从 Agent Profile 系变成了 `CollapsibleSidePanel`（`component-lab` 目录排最前），而这个组件自己就渲染一个导航面板——于是 `smoke` 里「点导航面板第二格进入检查模式」的选择器在 strict 模式下命中两个元素。修法不是改回排序，而是把 smoke 的组件树选择器全部限定到左栏（`.lab-columns > .nb-lab-panel--nav`，4 个文件 9 处）：画布里预览的东西本来就可能是同类零件，靠「全局只有一个」是不成立的假设。
- `groupPath` 最初把 glob 根（`components`、`.`）也当成分类 → 树根多出一层噪音，按 glob 根段数裁掉。

门禁：`vue-tsc`、`scripts:typecheck` 通过；测试 48 文件 / 364 项通过；Lab smoke 全绿（含嵌套窗口层级断言）。

## 切片 12：Lab 侧栏可拖宽 + 左栏默认加宽（已完成）

开发者 2026-09-10 要求：左右两条侧栏都能拖拽调宽，左栏（组件树）默认调宽一点。

产出：

- **宽度进偏好存储**：`LabPreferences` 新增 `leftPanelWidth` / `rightPanelWidth`，与主题、画布尺寸、收起状态同一份存储；`LAB_PANEL_WIDTH_LIMITS`（左 220–560 / 右 280–720）由拖拽与恢复共用，避免两处各夹一次。越界、非整数、其它类型的值**丢弃而不是夹紧**——夹紧会把「上次拖动留下的旧值」静默变成另一个宽度。
- **LabShell**：两条零宽拖拽条（`role="separator"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax`，方向键把边往按键方向推、Shift 步进 1px，与 `DialogWindow` 的缩放手柄同一套语义）。夹紧同时考虑另一栏当前宽度与画布的可用下限（560px），收起的那一栏按导轨宽度（40px）算。
- **默认值**：左栏 240 → **300**（切片 11 之后树是多级的，最深五级路径要放得下）；右栏维持 380。「恢复 Lab 默认配置」一并复位两栏宽度。

实测（真实浏览器，独立的临时脚本，已删除）：初始 `[300, 380]`、中间栏 872px；拖左栏那条边 +80px → `[380, 380]`、中间栏 792px；**刷新后仍是 380**（落盘生效）；聚焦手柄按 10 次 ArrowLeft → 280；两次测量中栏间缝都是 12px。

一处实测发现的偏差：拖拽条第一版用 `margin: 0 -12px` 抵掉了**两**份 gap，三栏之间的缝变成 0——改成两侧各抵半份（`calc(var(--space-5) / -2)`）后缝保持 12px，手柄正好落在缝中间。

smoke 的视口从 1440×900 改成 1600×1000：左栏加宽后画布只剩 872px，画布里的设置外壳（需要 ≥700px 才保持双栏）会退化，属于视口预算问题而不是回归。

门禁：`vue-tsc`、`scripts:typecheck` 通过；component-lab 5 文件 / 11 项测试通过（新增宽度落盘与越界丢弃断言）；Lab smoke 全绿。

## 切片 13：验收反馈的第一批修复（已完成）

开发者 2026-09-10 的验收反馈里，属于本批次范围的已修：

- **Lab 组件树**：展开/收起的箭头改成换图标（`chevron-right` / `chevron-down`）而不是把同一个图标转 90°——12px 上旋转的雪佛龙会被读成歪了一点；分组行补上目录图标，此前只有叶子有图标，导致组名从图标列起排、两级标题对不齐。叶子图标改为**按组件分类**给（`component-index.ts` 新增 `kind`：view / dialog / section / field / list / panel / part，按名字后缀派生），不可挂载仍然是锁（约束优先于类型）。
- **UI 规范与检查清单**（开发者要求沉淀）：`design-language.md` §九 新增两条判据——「内边距只有一层：窗口 body 的 `px-4 py-3` 与内容页面边距不叠加，两层会到 24–32px」与「说明『这一页 / 这一节是什么、写到哪』的元信息不单独占行，走 tooltip」；`ui-development-spec.md` §13（DialogWindow）与 §5（表单与无障碍）各加对应条目。
- **窗口内边距**：Lab 的 `dialog-window` 场景给外壳传 `body-class="!p-0"`——外壳自带的 `--space-6` 页面节律已经是一层，窗口 body 的 16/12 叠上去就是「内容被挤在中间」。产品接线时同处理（已写进规范与清单）。
- **「已启用模型」的违和面色**：`SavedModelsList` 里那一层是遗留的卡片面（`bg-[var(--bg-panel)]` + 描边 + `shadow-sm`），落在窗口里正是规范里写的「浮层 body 里的分栏不画第二层面」。按该条去掉所有嵌套面色，分隔改回 `--divider` 横线；行内按钮的几何留到 t18 的 Provider 页重做时一起收。

同时观察到一条既有 flaky：`components.test.ts` 的 “grows upwards and leftwards when dragging the top-left corner” 在 jsdom 里偶发（同一天内一次失败一次通过），与本次改动无关，未动它。

## 外壳验收里尚未处理的（2026-09-10 反馈）

`NovelIdeSettingsView` 的两条反馈：窗口内边距偏大（已修，见切片 13）与「感觉有点不是很和谐」。后者的分析结论——三条可验证的偏差，尚未动代码：

1. **窗口尺寸不跟内容走**：`启动` 作用域只有一节（密码保护），却撑在 `size="lg"`（1100×820）的窗口里，导航轨 276px 之外整片是空的。判据是「内容列宽 / 窗口宽」：安全页不足 40%。可选修法：按作用域内容量选 `size`，或让内容列封顶（阅读型区段按规范 ≈768px），两条都指向同一个结论——现在缺的是宽度纪律。
2. **内容列没封顶**：`SecuritySettingsView` / `DesktopSettingsView` 这类阅读型区段的内容铺满整幅，而规范里写着「宽窗口（≥1400px）下内容列封顶 ≈768px，控件不随窗口拉成整行宽」。当前只有 fixture 包了一层 `max-w-3xl`，产品路径还没有。
3. **说明块的层级靠颜色不靠结构**：安全页顶部的说明块是「图标 + 标题 + 段落」连在一行里，与下面正文的视觉重量几乎一样；按 §二 它应当是一块**说明**而不是一节正文（用 `--status-info` 的语义 + 更小的字号档，或者并进 tooltip）。

这三条都属于设置外壳自身的宽度与层级纪律，与本批次「只做组件 + Lab」的边界一致，但需要单独一次 UI 调整。**2026-09-11 的第二批修复（切片 15）没有覆盖它们**：三条至今仍然待办，产品路径上仍未加宽度纪律。

## 切片 15：验收反馈的第二批修复（已完成）

开发者 2026-09-11 的第二批验收反馈，属于本批次范围的已修（角色页重设计与 Provider 模块改名归 t18，见其记录）：

- **区段导航的重命名、排序与裁剪**：`Agent Profile 模型` → `Agent Profile`；`Provider` 提到第一位；`角色` → `模型角色` 并排在第二位；「全局默认模型」与「Agent 可见模型」两个区段整体删除（视图 / 文档 / fixture / 注册表 / smoke 断言 / i18n 死键一并清）。外壳区段数 9 → 7。
- **下拉外观统一**：`NovelIdeModelSelect` 一直包着**旧 app** 的 FormSelect，是设置界面里唯一一处外观不同的下拉。改成包 nb-ui 的 `FormSelect`（`allowDefault` 的哨兵值、`null` ↔ `""`、`disabled`、`placeholder`、`dropdownDirection` 逐项对齐），消费方（宿主默认模型选择、Agent Profile 视图）随之统一。
- **区段切换动效**：`NovelIdeSettingsView` 的区段体改为 keyed `Transition`（短位移 + 淡入），时长与缓动只消费动效 token（`--motion-base` / `--motion-fast` / `--ease-standard`），不写字面量。切换本来就会卸载区段（`v-else-if` 链），因此不引入新的状态丢失。
- **加载态与失败态重设计**：加载失败从「红色块 + 独立按钮」改成一行普通内容（图标 + 原因 + 「重新加载」），不再强行改布局；加载态换成更轻的骨架（一行说明 + 三条与字段节奏一致的占位）。这两处是开发者原始反馈「加载失败时那个框很丑，加载中也很丑」的直接回应。
- **嵌套窗口的面色**：`DialogWindow` 在 `windowDepth > 1` 时不再做玻璃，改用层级色 `--panel-surface`——材质只有一层，玻璃叠玻璃在 Web 上采不到可采样内容（`backdrop-filter` 不在链上叠加），二级窗口本来只会读成一块发灰的板。规范补丁见下。
- **Web 工具区段重设计**：搜索服务从「写死的 Tavily / Brave 两个分支」改成 `SEARCH_PROVIDER_CATALOG` 驱动的列表（服务、图标、说明、独有字段都在表里），页面按「搜索服务 / 通用设置」两块重排，为「以后十几个服务」准备好扩展点；顺带修掉草稿里把空串写成 `0` 的既有 bug（`Number("") === 0`，现在空串按「未配置」回落文档默认值）。

规范与清单（本轮沉淀四条）：

- `design-language.md` §二「玻璃是三层叠出来的」由三条边界扩为**四条**，新增「玻璃叠玻璃不成立，二级及更深浮层直接用层级色」（判据：嵌套窗口 `backdrop-filter: none`）；§九「弹出层」检查表加同款一条。
- `design-language.md` §七新增「**内容切换走 `--motion-base`，不是浮层档**」：区段体/标签页换页用 opacity + 短横向位移，不入场档、不加 scale，并在 §九「动效」检查表加一条判据。
- `ui-development-spec.md` §4.1「状态下限」补入加载态与失败态的形态约束：骨架与真实内容同节奏、失败是一行普通内容（图标 + 原因 + 重试），不用带底色边框的独立色块。

## 切片 16：验收第三批 + 三条独立审查的收口（已完成）

开发者 2026-09-11 的第三批反馈（7 条）与本轮三份独立审查（`ReviewShellRestructure` / `ReviewRedesigns` / `ReviewShellUx`）的收口。角色页与 Provider 模块改名归 t18。

**组件缺陷（本轮最重要的发现）**：`Switch` 开启态滑块溢出轨道，根因**不在 Switch**——页面同时装着应用自己的 UnoCSS 与 nb-ui 编译的 Tailwind v4，两者都会生成 `.translate-x-4` / `.rotate-180` 这类同名类但语义不同（v4 写 `translate:` / `rotate:` 独立属性，UnoCSS 写 `transform`），同名类叠加时两个属性各生效一次，**位移与角度翻倍**。这解释了 Switch 滑块溢出，也解释了另一批「看着没转」的 chevron。处置：`packages/neuro-book/uno.config.ts` 加 blocklist，名单**从 nb-ui 的发货产物现读**（不手抄，nb-ui 改用法后自动跟上），只封 nb-ui 真正发货的名字——一刀切封整个 `scale-*` 家族会连应用自己在用的 `hover:-translate-y-0.5` 一起封掉。另修 `Switch` 自身的内边距算术：1px 透明边框要计入（`p-0.5` 让内容区只剩 14px，装不下 16px 滑块）。

**外壳**：区段切换的两段各取 `--motion-fast`，与左栏导航选中态同档（`out-in` 两段合计 90+90 = 180ms = `--motion-enter` 上限）；加载态与失败态改为**占满内容区**的一屏（加载：指示 + 说明；失败：图标 + 原因 + 重试），都带可播报语义（`role="status"` / `role="alert"`），不再画骨架与行内色块；左下角版本标识拆成「等宽版本号 + 环境软标注」并以发丝线与导航分开；新增 `sections/components/ProjectSwitcher.vue`，「项目」作用域的左栏这一行从只读标签变成可切换的项目选择。

**重设计**：Web 工具的「清除」回到 nb-ui `Button`（danger）；写回体与 `SEARCH_PROVIDER_CATALOG` 加结构断言（加服务时漏改写回段先红）。

**修掉的产品回归（审查发现，Lab 看不见）**：`NovelIdeModelSelect` 换 nb-ui `FormSelect` 后浮层走 body portal，缺省 z=60，被产品设置对话框的遮罩（z-9000）压住——旧面板今天就在用它。已在 `components/common/Dialog.vue` 提供 `NB_POPOVER_Z_INDEX = NB_Z_INDEX.dialog + 1`，并给会话模型浮层补 `onClickOutside` 的 ignore。同类回归：区段内容槽的 keyed 包装层缺 `h-full` 会让区段体的百分比高度失效（Agent Profile 丢失内部滚动），已补。

**规范补丁（本轮共 6 条）**：`design-language.md` §二 边界 4（嵌套浮层不做玻璃 + 不挂镜面层）、§七「内容切换」按 `out-in` / 交叠两套配方与两栏时长一致、§九 两条判据、`ui-development-spec.md` §4.1（页面级加载/失败态占满区域 + 可播报）、`packages/nb-ui/src/styles.css`（装饰性关键帧动画服从降级偏好）。

**已知抖动**：`scripts/smoke/agent-profile-nav.ts` 的「长列表必须由列表自身滚动」在本轮出现过一次失败、随后连续两次通过；断言已补上量值（`JSON.stringify(metrics)`）便于下次定位。

## 切片 14：验收推动的区段拆分（已完成，归 t18）

t17 交付的 `ModelSettingsView` 在验收里被判为「一页塞三件事」，拆分工作移交 t18 并已完成：Provider 页改名并只留 Provider 与模型清单（新增入口挪进导轨）、默认模型与可见模型各自成为区段、新增角色区段（UI 先行）。外壳区段数 6 → 9，测试 48/364 → 49/369。详细清单见 [`tasks/t18-provider-and-role-settings/README.md`](../t18-provider-and-role-settings/README.md)。

## 剩余工作（尚未开始）

本 Task 的切片已全部完成。2026-09-11 收口后，外壳是 7 个区段（Provider、模型角色、Agent Profile、Web 工具、向量嵌入、费用显示、可观测）＋ 两个作用域专属小节（`启动`→密码保护，`本机`→编辑器 / 桌面应用），全部是 Lab 可预览、可调试的受控视图。

仍然不在本 Task 内、需要独立任务的两块：

1. **产品宿主接线**（路线第 5–7 步）：把 `NovelIdeSettingsDialog` 的旧面板换成 `settings/sections/` 下的受控视图（`WebSettingsView` 的接入前检查见本节末），并按「返工风险清单」先清掉双份序列化、`SettingsSavePanelExpose` 协议、fixture 自造的作用域矩阵与尺寸来源；接线时一并处理「外壳验收里尚未处理的」三条（窗口尺寸跟内容走、内容列封顶、说明块层级）。
2. **`frontend`（主题）区段**：含主题卡片与主题编辑器，属主题 authority，需主题侧独立任务。

产品宿主接线仍属路线第 5–7 步，不在本 Task 内。

## WebSettingsView 接入前检查（2026-09-11）

**解耦：干净。** 视图只依赖 vue / nb-ui / 同目录草稿模块 + `useI18n`；对 store、API、路由、`window`、`document`、持久化零引用（扫描 `sections/web/` 无命中，唯一命中是文档里的说明句）。草稿模块只 import `nbook/shared/dto/config.dto` 的类型。

**数据契约：对齐，两个缺口已补。**

- 草稿↔`WebConfigDto` 逐字段核对：`search.order` / 两个 provider 的 `enabled`·`apiKey`·`timeoutMs`·`country`·`searchLang` / `fetch.local` 六项 / `fetch.tavilyFallback` 两项——**DTO 里的字段全部被视图覆盖，没有会静默丢的段**。
- 补 ①：草稿模块缺 **config → draft** 的加载方向（旧面板私有 `applySettings()` 里才有）。已加 `createWebSettingsDraftFromConfig()` + 往返不变量测试；可空超时按空串回装，避免 `null` 被悄悄写成默认数字。
- 补 ②：`country`（恰好 2 字符）与 `searchLang`（2–5）是 DTO 约束，视图原本不拦。约束写进 `SEARCH_PROVIDER_CATALOG` 并绑到输入上。
- 已知的契约边界：`search.providers` 在 DTO 里是**固定两项**的 zod 对象（多余键会被 strip），`search.order` 是固定枚举。「加服务只改一张表」指**前端**侧——后端契约要同步改，漏改时 `web-settings-draft.test.ts` 里那条「写回体服务键与 catalog 一一对应」的断言会先红。
- 作用域：`web-tools` 只出现在产品的 `globalConfigSections`，Project 级 DTO 没有 `web` 段，视图按「只做全局」用是对的。
- 接线注意：产品的区段标签来自 `settings.section.*` i18n，Lab fixture 是自造的字面量；宿主必须把产品矩阵（含新增的 `roles`）喂给外壳，否则 Lab 与产品会各显示一套。

## 返工风险清单（接线前必须处理）

这几项属于「现在不管、以后返工很贵」的类型，按严重度排：

1. **双份序列化逻辑**：`NovelIdeEmbeddingSettingsPanel` / `NovelIdeWebSettingsPanel` / `NovelIdeCostSettingsPanel` / `NovelIdeObservabilitySettingsPanel` 各自还留着一套 payload 构造与密钥语义，`sections/*` 下的 draft 模块是另一套（**Web 已经两个方向都在模块里**：`createWebSettingsDraftFromConfig()` 与 `buildWebPayload()`；接线时删掉旧面板的 `applySettings()` 与它私有的 payload 构造，不要再抄一份）。产品接线时必须让旧面板改调新模块（或直接删除旧面板），不能让两套长期并存——配置写回规则一旦漂移，两边都会写错同一个配置段。
2. **`SettingsSavePanelExpose` 协议会整体消失**：旧宿主靠 `defineExpose({dirty, loading, saving, saveSettings, restoreSettings})` 驱动顶部保存 / 恢复栏，新视图是就地保存。接线时这套 expose 合同、保存栏、`settingsPanelKey` 重置逻辑要一次性删干净，不能留一半。
3. **作用域→区段矩阵目前是 fixture 自造的**：产品真值在 `NovelIdeSettingsDialog` 的 `globalConfigSections` / `projectConfigSections` / `browserSections` / `bootConfigSections` 里。外壳吃的是 props，接线时必须从产品矩阵喂进去（或先把矩阵抽成共享模块），否则 Lab 里的区段集合会和产品不一致，而这种不一致看起来完全正常。
4. **尺寸只有一个来源**：`DialogWindow` 的 `size` 字面量是缺省，显式 `width` / `height` 覆盖对应维度。场景里不要同时写死预设与同样的数字（设置外壳 fixture 已改成拖动后才接管受控值），否则预设一改就会静默停在旧尺寸。

2026-09-10 独立审查（`ModelSectionReview`）新增三条，按严重度排：

5. **产品宿主与新对话框的层级冲突（阻断，接线前必须先决定）**：设置宿主 `NovelIdeSettingsDialog` 仍是旧 app `Dialog`（`fixed inset-0 z-[9000]` + 不透明遮罩，teleport 进 `.novel-ide-theme`），而模型区段的编辑 / 发现 / 模型库 / 校验列表已改成 `DialogWindow`（8990，默认 teleport 到 `body`）。两者在同一根层叠上下文里按数值比较，于是**产品路径下这些窗口连同遮罩一起被设置面板盖住**，看不见也点不到；改造前它们同为 app `Dialog`（同 9000、DOM 更晚 → 压在外层之上），所以这是就地换组件引入的行为回归。Lab 看不到，是因为外壳 fixture 自己也换成了 `DialogWindow`（8990 vs 8992）。二选一：接线时把宿主一并换成 `DialogWindow`，或给这三个对话框透传 `teleport-target` 到宿主窗口子树内部（不要用默认的 `body` 8990）。

  **决策（2026-09-11，开发者）**：保持现状、记录在案，**随产品宿主接线一起换**（即接线时把宿主换成 `DialogWindow`）。在此之前 Lab 是唯一验收路径，产品路径下这些窗口仍会被设置面板盖住——这是已知且已接受的现状，不是新发现。
6. **同级浮动窗口按模板顺序叠放**：`DialogWindow` 的层级目前只按嵌套深度算，没有父子关系的两个窗口拿同一个 z，靠 DOM 顺序决定谁在上面。把这几个窗口节点重排（或在同一层再加一个），就会出现「点了没反应」。
7. **非模态窗口的目标会跟着走**：发现 / 模型库窗口的内容取自当前活动的 Provider，而 Provider 导轨就在同一个视图里、不再被遮罩挡住。窗口开着时切换 Provider 再点写回，模型会落进另一个 Provider；`confirmMode` 的编辑窗口也会被身后的「编辑设置」悄悄换掉目标。接线时按「打开窗口时冻结目标 Provider」实现。
