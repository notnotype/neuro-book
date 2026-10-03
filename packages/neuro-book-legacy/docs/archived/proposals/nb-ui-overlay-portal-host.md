# nb-ui 浮层的 portal 宿主默认值

- **状态**：rejected（2026-09-14 收尾：问题前提已由主应用主题切换消解，不立项；原文保留为历史记录，重开条件见「残留与重开条件」）
- **日期**：2026-09-14
- **范围**：`packages/nb-ui` 公共组件**自身浮层**的 portal 默认目标，以及 NeuroBook 主应用的主题宿主接入方式

## 问题

**结论（先行）：本提案不立项，前提已消解。** 下面这段问题陈述建立在「产品主题变量由 `.novel-ide-theme` 宿主发布，宿主之外的 `body` 拿不到」这一前提上。主应用主题系统切到 nb-ui 主题包后（提交 `269ba90a`，外壳消费同步见 `4bb4a16b`），主题轴 `data-nb-theme`、配色轴 `data-nb-appearance` 与配色变量都落在 `<html>`（`packages/neuro-book/app/utils/theme/theme-session.ts` 同时写 `<html>` 与 `body`），`packages/neuro-book/app/styles/theme-vars.css` 的角色变量桥接已删除、产品侧不再声明颜色——`body` 宿主的浮层与页面拿到同一份取值。原前提失效，**不需要 portal 宿主通道**。原文保留为历史记录（见「历史前提（消解前的原文）」），复验数据见「复验证据（2026-09-14）」，剩下的开口见「残留与重开条件」。

### 历史前提（消解前的原文）

nb-ui 的浮层组件默认把内容 teleport 到 `body`，落在产品主题宿主 `.novel-ide-theme` 之外。产品主题变量由宿主发布；`body` 上的浮层拿不到它们，只拿到 `:root` 上的 sepia 兜底。可观察症状（记录在 [`theme-vars.css`](../../packages/neuro-book/app/styles/theme-vars.css) 的同段注释与提交 `acdc627b`）：**非 sepia 主题下对话框/浮层仍是 sepia 浅底，而文字跟着主题走，读作「浅底 + 亮字」**。

产品侧已经用两个补丁把已知调用点救回来了（见「当前行为与证据」），但两者都是**调用点级**的：

- 每个调用点必须记得显式传宿主（今天 24 处模板调用点 + 若干组件默认值）；
- 一部分组件**根本没有宿主通道**——`FormSelect`、`Dropdown`、`Popover`、日期选择器一类只有 Reka portal，没有宿主 prop，调用点想传也无处可传。

- 漏传不报错，只在深色主题下表现为一处颜色不对。调用点还在增长：Workbench 阶段 1 之后，视图由 descriptor/factory 创建，浮层宿主如果继续靠「每个调用点记得」，这条记忆负担会扩散到每个 factory 与将来的浮动容器。

> 注：原文引用的 `theme-vars.css` 角色变量桥接已在 `269ba90a` 删除，该文件今天只剩 `::selection` 与 `--we-*` 别名层；`acdc627b` 记录的 sepia 症状不再可复现。

以下「目标与非目标」及其后的各节（「当前行为与证据」「方案、备选方案和取舍」「待决策点」「影响面」「数据、接口、安全、迁移、发布与回滚影响」「对 Spec 的预期改动」）都是上述已消解前提下的历史记录，不再作为当前行为依据或执行授权。

## 复验证据（2026-09-14）

复验条件就是原「问题」里最坏的那一类浮层：**浮层宿主是 `body`（不是 `.novel-ide-theme`），浮层元素的 `closest('.novel-ide-theme')` 为 `null`**。

| 浮层 | 主题 / 配色 | 背景 | 文字 | 描边 | 圆角 |
|---|---|---|---|---|---|
| Dialog | nbook / dark | `--overlay-surface` = `color(srgb .129412 .137255 .156863 / .14)` | `rgb(239,233,223)` | `--panel-outline` | 26px |
| FormSelect 下拉 | nbook / dark | 同 `--overlay-surface` 取值 | 见「残留 ①」 | — | 12px |
| Tooltip | nbook / dark | `rgb(45,41,37)`（`--bg-panel`） | — | — | 10px |
| Dialog | macos / light | `color(srgb 1 1 1 / .46)` | `rgb(17,24,39)` | — | 18px |
| Tooltip | macos / light | `rgb(255,255,255)` | — | — | — |

「—」= 本次未单独取值。判据：

