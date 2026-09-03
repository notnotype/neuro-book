---
schema: nbook.task/v2
taskId: t14-agent-profile-nav-lab-migration
role: tasker
---

# 协作试迁移 Agent Profile 导航

## 目标

由开发者与 Agent 一起把真实设置界面的 `AgentProfileNavList` 原地重写成新主题体系下可在 Component Lab 确定性验证的领域组件，并完整记录从旧主应用组件到 Lab-ready replacement 的步骤、失败、取舍和可复用经验。这个样本用于决定后续自主迁移如何拆批，不代表设置界面整体迁移，也不把产品主页恢复作为本 Task 的完成条件。

本 Task 分成两个完成层次：

- **本 Task 必须完成的 Lab-ready**：同名文档、确定性 fixture、领域状态、受控事件、键盘/焦点/ARIA、桌面和 `390 × 844` 均有证据。
- **后续 Task 才完成的 Product-ready**：C 产品主题 clean cutover 后验证真实设置页、恢复全局门禁，并清理剩余旧主题或旧基础组件入口。

## 当前基线

### 组件与消费者

- 实现：`packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.vue`，当前约 127 行。
- 唯一运行时消费者：同目录 `NovelIdeAgentProfileModelSettingsPanel.vue`。
- 当前公开输入：`items`、`activeKey`、`search`、`defaultsDirty`；当前公开输出：`update:activeKey`、`update:search`；没有 slot 或 expose。
- `activeKey === ""` 表示默认设置页。父组件负责在 Profile 消失时把未知 key 纠正回空串；导航组件不拥有该状态。
- 父组件按 `profileKey` 排序后构造 `items`。`overrideCount` 是模型、运行策略和 Profile 设置覆盖数之和；`dirty` 是当前草稿与保存快照的比较结果；`isDefault` 由当前生效默认 Profile 推导。
- `status` 的封闭集合来自 `ConfigAgentProfileLoadStatusDtoSchema`：`loaded`、`compiling`、`compile_failed`、`not_compiled`、`compile_stale`、`compiled_load_failed`、`source_error`。

### 已知迁移缺口

- 搜索依赖主应用旧 `components/common/form/FormInput.vue`，而不是 nb-ui 表单入口。
- 列表是普通按钮集合，但没有可命名的导航 landmark，当前项也没有 `aria-current`。
- 编译状态主要依赖 6px 色点和 `title`；dirty 也主要依赖色点，默认 Profile 主要依赖星形图标。状态对触屏、键盘和色觉差异用户不够明确。
- 当前项主要依赖颜色、阴影和左侧指示条；没有独立于颜色的持续可见选择标记。
- `rounded-2xl`、`duration-300`、`transition-all` 和旧产品变量不符合 nb-ui 语义 token 与动效合同。
- 现有聚焦测试只读取源码字符串，断言存在 `overflow-y-auto` 且不存在 `90vh`；它不能证明真实滚动、固定搜索入口、焦点或窄屏无溢出。
- LSP 在当前环境不可用，引用查询返回 `No language server found for this action`；本轮基线通过精确文本搜索确认唯一消费者。实现阶段若 LSP 恢复，仍须先重新执行 references。

## 已定边界

### 所有权与 replacement 形式

- `AgentProfileNavList` 保留在 NeuroBook `novel-ide/settings` 领域层。Profile load status、默认 Profile、覆盖计数和 dirty 都是 NeuroBook 领域语义，不下沉到 nb-ui。
- 原地重写现有 `AgentProfileNavList.vue`，不创建 `Next`、`V2`、alias 或并行旧入口。当前父组件因路径不变会直接消费 replacement；本 Task 不另外改主页编排，也不把主页可用性写成 Lab-ready 通过。
- 新增同目录 `AgentProfileNavList.types.ts` 持有 `AgentProfileNavItem` 与 load-status 类型；父组件只把现有 SFC type import 改为该文件的 type-only import，运行时接线与数据构造不变。fixture 与测试复用同一领域类型，不从 SFC 导出第二份合同。
- 同名文档固定放在 `AgentProfileNavList.vue` 同目录，文件名为 `AgentProfileNavList.md`。这是 `component-index.ts` 能自动纳入 Lab 导航的唯一正确位置，不维护第二份组件清单。

