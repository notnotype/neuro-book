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

- 模型子组件与纯模块搬进 `settings/sections/model/`：`NovelIdeModelSelect.vue`、`SavedModelsList.vue`、`AgentVisibleModelsEditor.vue`、`model-settings-view.ts`、`model-settings-draft.ts`、`model-draft-factory.ts`、`model-cost-draft.ts` 与三个测试。四个会话文件留在 `settings/`（它们做 I/O，本片不动）。导入点全量重写：除旧面板外还有 `AgentSessionModelControls.vue`（会话级模型下拉）与四个会话及其测试，共 20 个文件。
- `views/model/ModelSettingsView.types.ts` + `ModelSettingsView.vue` + `ModelProviderRail.vue` + `ModelProviderDetail.vue` + 同名文档：区段标题与说明、草稿问题横幅、默认模型与「新增 Provider」、Agent 可见模型，以及 global 下的 Provider 双栏（导轨 + 连接表单 + `SavedModelsList`）。视图吃 props、emit 动作，字段改动统一走 `update:draft`；唯一自持状态是分组折叠。
- `component-lab/fixtures/ModelSettingsViewFixture.vue`（default / project / no-provider / disabled-models / saving / save-error / loading）与 `fixtures/model-settings-fixture-data.ts`（假数据构造与设置外壳 fixture 共用）；外壳第六个区段「模型设置」，smoke 断言区段数 6 与模型段结构。
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
- `ModelSettingsView` 挂上五个对话框：编辑设置、模型发现、Model Library、校验问题全列表、删除 Provider 确认。开关全部是 props（`validationDialogOpen` / `deleteProviderDialogOpen` / `modelEditDialogOpen` / `discoveryDialogOpen` / `modelLibraryDialogOpen`），开关与关闭各有同名 emit；编辑对话框要用的五个派生文案（上下文窗口 / 最大输出 / 输入能力 / 推理能力 / 分组）由本层用共享纯模块算好，不额外占用 props。
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
- **对话框成为独立组件**：三个对话框各有 `.md` + fixture（`NovelIdeModelEditDialog` 3 场景 / `ModelDiscoveryDialog` 4 场景 / `ModelLibraryDialog` 3 场景）并登记进 Lab；`ModelSettingsView` 的对话框场景撤掉，改为新增 `dialog-window` 场景——把视图摆进 `DialogWindow`，也就是产品承载它的方式。Lab 组件树 25 → 28 个组件。
- **派生助手内收**：编辑对话框需要的七个函数型 props（分组默认值、上下文窗口 / Max Tokens 占位、输入能力与推理能力展示名、输入能力选项表）改为对话框内部计算，调用方只传数据。
- smoke 新增「模型对话框嵌在设置窗口里」一段：外壳窗口 8990、内层窗口 8992、Escape 只关内层。

实测：nb-ui 15 文件 / 266 测试通过；neuro-book 48 文件 / 364 测试通过；smoke 全绿（`sectionCount 6`、`overflow 0`、嵌套层级与 Esc 断言通过）；四个窗口实测几何：模型区段在窗口内 1100×820（left 250 / top 90）、编辑窗口 980×760、发现与模型库各 800×850，`z-index` 均为 8990，控制台无错误。

两个坑：

- Lab 会把上次选中的组件与场景记在 localStorage 里，截图脚本第二次运行会被上一次留下的浮窗挡住组件树；每个视图用独立浏览器上下文、并在场景已被自动选中时跳过点击，才稳定。人肉验证同理：画布上已有窗口时先按 Escape 关掉。
- 本轮我自己踩过一次取证错误：直接读 `packages/nb-ui/...` 读到的是**主工作区**（master）的旧版本文件，差点据此判断「DialogWindow 没有缩放手柄」。读本分支代码必须走 `.worktree/w00003-.../` 前缀或用带 `cwd` 的命令。

## 切片 10：区段目录按角色分类（已完成）

开发者 2026-09-10 反馈：两级目录不够用，`ModelSettingsView` 的子组件应该放到一起——「这些子组件几乎没有被复用的可能，拆分组件就是为了好组织」。反馈同时暴露了一个真实的不一致：Lab 树的分类取决于「这个区段有没有自己的目录」，所以九个区段视图全挤在 `sections` 一组，而模型的却在 `model` 一组。

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
- **LabShell**：按 `groupPath` 建多级树（目录在前、组件在后，各按名字排）；搜索直接在入口列表上过滤，没有命中的分支根本不会出现，不需要事后剪枝；折叠状态的 id 是路径前缀（`group:novel-ide/settings/sections/model/components`）。

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
          ModelSettingsView
      cost / desktop / editor / embedding / observability / security / web …