1. **浮层拿到的是主题取值，不是兜底值**：`body` 宿主的 Dialog 背景落在 `--overlay-surface`、描边落在 `--panel-outline`、圆角落在 `--radius-panel`；Dialog 的文字色 nbook/dark `rgb(239,233,223)` = 主题 `--text-main` `#efe9df`、macos/light `rgb(17,24,39)` = 主题 `--text-main` `#111827`。
2. **机制判据**：同一时刻在 `<html>` 与 `body` 上取 `--overlay-surface`、`--bg-panel`、`--panel-outline`、`--text-main`、`--bg-main`、`--radius-panel`，逐项相同——取值来自文档根，浮层与页面共享同一份，与浮层 DOM 挂在哪无关。
3. 控制台无 error（既没有「找不到主题宿主」一类报错，也没有回落到 sepia 兜底）。

## 残留与重开条件

这次前提失效消掉的是「浮层拿不到主题变量」这一层。下面两条是复验里剩下的开口，本提案不处理。

### 残留 ①：未声明、靠继承的文字色落回 UA `CanvasText`

少数组件不声明自己的文字色、靠继承。宿主搬到 `<html>` 之后，浮层在 `body` 下仍能拿到主题的背景 / 描边 / 圆角，但文字色落到 UA 默认（`CanvasText`），不跟主题的 `--text-main`。实测 FormSelect 未选中项：

| 主题 / 配色 | 实测文字色 | 主题 `--text-main` |
|---|---|---|
| nbook / dark | `rgb(255,255,255)` | `#efe9df` |
| macos / light | `rgb(0,0,0)` | `#111827` |

背景 / 描边 / 圆角仍跟主题走——所以这是**组件没声明文字色**，不是 portal 宿主的问题；修法是组件侧显式消费 `--text-main`（或对应角色变量），与浮层挂在哪里无关。

### 残留 ②：无宿主通道的组件类（`FormSelect`、`Dropdown`、`Popover` 一类）

这类组件至今没有宿主 prop，也读不到宿主上下文（见「当前行为与证据」的表）。它们今天不成为问题**只因主题变量声明在 `<html>` 上**：`body` 是 `<html>` 的后代，`body` 宿主的浮层与页面处在同一变量作用域。一旦有消费方把主题变量声明在**子树**上，`body` 宿主的浮层就落到那个子树之外，症状回到「问题」节描述的样子。

### 重开条件

出现把主题变量声明在**子树**（而非文档根）上的消费方时——Lab 嵌套宿主、页面内局部主题区——本议题重新打开；起点是「待决策点（开发者拍板）」的 6 条。在此之前不需要 nb-ui 提供 portal 宿主通道。

## 目标与非目标

**目标**

1. nb-ui 浮层在**没有显式宿主**时，默认落到「宿主声明的主题上下文」而不是盲目的 `body`；公共库不硬编码任何产品类名。
2. 所有会在宿主外独立 portal 渲染的组件都提供同一条显式通道（prop 或上下文），不存在「想传也无处传」的组件。
3. 产品的主题跟随从「每个调用点记得传」退化为「根部声明一次」。

**非目标**

- 不改变浮层自身的视觉、动效、层级或键盘行为。
- 不重做主题变量体系（那是 `theme.system` 与 nb-ui 表面模型的事）。
- 不引入 `body` 之外的全局第二容器（新的全局 portal 根节点），也不要求产品把所有浮层搬进某个固定元素。
- 不规定产品侧迁移的批次与时间（那是 Task 的事）。

## 当前行为与证据

### nb-ui 侧：默认值是 `body`，一半组件没有通道

| 组件 | portal 方式 | 宿主通道 |
|---|---|---|
| `Dialog`、`DialogWindow`、`ContextMenu` | 自带 `<Teleport>` / `DialogPortal`，默认 `teleportTarget: "body"` | 有：`teleportTarget`（string \| boolean），`false` 就地渲染 |
| `TimePickerDefault` | 硬编码 `<Teleport to="body">` | 无 |
| `FormSelect`（`SelectPortal`）、`Dropdown`（`DropdownMenuPortal`）、`Popover`、`HoverCard`、`Tooltip`、`Menubar`、`AlertDialog`、`Drawer`、`Autocomplete`、`ColorPicker`、`DatePicker`、`DateRangePicker` | Reka 原语 portal，不传 `to` | 无 |
| `Combobox` | 不 portal（就地绝对定位） | 不适用 |

- Reka 原语的解析顺序是 `props.to ?? configContext.teleportTo?.value ?? 'body'`（`node_modules/reka-ui/src/Teleport/Teleport.vue`）。**底层已经预留了上下文机制**（`ConfigProvider` 的 `teleportTo`）；nb-ui 目前既不使用也不导出它（`packages/nb-ui/src` 中 `ConfigProvider` / `teleportTo` 零命中）。
- 现合同写在 nb-ui 文档里：[`ui-development-spec.md`](../../packages/nb-ui/docs/ui-development-spec.md) §13「默认 Portal 目标为 `body`。公共组件不得绑定产品私有主题宿主；产品消费者必须显式传入主题宿主目标」；[`DialogWindow.md`](../../packages/nb-ui/src/components/feedback/DialogWindow.md) 的 `env:portal` 条目与 [`design-language.md`](../../packages/nb-ui/docs/design-language.md) 弹出层清单同口径。