### 公共组件取舍

- 搜索框复用 `@notnotype/nb-ui/components` 的 `FormInput`，使用 `type="search"`、`size="sm"` 和图标能力。搜索框提供与原生 input 关联的 label，不把 placeholder 当作唯一可访问名称。
- 状态元数据优先复用 nb-ui `Badge`。`Listbox` 只有固定选项结构和单 badge，无法无损表达 load status、默认、dirty、覆盖计数四类并行领域状态；不为单个领域组件扩展公共多插槽 API。
- 空态保持领域组件内的紧凑文本块。nb-ui `EmptyState` 面向内容区域，放入 240px 导航会引入不必要的标题、图标和留白。
- 列表继续使用原生纵向滚动容器和全局细滚动条样式，不引入 `ScrollArea`。固定搜索与默认入口、列表独立滚动由真实 Lab smoke 验证，不再让源码 class 字符串充当行为证据。

### 隐藏通道与主题

- 组件继续使用应用 i18n provider，文档如实声明 `标签: [state:inject]`，并说明只注入翻译能力。它不读 store、路由、浏览器存储、API 或产品数据，因此无需状态快照且可以在 Lab 确定性挂载。
- 不增加 `isLab`、路由判断、旧主题 fallback 或宿主条件分支。组件只消费 nb-ui 已登记的文字、表面、分隔、强调、状态、圆角、间距、焦点和动效语义 token。
- 不在本 Task 修改 `docs/specs/theme/system.md`、8 套旧产品主题、Global Config、首帧主题或浮层宿主；这些仍属于后续 C。

## 目标组件合同

### 数据与事件

```ts
type AgentProfileNavItem = {
    profileKey: string;
    name: string;
    status: ConfigAgentProfileSettingsDto["agentProfiles"][number]["loadStatus"];
    overrideCount: number;
    dirty: boolean;
    isDefault: boolean;
};

interface AgentProfileNavListProps {
    items: AgentProfileNavItem[];
    /** 空串表示默认设置页；受控，组件不自行修改。 */
    activeKey: string;
    /** 原始搜索输入；受控，组件只用 trim 后的小写值过滤。 */
    search: string;
    /** 默认设置页是否有未保存改动。 */
    defaultsDirty: boolean;
}

interface AgentProfileNavListEmits {
    /** 点击默认页或 Profile 时发出目标 key；重复点击当前项仍发出。 */
    (event: "update:activeKey", value: string): void;
    /** 每次搜索输入变化时发出原始字符串，不替调用方 trim。 */
    (event: "update:search", value: string): void;
}
```

- 搜索为大小写不敏感的 `includes`，同时匹配 `name` 与 `profileKey`；不增加模糊搜索、拼音、排序或高亮。
- 搜索只过滤 Profile 列表，不隐藏默认设置入口，不修改 `activeKey`。当前 Profile 被过滤掉时，详情状态保持不变；清空搜索后当前标记恢复。
- 非 `loaded` Profile 仍可选择。load status 是说明信息，不在导航层擅自改变详情页是否可用。
- `items` 为空时显示“没有可配置的 Profile”；`items` 非空但过滤结果为空时显示“没有匹配的 Profile”。
- 未知 `activeKey` 不触发自动 emit，也不伪造当前项；调用方继续负责纠正。
- 没有 slots、expose 或自定义禁用/只读/loading props。Vue 默认 attrs 落到单一根节点，供 `class`、`style`、`data-*` 和可访问属性扩展。

### 信息层级与状态表达

