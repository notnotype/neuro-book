---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.quick-open
owners:
  - ui
---

# Workbench 快速输入与命令面板

## 目标与非目标

**目标**：单一快速输入浮层（S4）承载两种模式——**命令模式**（默认模式；`>` 前缀可显式进入）与**行号模式**（`:` 前缀，跳转到当前文档指定行）。两种模式共享同一浮层、同一键盘操作与同一子序列匹配高亮。`Ctrl/Cmd+Shift+P` 打开命令模式；行号模式由 `nbook.quick-open.open-line` 或面板内直接输入 `:` 进入。另有**选择模式**：命令经工作台的选择服务在同一浮层里列出自己的候选，让用户选一项或提交输入的文字，例如“打开项目”（[`runtime.projects`](../runtime/projects.md) 输出第 10 条）。

**非目标**：

- 文件/实体快速打开（`Ctrl/Cmd+P`）与工作区实体检索：本批不交付。
- 符号导航 `@`：不解析、不注册、不加入语言服务依赖；以 `@` 开头的输入按普通命令查询文本处理（通常得到空态）。
- 多步向导（前进 / 后退、多输入链条、异步分页加载）。选择模式只有一步：一次请求一次结果，命令要再问就再发一次请求。
- 跨 Project 检索与远程检索。
- MRU 持久化：本批只在宿主实例内保留（见「副作用与数据」）。

## 术语与参与者

- **快速输入（QuickInput）**：nb-ui 的纯受控浮层原语；只呈现宿主给出的候选项与查询，不持有命令注册表、不做匹配与执行决策。
- **命令模式**：候选来自当前页面的命令表（[`workbench.commands`](commands.md)：产品页是本窗口 `nbook.commands` 的命令表，Lab 命令场景是场景自己的本地命令表）；`>` 前缀在查询中可省略，删除 `>` 不切换模式。
- **行号模式**：`:` 前缀输入；候选固定为一条「跳转到第 N 行」动作，执行 `nbook.editor.go-to-line`。
- **选择模式**：由命令发起，没有前缀；候选、标题、占位与空态文案都来自请求；可以允许提交输入的文字本身。结果交回发起它的命令，不经命令表执行。
- **MRU**：最近使用的命令 id 列表（仅会话内），参与排序加权。
- **参与者**：用户（输入与选择）；命令表（命令来源与可用性过滤）；编辑器宿主（提供行数与活动文档身份）；界面宿主（键位分发、面板挂载、执行与错误呈现）。

## 输入与前置条件

- **触发方式**：`Ctrl/Cmd+Shift+P`（经命令系统的键位分发触发 `nbook.quick-open.open-commands`）；`nbook.quick-open.open-line` 命令进入行号模式；浮层内继续输入、方向键移动、回车执行、Escape 关闭。
- **输入形状**：过滤文本；前缀字符（`>`、`:`）；选中项。
- **前置状态**：命令表可用。行号模式需要活动编辑器与其行导航能力；无活动编辑器时行号模式给出明确不可用原因，不显示假候选。产品页的编辑器随编辑器插件接入，在那之前产品页的行号模式显示“没有活动编辑器”。
- **权限**：无。

## 输出与可观察行为