### 产品侧：两个已修补丁 + 一个开口

- **变量桥接（已修，`acdc627b`）**：nb-ui `tokens.css` 在 `:root` 把角色变量映射到产品 token，`var()` 在声明处代换完，产品在 `.novel-ide-theme` 上的主题取值到不了角色变量。产品现在在宿主上按同一套映射重声明 14 个角色变量（[`theme-vars.css`](../../packages/neuro-book/app/styles/theme-vars.css)）。实测：Tokyo Night 下下载确认框底色 `rgb(253,246,227)` → `rgb(26,27,38)`。
- **调用点显式传宿主（已修，`995e5e4f` 及此前批次）**：模板里直接写 `.novel-ide-theme` 的调用点 **24 处**（20 个 `Dialog` + 4 个 `DialogWindow`；t19 批次记录的 23 个 `Dialog` 实例是该纪律的第一批）。另有两类同义写法：8 个产品组件把宿主写成 prop 默认值；`Tooltip` / `FormColorField` / `LowCodeResourcePresetField` / `ReferencePlainTextEditor` / `TipTapMarkdownEditor` / `MarkdownSelectionMenu` / `ThemeEditorDialog` / `useDialog.ts` 按「最近的宿主 ?? `body`」运行时解析。Lab 的 8 个 fixture 传 `false`。
- **开口**：`acdc627b` 的提交记录写着「Two surfaces still do not follow — the settings dialog and FormSelect popovers — because they portal to body」。设置窗口那一半随后被 `995e5e4f` 修好；**FormSelect 一类下拉仍 portal 到 `body`**，因为组件没有宿主通道（上表）。这不是「忘了传」，是通道缺失。

## 方案、备选方案和取舍

### (a) 默认落到「最近的主题宿主」或由宿主提供上下文

- **a1 运行时找最近宿主**：浮层挂载时向上查找宿主标记。可行前提是库定义**自己的宿主标记**（例如产品在主题根上打 `data-nb-overlay-host`），否则库要认识 `.novel-ide-theme`，与「公共组件不得绑定产品私有主题宿主」的现合同冲突。
  - 代价：DOM 依赖与挂载时序（宿主必须先于浮层存在）；嵌套宿主语义要定义（Lab 的演示卡片、产品里的局部主题区域）；`ProfileTemplateVisualEditor.vue:2166` 记录过真实坑——Teleport 进 transform 容器内的嵌套宿主会让 `fixed` 定位基准失效。**不推荐单独使用**。
- **a2 宿主上下文（provide/inject）**：Reka 已经实现同一机制（`ConfigProvider.teleportTo`）。库把解析顺序改成「显式 prop > 上下文 > `body`」，组件不再把 `body` 写死。产品在应用根 provide 一次。
  - 代价：新增一个公共 API 承诺（上下文名称与形状）；`Dialog` / `DialogWindow` / `ContextMenu` / `TimePickerDefault` 四处写死的 `"body"` 要改成「未传则交给上下文」。

### (b) 保持默认 `body`、由产品统一包一层 context

与 a2 的机制重叠，区别只在叙述：库不改「默认是 body」的措辞，只把上下文通道打开（透出或包装 Reka `ConfigProvider`），产品统一包一层。

- 代价：**库仍需先开通道**——当前所有 Reka portal 都没给消费方任何传参入口，产品无从下手；产品侧必须维持这层包裹（Lab/playground 不包，行为本来就该是 `body`）。

### (c) 维持现状，只靠约定

- 代价最小：零代码改动。
- 但这不是「记得传」的问题，是**通道缺失**的问题（`FormSelect` 一类组件没有宿主 prop）。要维持现状，约定必须升级为「每个新增浮层组件都必须带宿主 prop」+「每个调用点都必须传」，靠人记且漏了不报错。
- 调用点增长的方向是 Workbench（descriptor/factory 创建的视图、浮动容器），成本按调用点数线性增长。

### 建议

**（b/a2 的机制）+（a 的目标）**：库补全「宿主可传入」的通道，默认解析顺序 = **显式 prop > 宿主上下文 > `body`**；库不绑定产品类名；产品在主题宿主根声明一次；调用点保留显式传参（优先级最高，不需要一次性迁移）。

理由：① 不推翻现有合同（公共组件不绑定产品宿主）；② 复用底层已有的 `ConfigProvider.teleportTo`，不发明第二套；③ 修掉「组件没有宿主通道」这个硬缺口——这是今天 `FormSelect` 一类下拉在深色主题下不跟随的直接原因；④ Lab / playground 无宿主上下文 → 仍走 `body`，行为不变。