```

两个连带发现（都已修）：

- 排序改成按完整路径后，Lab 的**默认预览组件**从 Agent Profile 系变成了 `CollapsibleSidePanel`（`component-lab` 目录排最前），而这个组件自己就渲染一个导航面板——于是 `smoke` 里「点导航面板第二格进入检查模式」的选择器在 strict 模式下命中两个元素。修法不是改回排序，而是把 smoke 的组件树选择器全部限定到左栏（`.lab-columns > .nb-lab-panel--nav`，4 个文件 9 处）：画布里预览的东西本来就可能是同类零件，靠「全局只有一个」是不成立的假设。
- `groupPath` 最初把 glob 根（`components`、`.`）也当成分类 → 树根多出一层噪音，按 glob 根段数裁掉。

门禁：`vue-tsc`、`scripts:typecheck` 通过；测试 48 文件 / 364 项通过；Lab smoke 全绿（含嵌套窗口层级断言）。

## 剩余工作（尚未开始）

本 Task 的切片已全部完成：外壳 + 七个区段（Agent Profile 模型、可观测、费用显示、向量嵌入、Web 工具、编辑器、桌面应用、密码保护、模型设置）都已是 Lab 可预览、可调试的受控视图。

仍然不在本 Task 内、需要独立任务的两块：

1. **产品宿主接线**（路线第 5–7 步）：把 `NovelIdeSettingsDialog` 的七个旧面板换成 `views/` 下的受控视图，并按「返工风险清单」先清掉双份序列化、`SettingsSavePanelExpose` 协议、fixture 自造的作用域矩阵与尺寸来源。
2. **`frontend`（主题）区段**：含主题卡片与主题编辑器，属主题 authority，需主题侧独立任务。

产品宿主接线仍属路线第 5–7 步，不在本 Task 内。

## 返工风险清单（接线前必须处理）

这几项属于「现在不管、以后返工很贵」的类型，按严重度排：

1. **双份序列化逻辑**：`NovelIdeEmbeddingSettingsPanel` / `NovelIdeWebSettingsPanel` / `NovelIdeCostSettingsPanel` / `NovelIdeObservabilitySettingsPanel` 各自还留着一套 payload 构造与密钥语义，`sections/*` 下的 draft 模块是另一套。产品接线时必须让旧面板改调新模块（或直接删除旧面板），不能让两套长期并存——配置写回规则一旦漂移，两边都会写错同一个配置段。
2. **`SettingsSavePanelExpose` 协议会整体消失**：旧宿主靠 `defineExpose({dirty, loading, saving, saveSettings, restoreSettings})` 驱动顶部保存 / 恢复栏，新视图是就地保存。接线时这套 expose 合同、保存栏、`settingsPanelKey` 重置逻辑要一次性删干净，不能留一半。
3. **作用域→区段矩阵目前是 fixture 自造的**：产品真值在 `NovelIdeSettingsDialog` 的 `globalConfigSections` / `projectConfigSections` / `browserSections` / `bootConfigSections` 里。外壳吃的是 props，接线时必须从产品矩阵喂进去（或先把矩阵抽成共享模块），否则 Lab 里的区段集合会和产品不一致，而这种不一致看起来完全正常。
4. **尺寸只有一个来源**：`DialogWindow` 的 `size` 字面量是缺省，显式 `width` / `height` 覆盖对应维度。场景里不要同时写死预设与同样的数字（设置外壳 fixture 已改成拖动后才接管受控值），否则预设一改就会静默停在旧尺寸。

2026-09-10 独立审查（`ModelSectionReview`）新增三条，按严重度排：

5. **产品宿主与新对话框的层级冲突（阻断，接线前必须先决定）**：设置宿主 `NovelIdeSettingsDialog` 仍是旧 app `Dialog`（`fixed inset-0 z-[9000]` + 不透明遮罩，teleport 进 `.novel-ide-theme`），而模型区段的编辑 / 发现 / 模型库 / 校验列表已改成 `DialogWindow`（8990，默认 teleport 到 `body`）。两者在同一根层叠上下文里按数值比较，于是**产品路径下这些窗口连同遮罩一起被设置面板盖住**，看不见也点不到；改造前它们同为 app `Dialog`（同 9000、DOM 更晚 → 压在外层之上），所以这是就地换组件引入的行为回归。Lab 看不到，是因为外壳 fixture 自己也换成了 `DialogWindow`（8990 vs 8992）。二选一：接线时把宿主一并换成 `DialogWindow`，或给这三个对话框透传 `teleport-target` 到宿主窗口子树内部（不要用默认的 `body` 8990）。
6. **同级浮动窗口按模板顺序叠放**：`DialogWindow` 的层级目前只按嵌套深度算，没有父子关系的两个窗口拿同一个 z，靠 DOM 顺序决定谁在上面。把这几个窗口节点重排（或在同一层再加一个），就会出现「点了没反应」。
7. **非模态窗口的目标会跟着走**：发现 / 模型库窗口的内容取自当前活动的 Provider，而 Provider 导轨就在同一个视图里、不再被遮罩挡住。窗口开着时切换 Provider 再点写回，模型会落进另一个 Provider；`confirmMode` 的编辑窗口也会被身后的「编辑设置」悄悄换掉目标。接线时按「打开窗口时冻结目标 Provider」实现。