- **打开**：浮层出现在视口顶部居中并自动聚焦输入框；命令模式预填 `>`；行号模式预填 `:`。已打开时重复触发为幂等：不再叠加第二层，只把焦点交回输入框（不重置当前输入）。
- **过滤**：随输入实时过滤候选，命中片段高亮；无匹配或注册表为空时显示空态说明，不显示占位候选。
- **排序**：匹配度为主、MRU 为次、同分按命令 id 稳定次序；空查询只按 MRU/id 排序。候选只包含人类可见（`expose.human !== false`）且当前 `when` 满足的 canonical 命令。
- **选择与执行**：方向键移动选中项（跳过禁用项、首尾回绕）；回车执行。命令执行发生在浮层**关闭完成后**（见「关闭与焦点交接」），执行失败由宿主在单一 `role="alert"` 区域呈现一次。
- **行号模式**：只接受 1 起正整数；当前文档行数在渲染与提交时读取。合法范围显示一条「跳转到第 N 行」，回车执行 `nbook.editor.go-to-line` 并真实移动编辑器光标；非法输入（0、小数、负数、列号、越界、空数字）不产生可提交候选，也不移动光标。活动编辑器在面板打开后被关闭/切换时，行号候选显示失效原因且不可提交，不自动改指向新文档。
- **选择模式**：工作台向本窗口的插件提供选择服务 `quickPickKey`（`pick(request) → 结果`）。请求给出标题、占位、候选（标签与可选的说明）、空态文案，以及是否允许提交输入的文字。浮层以请求的标题与占位打开（已打开则原位切换并交回焦点），候选按标签与说明子序列匹配、标签命中才高亮，同分保持请求里的次序；允许提交文字且输入非空时，候选末尾多一项提交这段文字。回车得到 `{kind: "item", id}` 或 `{kind: "text", text}`，Escape 或外点得到 `{kind: "cancelled"}`；结果在浮层关闭完成后才交回命令（与执行命令同一交接规则）。选择模式里不做前缀路由；切到命令或行号模式、或又发起一次选择，进行中的那次以 `cancelled` 结算；已经回车选中、只等关闭完成的那次不取消，立即按选中项交回（回车后马上再开面板时选中的一项不会丢）。当前页面没有命令面板时立即得到 `{kind: "unavailable", reason}`。选择模式不记 MRU。
- **显示语言**：选择请求的标题、占位、空态文案与候选说明可以是中英两份文本，浮层显示时按当前显示语言取（[`settings.configuration`](../settings/configuration.md) 的 `nbook.settings/locale`）；面板自身的文字同样。面板开着时切换语言，可见文字即时换成新语言，输入与选中项保留：候选（命令标题、选择的标签与说明）在各语言下的写法都参与匹配，按旧语言输入的文字仍然命中，标亮片段只在当前语言的文字命中时渲染。Lab 的命令场景用 Lab 自己的语言常量，不读产品配置。
- **前缀路由**：查询按首字符路由——`:` 进入行号模式；`>` 可省略，删除后仍是命令模式；其余文本（含 `@`）按命令查询处理。不增加第三类前缀或符号模式。
- **关闭与焦点交接**：「关闭完成」由浮层原语的真实卸载事件给出（不做固定延时猜测）。Escape、外点与执行提交都经该事件后才归还焦点或执行命令；执行提交时执行发生在焦点归还之后，命令自身获得焦点（如聚焦编辑器、跳转行）不被旧触发点夺回。Escape 与前后向 Tab 只影响最上层：浮层打开时下层对话框/菜单不得收到这些按键；关闭浮层后焦点回到打开前元素，元素已移除时不聚焦任何节点。

## 状态与转换

| 状态 | 触发 | 下一状态 |
|---|---|---|
| 关闭 | 打开命令 / 行号命令 | 打开 · 命令模式（或行号模式） |
| 打开 · 命令模式 | 输入 `:` 前缀 | 打开 · 行号模式（同一浮层，不重开） |
| 打开 · 行号模式 | 删除 `:` | 打开 · 命令模式 |
| 打开（任一模式） | 执行完成（关闭完成后执行） | 关闭 + 会话 MRU 更新 |
| 打开（任一模式） | Escape / 外点 | 关闭（焦点归还，MRU 不更新；选择模式以 `cancelled` 结算） |
| 关闭、打开 · 命令或行号模式 | 命令发起选择 | 打开 · 选择模式（同一浮层；进行中的选择先以 `cancelled` 结算） |
| 打开 · 选择模式 | 回车提交一项或文字 | 关闭；关闭完成后把结果交回发起选择的命令 |
| 打开 · 选择模式 | 打开命令 / 行号命令 | 打开 · 命令模式（或行号模式）；这次选择以 `cancelled` 结算 |

浮层打开期间上下文键 `quick-open-visible` 为真，关闭后为假；打开期间再次触发打开命令不叠加第二个浮层。

## 副作用与数据

- **会话 MRU**：命令模式记录最近执行的命令 id（去重前插、上限 30），只存在于提供面板的宿主实例里，不持久化；页面刷新或宿主释放（Lab 中即切换组件或场景）即清空；只读/失败/取消不记录。持久化按 Storage 规范留待后续批次，本批不写任何存储。
- 面板不缓存可用性决定：候选集在注册表版本或上下文变化时重算，不做每帧轮询。

## 失败与恢复

- **无候选 / 空注册表**：空态说明，不显示占位候选。
- **命令执行失败**：浮层已关闭，失败按命令系统的结构化结果由界面宿主呈现一次，不重复弹窗（Lab 命令场景在检视区唯一的 `role="alert"` 区域；产品页现在记入诊断）。
- **行号不可用**：无活动编辑器、不支持行导航、文档已切换或行号越界时给出具体原因；不可提交。
- **触发重入**：不叠加浮层；已打开时重复触发为幂等且不清空当前输入。

## 边界与兼容

- **与命令系统**：命令模式的候选、可用性过滤与执行完全来自 `workbench.commands` 的命令服务；本能力不复制命令元数据、不独立维护可用性判定。命令标题按显示语言取声明里的中英文本。行号模式通过 `nbook.editor.go-to-line` 执行，不直接调用编辑器句柄。
- **与 nb-ui**：浮层由 nb-ui 纯受控 `QuickInput` 原语承载（portal、modal 键盘与焦点合同、`closed` 交接事件）；匹配高亮与键盘导航复用共享设施，不引入第二套选择控件。
- **与组件 Lab 与产品页**：面板在 Component Lab 的命令场景完成四主题、双配色、390px 与叠层键盘验收；产品 `/` 页由工作台的命令宿主挂着面板（命令模式），行号模式随编辑器插件接入。
- **键位**：属于命令系统「默认键位」表，本能力不自行注册全局键盘监听。