### 待决策点（开发者拍板）

> **本节目前不适用（前提已消解）**：结论由主题上移给出，本提案不立项。这 6 条不是当前待办，只作为本议题重开时的起点（见「残留与重开条件」）。

1. 默认解析顺序是否就按「显式 prop > 上下文 > `body`」（保留显式传参最高优先级 = 现有 24 处调用点不需要动）。
2. 上下文用 nb-ui 自己的 provider（新公共 API）还是直接透出 Reka `ConfigProvider`（省一层，但把底层依赖写进公共契约）。
3. `teleportTarget: false`（就地渲染）是否作为公共能力保留（Lab 与 admin 页面在用）。
4. 是否接受「最近宿主 DOM 查找」作为上下文缺失时的兜底（建议：不接受，理由见 a1）。
5. 没有宿主通道的组件（`FormSelect` 等）只补上下文，还是同时补 prop（两者可并存：上下文兜底、显式 prop 覆盖）。
6. 迁移节奏：先补通道（本提案），调用点清理后置到独立 Task。

### 影响面

| 面 | 今天 | 选项落地后 |
|---|---|---|
| Lab / playground | 无主题宿主，浮层走 `body`；8 个 fixture 传 `false`（避免 Lab 里无宿主的 teleport 警告） | 行为不变（无宿主上下文即 `body`）；fixture 的 `false` 可以退场 |
| 产品 | 24 处调用点显式传宿主 + 组件默认值；`FormSelect` 一类无通道，深色下不跟随 | 根部 provide 一次，新调用点默认跟随；显式传参继续生效，可分批清理 |
| 主题跟随 | 靠「调用点记得传」+ 宿主级变量桥接两个补丁 | 结构性跟随：上下文决定浮层 DOM 位置，变量桥接继续负责 `var()` 代换层 |
| Workbench 阶段 1+ | 视图由 descriptor/factory 创建，宿主纪律靠每个 factory 自觉 | 新 factory 与浮动容器不必知道主题宿主 |

## 数据、接口、安全、迁移、发布与回滚影响

- **接口**：nb-ui 新增宿主上下文入口（公共 API）；现有 `teleportTarget` prop 语义不变（显式传参继续生效）。
- **迁移**：调用点不需要一次性迁移；Lab fixture 与 admin 页面的 `false` 保留；`theme-vars.css` 的角色变量桥接**继续需要**（它修的是 `var()` 代换层，与 portal 目标无关，两个补丁解决的是两件事）。
- **安全 / 数据**：无。不涉及凭据、持久化与领域数据。
- **回滚**：不 provide 上下文即回到 `body` 默认；删掉 provider 一次性回滚。
- **风险**：
  - 宿主上下文出现前挂载的浮层（SSR / 首帧）需要 fallback，不能永久 pending；
  - 顶层模态浮层从 `body` 移入宿主后，`fixed` 定位、z-index 与堆叠上下文相对关系变化，需要一次真实浏览器对照（桌面 + 窄屏 + 浅/深主题）；
  - 嵌套宿主（局部主题区域）的语义需要写明：以最近的 provide 为准。

## 对 Spec 的预期改动

- 目标 capability（暂定名，落地时以 Spec 注册表为准）：`ui.overlay-portal-host`——定义浮层宿主解析顺序、上下文缺失的回落、显式传参与上下文的优先级、目标不存在时的失败语义。
- 输入：可选显式宿主（string \| HTMLElement \| `false`）；宿主上下文（由产品根 provide）。
- 输出 / 可观察：浮层 DOM 落在解析出的宿主意内；无上下文且无显式传参时回落 `body`；`false` 时就地渲染。
- 失败：目标选择器不存在 → 回落 `body`，不抛错、不阻塞渲染。
- 验收：Lab（无宿主上下文）行为不变；产品深色主题下 `FormSelect` 下拉的 sepia 症状消失；现有显式传参调用点行为不变。
- 同时修订 nb-ui 文档：`ui-development-spec.md` §13 的「默认 Portal 目标为 `body`」与 `design-language.md` 弹出层清单的对应条目（保持章节编号不变，`src/components/token-consumption.test.ts` 与其它文档按编号引用过既有条款）。

## 决策记录

| 日期 | 决策 | 结论 |
|---|---|---|
| 2026-09-14 | 提案登记 | `draft`，待开发者拍板；本提案不改变任何现有行为，未立项 |
| 2026-09-14 | 提案收尾 | 问题前提由主应用主题切换（`269ba90a`、`4bb4a16b`）消解——主题与配色变量落在 `<html>`，`body` 宿主的浮层与页面同一份取值；`rejected` / 不立项，两条残留与重开条件记入正文 |