- 根节点是有可见标题关联的设置页导航 landmark。结构顺序固定为搜索、默认设置入口、Profile 区标题、独立滚动列表。
- 每行主信息是名称，`profileKey` 是次信息；长名称和长 key 截断但不撑破轨道，完整值仍保留在 DOM 可访问名称中，并提供指针可发现的完整文本。
- 当前项使用整行强调底、强调文字、持续可见选择图标和 `aria-current="page"`；不使用常驻左边框。默认页与 Profile 行采用同一选择语法。
- load status 使用持续可见的短文案与图标，不只用色点：`loaded` 为 success，`compiling` 为 accent，`not_compiled` / `compile_stale` 为 warning，`compile_failed` / `compiled_load_failed` / `source_error` 为 danger。所有七种状态都使用现有 i18n 文案。
- `isDefault` 显示“当前默认”语义，`dirty` 显示“有未保存的修改”语义，`overrideCount > 0` 显示本地化计数；三者均不能只靠颜色或 `title`。多个徽章允许换行，不能挤压名称轨道或改变按钮外宽。
- `defaultsDirty` 在默认设置行使用同一 warning 语法。`overrideCount === 0` 不显示计数徽章。
- `compiling` 可以有受 token 控制的动效，但必须同时有静态图标与文字；`prefers-reduced-motion` 下停止非必要动画。

### 键盘、焦点与 ARIA

| 场景 | 合同 |
| --- | --- |
| Tab | 顺序进入搜索框、默认设置按钮、每个可见 Profile 按钮；空态不是 Tab 停靠点。 |
| Enter / Space | 原生按钮触发一次 `update:activeKey`，分别携带空串或 `profileKey`。 |
| 方向键 / Home / End | 不自定义。该组件是页面导航，不冒充 `listbox`；搜索框承担快速定位。 |
| 搜索过滤 | 焦点保留在搜索 input；过滤不主动把焦点或选中状态移到首项。 |
| 当前项 | 恰好一个可见按钮可带 `aria-current="page"`；当前项被过滤或 key 未知时可见列表没有伪造 current。 |
| 状态 | 状态文案位于按钮可访问内容中；装饰图标 `aria-hidden`，不让颜色或 `title` 成为唯一信息源。 |
| 挂载/卸载 | 不自动抢焦点；组件没有浮层，也没有焦点归还责任。 |

## 确定性 fixture

新增 `packages/neuro-book/app/component-lab/fixtures/AgentProfileNavListFixture.vue`，在 `fixtures/index.ts` 只登记以下场景和 loader。fixture 只持有当前场景的内存态，监听场景或 Lab 数据还原后重置；每次 `update:*` 先更新受控 ref，再通过 `useLabEventSink()` 上报原事件名与 payload。

| 场景 id | 标签 | 初始输入与观察重点 |
| --- | --- | --- |
| `statuses` | 状态全集 | 七个固定 Profile 各覆盖一种 load status；其中一项选中、一项 dirty、一项当前默认、一项有覆盖计数，验证并行元数据层级。 |
| `defaults` | 默认设置 | `activeKey=""`、`defaultsDirty=true`，验证默认页 current 与未保存语义。 |
| `long-list` | 长列表与长文本 | 固定生成不少于 30 项，含超长中英文名称、长 key 和多徽章行；fixture 给组件明确高度，验证列表自身滚动。 |
| `empty` | 空列表 | `items=[]`、空搜索，验证领域空态且默认设置仍可操作。 |
| `no-match` | 搜索无匹配 | 非空 items 加固定无匹配搜索词，验证无匹配文案、搜索编辑和清空后恢复。 |

fixture 的 JSON 数据只使用可序列化字段，不读取真实 Profile、配置、store、API、浏览器存储、Provider/Model、Project 或 Session。列表生成规则固定，不使用当前时间、随机数或本机数据。

## 实施顺序与检查点

### 阶段 0：归因基线