## 验收与 Smoke

1. **双模式**：Given 空闲界面；When `Ctrl/Cmd+Shift+P`；Then 浮层出现、以 `>` 起始、列出可用命令；When 输入 `:15` 回车；Then 活动文档光标移动到第 15 行第 1 列且浮层已关闭。
2. **键盘全操作**：Given 浮层打开且候选 ≥ 3；When 方向键移动过回绕并回车；Then 对应候选执行、浮层关闭、焦点归还或按命令转移；中文输入法组合态回车不提交。
3. **前缀路由**：Given 命令模式；When 删除 `>`；Then 仍为命令模式、无文件/实体候选；When 输入 `@foo`；Then 按命令查询处理并显示空态，无符号导航。
4. **MRU**：Given 依次执行命令 A、B；When 再次打开空查询；Then B、A 排在未使用命令之前；失败与取消不改变次序；刷新后从空开始。
5. **可用性过滤**：Given 无活动编辑器的场景；When 打开面板；Then 四条编辑器命令不出现、`:15` 明确不可用；编辑器就绪后重开恢复。
6. **叠层键盘**：Given 下层对话框或菜单打开；When 浮层打开后按 Escape；Then 只有浮层关闭、下层保持；再按 Escape 才作用于下层。Tab/Shift+Tab 不离开浮层。
7. **选择模式**：Given 某命令发起选择；Then 浮层显示请求的标题与候选（带说明），输入同时匹配标签与说明；回车在焦点归还后把选中项交回命令；允许提交文字时末尾多一项、回车交回文字；Escape 与切回命令模式都交回 `cancelled`；没有命令面板的页面立即 `unavailable`。
8. **Smoke 入口**：Component Lab 命令面板场景中，以真实浏览器完成上述场景；四主题 × 双配色下检查面板计算样式（层级、材质、对比度）与 390px 无横向溢出。

## 实现合同

已实现（合同测试、组件测试与真实浏览器验收闭合）：

- 原语：`packages/nb-ui/src/components/feedback/QuickInput.vue`（受控 props/emits、S4 层级 `NB_Z_INDEX.commandPalette`、modal 键盘、`closed` 交接）。
- 面板：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchCommandPalette.vue`（同名 `.md`；查询与匹配、行号模式、等 `closed` 后执行、MRU 回写），只依赖面板宿主与命令服务接口，不知道命令表是哪一份。
- 面板宿主：`src/plugins/workbench/web/commands/palette-host.ts`（开合、查询、捕获的行号目标、会话 MRU、活动编辑器的接入口；选择模式的 `openPick`、`choosePick` 与关闭完成时结算的 `closed`）；文案中英表 `commands/palette-messages.ts`。
- 选择服务：合同与服务键 `quickPickKey` 在 `src/plugins/workbench/shared/contracts.ts`，由工作台浏览器入口经页面槽位（`commands/open-commands.ts` 的 `PaletteSlot.quickPick`）提供；候选匹配 `command-query.ts` 的 `searchPickItems`。
- 查询：`src/plugins/workbench/web/commands/command-query.ts`（前缀解析、子序列匹配与排序）。
- 界面宿主：产品 `/` 页上是 `src/plugins/workbench/web/commands/WorkbenchCommandHost.vue`；Component Lab 中由命令场景的局部宿主 `src/plugins/lab/web/fixtures/command-scene/lab-command-scene.ts` 挂载（与场景同寿，负责确认与错误呈现），Lab 外壳不持有面板。

## 证据

- 实现入口：[`WorkbenchCommandPalette.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchCommandPalette.vue)、[`QuickInput.vue`](../../../packages/nb-ui/src/components/feedback/QuickInput.vue)
- 合同测试：[`command-query.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/command-query.test.ts)；组件测试 [`WorkbenchCommandPalette.dom.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchCommandPalette.dom.test.ts)（场景 2–7，真实 QuickInput；场景 7 随 t54）；原语 [`QuickInput.test.ts`](../../../packages/nb-ui/src/components/feedback/QuickInput.test.ts)
- Smoke：[`e2e/lab-commands.e2e.ts`](../../../packages/neuro-book/e2e/lab-commands.e2e.ts)（场景 1、7，开发会话中的 Lab 命令场景，真实 Chrome）、[`e2e/commands.e2e.ts`](../../../packages/neuro-book/e2e/commands.e2e.ts)（产品 `/` 页）；运行记录见 [w00017 t49](../../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)。
- 批准依据：[`../../proposals/workbench-commands.md`](../../proposals/workbench-commands.md)（2026-09-14 起草，2026-09-18 需求讨论修订）。
