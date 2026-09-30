---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.model-role-selection
owners:
  - ui
---

# 模型角色与通用模型选择器 (Model Role & Universal Model Picker)

## 目标与非目标

目标：
1. 提供通用的现代 GUI 模型选择组件（`ModelPicker`），在 AgentComposer、会话控制面板及后续任意模型配置入口中复用。
2. 支持模型角色快速选择：
   - **梯度轴（Gradient Axis）**：固定 4 档（`tiny` 极简、`fast` 快速、`main` 主力、`deep` 深度），全部默认常驻展示，展示角色专属图标、角色名、绑定模型与用途描述；
   - **专精轴（Specialist Axis）**：预设及用户自建的专精角色（`summarize`、`writer`、`narrative`、`plan`、`vision`、自建），在设置中支持用户自定义是否在快捷选择器中展示。
3. 支持所有模型库（All Models）的高密度浏览与搜索：
   - 按 Provider 进行清晰分类、折叠与排序；
   - 顶部提供即时模糊搜索（匹配 ID、名称、Provider、能力标签）；
   - 展示能力徽章（Reasoning 推理、Vision 视觉/图片）、上下文窗口大小（如 128k、200k、1M tokens）、计费标准（如 $3 / $15 per M 或 本地/免费）；
   - 底部提供当前高亮/选中模型的完整参数概览与键盘导航快捷键提示；
   - 明确标示“单次会话覆盖 · 角色设定不受影响”。

非目标：
1. 不涉及后端模型发现协议或 Provider 校验逻辑；
2. 不替代 Provider 设置页中的连接管理、密钥管理与模型启用/禁用维护。

## 术语与参与者

- **梯度轴 (Gradient Axis)**：系统固有的 4 档通用能力角色（`tiny` / `fast` / `main` / `deep`），所有模型角色的基石，始终对用户可见。
- **专精轴 (Specialist Axis)**：特定任务域角色（写作、剧情、计划、视觉、摘要等），由用户在设置中选择是否在快速选择器中暴露。
- **模型角色 (Model Role)**：按用途抽离的模型抽象，选定角色即使用该角色当前绑定的物理模型。
- **物理模型 (Configured Model)**：隶属于具体 Provider 的实际模型（如 `anthropic/claude-3-7-sonnet`）。
- **会话覆盖 (Session Override)**：在单次会话中临时切换模型或角色，不改变全局角色默认配置。

## 输入与前置条件

- Props：
  - `modelValue`: 当前选中的值，支持角色格式（如 `role:main`）或物理模型 key（如 `anthropic/claude-3-7-sonnet`）；
  - `roles`: 模型角色配置草稿（含梯度轴与专精轴条目，以及 `showSpecialistInPicker` 开关）；
  - `models`: 可用的物理模型列表（`EnabledModelOptionDto[]` 或富属性 `ModelPickerModelOption[]`）；
  - `readonly` / `disabled`: 是否处于只读或忙碌禁用态。
- 前置条件：宿主提供可用的角色列表与模型选项；无模型时提供体面的空状态占位。

## 输出与可观察行为

1. **触发按钮与指示**：
   - 紧凑工具栏内按钮呈现当前选中的角色图标与名称（如 `主力 (Claude 3.7 Sonnet)`）或模型标识，右侧带有展开下拉指示箭头。
2. **浮层 / 弹窗面板结构**：
   - **头部**：包含提示文案“会话级覆盖 · 角色设定不受影响”，以及一个带有快捷键聚焦提示的搜索输入框；
   - **快速角色栏 (Quick Roles)**：
     - 梯度轴卡片：4 档按顺序横向或紧凑网格排布，高亮当前活跃档位；
     - 专精轴卡片：若用户在设置中勾选了展示，则紧随梯度轴展示已配置的专精角色；未勾选则完全隐藏，不占视觉空间；
   - **模型库分类列表 (All Models)**：
     - 按 Provider（如 Anthropic, OpenAI, DeepSeek, Google, 本地/Ollama 等）分为独立折叠分组；
     - 每行模型清晰展示名称、Model ID、能力标签（`Reasoning`、`Vision`）、上下文窗口（如 `200k`）、价格（`$3 / $15` 或 `免费`）；
     - 当前选中的模型在右侧显示对勾选中态。
   - **底部状态栏 (Footer)**：
     - 显示当前选中或鼠标高亮项的完整详情（Provider、上下文、输入模式、计费等）；
     - 快捷键提示（`↑/↓` 切换、`Enter` 选择、`Esc` 关闭）。