1. 在开始源码改动前记录 revision、工作树和受影响命令的当前结果。
2. 对当前已有的全局失败建立 ledger：命令、cwd、exit code、错误原文、报错路径、首次引入批次和恢复条件。无法从历史确定首次批次时明确写“未验证”，不猜测。
3. 若实现时 LSP 可用，对 `AgentProfileNavList` 与 `AgentProfileNavItem` 重新执行 references；仍不可用则在 walkthrough 保留精确失败，并用文本搜索复核调用方。

### 阶段 1：文档和 fixture 先行

1. 新增 `AgentProfileNavList.md`，写入上述 props/emits/slots/attrs、状态、布局、键盘、ARIA、不支持项和 `state:inject` 理由。
2. 新增 `AgentProfileNavList.types.ts`、fixture 与五个场景登记，但暂不改变视觉实现。
3. 运行组件索引聚焦测试，确认文档自动进入 `settings` 分组、fixture 可发现、场景重置与事件日志确定。

**开发者检查点 A**：在 Lab 查看文档和场景数据，确认三项产品取舍：名称/key/元数据的信息层级；七种 load status 采用持续可见短文案；`390 × 844` 继续使用固定搜索加纵向列表，而不是横向条或抽屉。Agent 提供桌面与手机实际画面、替代方案和影响；得到结果前不进入最终视觉收口。

### 阶段 2：原地 replacement

1. 先补可失败的聚焦行为测试，再原地重写组件；迁移到 nb-ui `FormInput` / `Badge` 与语义 token。
2. 更新父组件唯一的 type-only import；不改变 `navItems` 构造、`v-model` 接线、设置保存或详情面板。
3. 删除 SFC 内旧类型导出、旧 `FormInput` 依赖、色点-only 状态、左侧 current 指示条、旧主题变量、字面动效时长和 `transition-all`。
4. 更新旧响应式源码字符串测试：移除 Profile 导航的 class 匹配，用组件行为测试与真实 Lab scroll/overflow smoke 接管该合同。

### 阶段 3：自动 Lab 验收

1. 桌面不低于 1440px：验证搜索与默认入口保持可见、长列表只在内部滚动、状态/默认/dirty/计数可区分、焦点环和事件 payload 正确。
2. `390 × 844`：验证核心操作仍完整，长名称/key/徽章不遮挡、不产生页面级横向溢出，搜索后仍可选择与恢复列表。
3. 键盘真实 smoke：Tab 顺序、Enter/Space 选择、current 语义、搜索过滤后的焦点保持。
4. 至少在 nbook 与另一套差异明显的 nb-ui 主题下验证 token 消费；不以单主题“看起来正常”替代主题合同。

**开发者检查点 B**：提供真实 Lab 首版供人工观感判断。人工验收需要单独授权，自动 smoke 不替代该判断；未获得结果时 Task 保持未闭合，不把“未反馈”记为通过。

### 阶段 4：记录与交接

1. 把最终决策、被否决方案、类型/主题/i18n/fixture 隐含依赖、失败与修复写入 Task walkthrough。
2. 对比阶段 0 与最终全局结果。每个新增失败注明由 t14 引入及恢复条件；既有失败保持原归因，不笼统写“预期失败”。
3. 提炼后续批次可复用步骤与本组件特例，交给 Leader；不在本 Task 预建剩余组件任务或 C。

## 预计改动文件

- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.md`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.vue`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.types.ts`
- `packages/neuro-book/app/components/novel-ide/settings/AgentProfileNavList.test.ts`
- `packages/neuro-book/app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`，仅 type-only import
- `packages/neuro-book/app/component-lab/fixtures/AgentProfileNavListFixture.vue`
- `packages/neuro-book/app/component-lab/fixtures/index.ts`
- `packages/neuro-book/scripts/smoke/component-lab.ts`
- `packages/neuro-book/app/utils/novel-ide-settings-responsive.contract.test.ts`，仅移除由真实行为证据接管的 Profile 源码字符串断言
- 本 Task 的 `walkthroughs/` 与必要 `evidences/`

默认不修改 nb-ui 公共组件实现或 exports。若现有 `FormInput` / `Badge` 的已声明合同不足，停止扩大公共 API，记录具体缺口并由 Leader 决定独立 Task。

## 验证矩阵

实现阶段按以下顺序串行执行，避免 nb-ui `nuxt prepare playground` 与 Playwright webServer 并发写 `playground/.nuxt`：

1. `bun --cwd packages/neuro-book run test -- app/components/novel-ide/settings/AgentProfileNavList.test.ts app/component-lab app/utils/novel-ide-settings-responsive.contract.test.ts`
2. `bun --cwd packages/nb-ui run test`
3. `bun --cwd packages/nb-ui run typecheck`
4. `bun --cwd packages/neuro-book run typecheck`
5. 启动当前 revision 的 Source Dev 服务，再运行 `bun --cwd packages/neuro-book run smoke:component-lab -- --url <实际地址> --browser-executable <实际 Chromium>`；服务和截图只使用系统临时根。
6. `bun run docs:check`
7. `bun run governance:check`
8. `git diff --check`

聚焦测试至少覆盖：大小写不敏感的 name/key 搜索、原始 search emit、默认/Profile 选择 payload、重复选择、七种状态文案、current/dirty/default/override 语义、空列表、无匹配和当前项被过滤。真实 smoke 至少覆盖：Tab/Enter/Space、焦点可见、内部滚动、桌面与 `390 × 844` 溢出、场景重置、事件日志和双主题。

Product build、主页真实流程和桌面应用 smoke 不作为本 Task 的通过门禁，但最终必须实际运行或明确记录未运行原因；失败按红分支 ledger 留证。红色 revision 不得 push、提 PR、合并、发布、部署或声明整个 Work 完成。

## Lab-ready 验收

- 同名文档与实现一致，`state:inject` 如实反映 i18n provider；props/emits/slots/attrs 可机械核对。
- fixture 覆盖五个确定性场景，重复打开、编辑与还原结果一致；不依赖 API、store、浏览器存储或真实 Profile。
- 组件只消费 nb-ui 语义 token，不读取旧 `theme.system` authority，不含 Lab/主页条件分支。
- 搜索与选择保持受控；选中、dirty、默认和七种编译状态不只依赖颜色或 `title`。
- 桌面与 `390 × 844` Lab 中无关键遮挡或页面级横向溢出，长名称、长 key 和多徽章不撑破布局，列表独立滚动。
- 聚焦测试、Component Lab smoke、nb-ui test/typecheck、NeuroBook typecheck 和文档治理检查均有实际结果；全局红色基线逐条记录，不冒充通过。
- 两个开发者检查点的结论写入 walkthrough；未授权的人工验收不写成已完成。

## 停止条件

出现以下任一情况时停止扩大实现，完成范围内证据后交给 Leader 或开发者决定：

- 必须改变 `AgentProfileNavItem` 数据语义、共享 DTO、Profile 状态机、保存/编译行为或详情页可用性。
- 必须给 nb-ui 公共组件新增 API/token，或出现两个以上同样合理的公开组件边界。
- 必须修改 C 产品主题合同、8 套旧主题、Global Config、首帧或浮层宿主。
- 必须新增真实 API/store/持久化依赖，或 fixture 需要读取真实 Project、Session、Provider/Model 或用户文件。
- 迁移需要继续扩展 `LabShell.vue`；这会命中 t09 的恢复条件，先由 Leader 恢复 t09。

## 完成后的 Leader 动作

读取本 Task walkthrough，判断哪些步骤能成为批量迁移合同、哪些只适用于 Agent Profile 导航，再按实际依赖创建第一批 Agent 自主迁移 Task。不得仅凭本 Task 成功就预建剩余全部组件任务；目标组件集合达到 Lab-ready 后才创建 C。