3. **设置界面联动**：
   - 在 `NovelIdeSettingsView` 的 `模型角色 (RolesSettingsView)` 中，专精轴标题旁提供“在快捷模型选择中展示专精轴”开关。
   - 切换此开关后，快速模型选择器即时响应专精轴的显示或隐藏。

## 状态与转换

本能力作为 UI 组件不引入持久服务端状态，其在前端生命周期中的本地交互状态包括：
- `searchQuery`：当前用户输入的搜索过滤关键词；
- `activeSection`：当前筛选标签（全部、角色、或特定 Provider）；
- `hoveredItem`：当前光标或键盘聚焦的高亮项，同步反映到底部状态栏；
- `isOpen`：浮层展开或关闭状态，支持 OutsideClick、Escape 与回车确认自动关闭。

## 副作用与数据

- 纯受控 UI 交互组件，通过 `update:modelValue` 与 `select` 事件向宿主交回用户决策；
- 无直接网络请求与磁盘 I/O。

## 失败与恢复

- 搜索无匹配时展示明确友好的“未找到匹配模型”空态提示；
- 角色若未绑定物理模型，在选择器中以黄色告警徽标提示“未配置”，点击时允许选择并由宿主给出体面的配置引导。

## 边界与兼容

- 模块所有权：前端 UI 模块（`owners: - ui`）。
- 接口边界：本能力作为纯受控交互控件，不直接读取或修改后端 Provider 配置与持久化数据库；所有选择通过 props 与 emits 交付给宿主容器（如会话控制器与设置视图）。
- 格式兼容：支持角色格式（如 `role:main`）与具名物理模型 key（如 `provider/model-id`）双向绑定，向下兼容无角色的传统单模型入参。

## 验收与 Smoke

1. **Given** 打开 AgentComposer 模型选择器，**Then** 默认常驻显示 4 档梯度角色（Tiny, Fast, Main, Deep）且显示其当前绑定的模型；
2. **Given** 在 RolesSettingsView 中开启“在快捷模型选择中展示专精轴”，**When** 再次打开选择器，**Then** 专精轴角色（如写作、叙事、视觉等）正常展示；关闭时专精轴隐去；
3. **Given** 用户在搜索框输入关键词（如 `claude` 或 `vision`），**Then** 模型列表即时过滤，高亮匹配项；
4. **Given** 键盘按 `Esc` 或点击浮层外部，**Then** 选择器平滑关闭，无视觉残留。

## 实现合同

- 规范落地入口：`packages/neuro-book/app/components/novel-ide/model-picker/`
- 设置联动入口：`packages/neuro-book/app/components/novel-ide/settings/sections/roles/RolesSettingsView.vue` 与 `roles-settings-draft.ts`
- 业务集成点：`packages/neuro-book/app/components/novel-ide/agent/panels/header/AgentSessionModelControls.vue` 与 `AgentComposer.vue`

## 证据

- 实现入口：[`ModelPickerPopover.vue`](../../../packages/neuro-book/app/components/novel-ide/model-picker/ModelPickerPopover.vue) 与 [`ModelPickerContent.vue`](../../../packages/neuro-book/app/components/novel-ide/model-picker/ModelPickerContent.vue)
- 合同测试：[`ModelPicker.test.ts`](../../../packages/neuro-book/app/components/novel-ide/model-picker/ModelPicker.test.ts)
- Smoke：不适用——model picker 的行为在会话头与设置页的真实集成里验收，仓库内没有覆盖它的可执行 smoke 入口。
- 目标提案：[`docs/proposals/model-roles-contract.md`](../../proposals/model-roles-contract.md)
- 设置联动：[`packages/neuro-book/app/components/novel-ide/settings/sections/roles/RolesSettingsView.vue`](../../../packages/neuro-book/app/components/novel-ide/settings/sections/roles/RolesSettingsView.vue)
- 会话集成：[`packages/neuro-book/app/components/novel-ide/agent/panels/header/AgentSessionModelControls.vue`](../../../packages/neuro-book/app/components/novel-ide/agent/panels/header/AgentSessionModelControls.vue)

