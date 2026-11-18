# t38 实施计划：状态栏去掉模式标记、项可换边、拖动排序做成共用的实时布局

## Context

t37 交付后开发者提了三点（原话见 [README](README.md#目标与范围)），评审板第 1 轮定了决定 1 到 5，开发者 2026-11-18 确认了本计划的第一版（决定 6）；第二版按设计审查改过（[README 的“设计审查”](README.md#设计审查)），已定项没有变：

1. 状态栏不再显示“计划模式”“全部放行”两个标记（决定 1）。
2. 拖动排序用“行跟手”的实时布局，能跨组，不画落点线；拿起的行底不透明（决定 2）。
3. 项可以换边；窄时先收右边（从前往后），再收左边的数据项（从后往前），都进右边的“…”，提醒不收（决定 3）。
4. 拖动排序做成 composable 加薄组件，放 nb-layout 的 Vue 层，手势复用拖动会话（决定 4）。
5. 直接修：单选组与复选框对齐文字第一行；设置页每行的控件对齐标题行；删落点线（决定 5、6）。

依据：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15、45、46；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”；[`agent/modes.md`](../../../../../docs/specs/agent/modes.md) 输出 13；[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 输出 22；[`ui/layout-drag.md`](../../../../../docs/specs/ui/layout-drag.md)（手势会话）；[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 的“标签条上”（手感参照）。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 拖动手势 | nb-layout 的 `createDragSession` 与 `drag-gesture` | 门槛、指针捕获、Esc 与失焦取消、结构变了取消、键盘拿起、放下后吞掉 click 都现成，手感与工作台一致；2026-10-09 已定自写、不引入 dnd-kit。否决原生拖放（只能画浏览器拖影，做不了实时布局，不支持触摸与键盘）、SortableJS 与 vue-draggable-plus（直接搬 DOM，与 Vue 渲染抢节点，没有键盘） |
| 邻居让位动画 | Vue `TransitionGroup` 的 move 类 | 与 `TabStrip` 同一种做法；被拖的那一行压掉 move 的 `transform`，自己写 `translate` 跟手 |

## 关键设计

### `packages/nb-layout/src/sortable.ts`（核心，新增）

纯函数，不碰 DOM，bun test 直接测。输入是这一刻量到的布局（相对列表根，不含正在走的位移），不是拿起时的快照：预览就是真实布局，每次判定都量当前的，占位行、分区头、各种间距都是真实元素，不用另外建模。

```ts
export type SortableAxis = "vertical" | "horizontal";
export interface SortableSpan { readonly start: number; readonly end: number }
/** 这一刻的布局，呈现顺序：每个分区的头（第一个分区可以没有）与成员；来源也在里面（它此刻所在的位置）。 */
export interface SortableLayout {
    readonly sections: ReadonlyArray<{readonly id: string; readonly head: SortableSpan | null; readonly members: ReadonlyArray<{readonly key: string; readonly span: SortableSpan}>}>;
}
export interface SortableSlot { readonly section: string; readonly index: number }
/** 被拖的东西此刻占 `held`（指针推出来的位置，已夹在列表范围里）：交回该在的位置。 */
export function sortableSlotIn(layout: SortableLayout, source: string, held: SortableSpan): SortableSlot;
/** 键盘的停靠位置：按呈现顺序列出来源能去的每个位置（跨分区，空分区的第 0 位也在内）。 */
export function sortableSlots(layout: SortableLayout, source: string): SortableSlot[];
```

判定同标签条（`workbench-layout.md` 输出 38“标签条上”），也是评审板原型验证过的规则：除来源之外的成员与第二个起的分区头排成一串“邻居”；往后时被拖的后沿过了下一个邻居的中线，往前时前沿过了上一个邻居的中线，就换过去；一次可以连换几位，后面几步按“摘掉来源”的位置推算，下一帧按真实布局再判，自带回滞。过了分区头就进了那一区，第一个位置是 0。

### `packages/nb-layout/src/vue/useSortable.ts`（新增）

```ts
export interface SortableSection { readonly id: string; readonly keys: readonly string[] }
export interface SortableMove { readonly key: string; readonly from: SortableSlot; readonly to: SortableSlot }
export function useSortable(options: {
    root: Readonly<Ref<HTMLElement | null>>;
    sections: () => readonly SortableSection[];
    axis?: SortableAxis;                                  // 缺省 vertical
    disabled?: () => boolean;
    label: (key: string) => string;                       // 播报与把手的可访问名用
    sectionLabel: (section: string) => string;
    onMove: (move: SortableMove) => void | Promise<unknown>;
}): {
    /** 拖动中与放下后等写入的这段时间是放下后的样子，平时等于 sections()。 */
    readonly preview: ComputedRef<readonly SortableSection[]>;
    readonly held: Readonly<Ref<string | null>>;
    readonly announcement: Readonly<Ref<string>>;
};
```

- **会话的寿命**：`root` 挂上时 `createDragSession`，换掉或卸载时 `dispose`；一场进行中 `disabled()` 变真时 `abort`。
- **DOM 标记**：成员 `data-sortable-key`，把手 `data-sortable-handle`，分区头 `data-sortable-head`，空分区的占位 `data-sortable-placeholder`。指针的来源是整行，按在按钮、输入框、链接上不起拖；键盘的来源只认把手（勾选框上的空格留给勾选）。
- **`resolve` 不改任何东西**：量列表根下各元素的布局（`offsetTop`、`offsetHeight` 相对列表根，不受 `transform`、`translate` 影响；指针换算成相对列表根的坐标，页面滚动了也对），夹在第一个元素的上沿到最后一个元素（含占位行）的下沿之间，交给 `sortableSlotIn`；来源此刻所在的位置从 DOM 读（它就是上一次发布的预览）。键盘一场（`region` 不为 null）按停靠点的下标换成位置。
- **预览从会话的状态派生**：`preview` = 把来源从原位置挪到 `state.drop` 的结果；`state` 为 null 且没有等写入时等于 `sections()`。
- **跟手**：`activate` 的 `at.pressed` 记下抓住的点（按下的那一点到行上沿的距离），拿起时不跳。`state` 每次变化之后（`watch` 的 `flush: "post"`，Vue 已经按新预览排好 DOM）读被拖那一行的布局位置，再写它的 `translate`，读在写前面；不经响应式。键盘一场不写 `translate`，行就在它的位置上。
- **放下**：`commitsUnderPointer` 为真，松手提交指针下的位置；回到原位时 `actionKey` 为 null，不提交。提交调 `onMove`；它返回 Promise 时，预览停在放下的结果，直到 settle 再回到 `sections()`（宿主写成功时已经是新次序，失败就回原样），这段时间不能再拿起。被拖那一行从 `translate` 滑回 0（`--motion-move`）。Esc、失焦：预览回原样，零写入。
- **结构键**：`sections()` 的序列化；拖动中设置被别处改了次序或分区（右键菜单的勾选不改结构），整场取消。
- **键盘**：一个区域，停靠点是 `sortableSlots` 的每个位置（点按它们此刻在布局里的位置给，判定按下标）；`start` 是来源现在的位置（直接回车不动）；`refocus` 按 key 找把手。空格拿起，上下键一步一位（跨分区），Home、End 到两端，回车放下，Esc 取消，焦点回到把手；拖动中 Tab 回到第一个位置（会话的规则：只有一个区域时 Tab 回到它的开头），Spec 写明。
- **播报**：常驻的 `role="status"`，拿起、换到某区第几位、放下、取消各一句，文案进 nb-layout 的 locales，位置写区内的第几位。
- **减少动效**：时长令牌在系统减少动效时为 0，让位与回位直接到位，不另写分支。

### `packages/nb-layout/src/vue/SortableList.vue`（新增，导出，带同名 `.md`）

- 属性 `sections: {id; title; keys}[]`、`label(key)`、`disabled?`；`move` 是函数属性（`@move` 写法照常，返回 Promise 时放下后的次序留到它 settle）；插槽 `#item="{key, held, section}"` 画一行的内容。
- 渲染一个平铺的 `TransitionGroup`：分区头与行交错，跨区也是同一组里换序，元素身份不变，分区头跟着滑。move 类一直开着（取消、放下、上移下移都滑）；被拖的行 `transform: none !important`、`position: relative`、`z-index: 1`，底用 `--bg-panel` 加 `--elevation-raised` 的投影；拖动中关掉行的悬停底色（原型里拿起的行底变透明就是悬停样式盖过了它）。空分区放一行“拖到这里”的占位。
- 把手由组件画：内联 SVG（本包不用原子图标类），可聚焦的按钮，可访问名“移动 某项”，`aria-describedby` 指向所在分区的头；它放在高 `var(--sortable-first-line, 1lh)` 的盒子里竖直居中，行的字号与行高由插槽内容定时，宿主设这个变量对齐第一行。只有把手写 `touch-action: none`：触摸从把手起拖（按住 200ms），行的别处留给页面滚动。
- 读屏：分区头仍是标题，行不加列表角色；行与分区的关系经把手的描述读出，移动经播报读出。

### `packages/nb-agent-ui/src/status-line.ts`

- `StatusLineSetting` 加 `side?: Readonly<Record<string, StatusLineSide>>`，只记与目录不同的一边；`resolveStatusLine` 按 `side[id] ?? item.side` 分边。插件声明的一边成了缺省的一边，声明改了、用户没换过的项跟着走（Spec 写明）。
- `normalized` 的输入改成 `{order, visible, side}`，缺省与当前都用同一份 `side` 解算再比次序（否则换边到第 0 位时 `order` 会被当成缺省去掉）；去掉与目录相同的 `side`，目录里没有的 id 原样留着。`toggleStatusItem` 与移动都经它，三个字段互不丢。
- `moveStatusItem(catalog, setting, id, to: {side, index})`：可换边。`shiftStatusItem(catalog, setting, id, delta)`：在“左边接右边”这一串里挪一位，从 `status-line-writes.ts` 挪进来；右边第一项上移到左边最后（左边空也行），左边最后一项下移到右边第一；只有左边第一项不能上移、右边最后一项不能下移。
- `collapsedCount` 换成 `collapsedItems({left, right, reserved, available, gap, moreWidth})`：`left`、`right` 是两边可见项的宽度（按呈现顺序），`reserved` 是提醒的宽（没有提醒为 0，也不算它两边的间距）；按“右边从前往后、左边从后往前”的次序收，交回收起的 id。
- 导出：加 `shiftStatusItem`、`collapsedItems`，删 `collapsedCount`（`src/index.ts`）。

### `packages/nb-agent-ui/src/vue/composer/`

- `AgentStatusBar.vue`：已删模式标记（`modeFlag`、`yolo` 与文案、样式）。左右两边的数据项改用新的内部组件 `AgentStatusItem.vue` 画（上下文、用量、费用、模型、宿主项都能在任一边），两边的槽位都量宽、收起的槽位脱离文档流。提醒（运行阶段、等你批准或回答、等重发、费用告警、断线）包在一个不收缩的容器里量自然宽；放不下的部分由左边整块裁掉（最后才截断）。收起的项都进右边的“…”，悬停按呈现顺序列出；`textOf` 加上下文（百分比或绝对数）。上下文收起时圆环的“打开上下文详情”入口跟着收起，接受这个取舍：左边从后往前收，上下文缺省在左边第一位，最后才收。
- `AgentStatusBar.md` 同步；`types.ts` 里“全部放行选中时状态栏有警告”的注释改掉。

### `packages/nb-ui/src/components/form/`（已提交）

`RadioGroup.vue`、`Checkbox.vue`：按继承的行高（`1lh`）算上外边距，控件落在标签第一行的竖直中线上；复选方框仍与原生 input 同级，`peer-focus-visible` 的焦点环不受影响。

### `packages/neuro-book/src/plugins/agent/`

- `shared/settings.ts`：`StatusLineSchema` 加 `side`（值只收 `left`、`right`，与 `visible` 一样不设键数上限），`additionalProperties: false` 不变。
- `web/status-line-writes.ts`：`move(id, to: {side, index})`；`shift` 用 `shiftStatusItem`。
- `web/components/StatusLinePage.vue`：两组改用 `SortableList`；`move` 改成函数属性，返回写入的 Promise；上移下移跨组；删原生拖放与落点线；行内勾选与按钮对齐标题行。`.md` 同步。
- `web/status-line-page.ts`：`onMove` 返回 `writer.move(...).then(reportIfFailed)`，不再 `void`。

### Lab 与 e2e

- nb-layout 的 Lab 场景 `SortableList`：两组、空分区、写入慢（放下后等 600ms 才采纳）、写入失败（回原样）、停用、英文。e2e 新文件 `lab-sortable-list.e2e.ts`：指针同组与跨组、拖进最后一个空分区、Esc 回原样零事件、写入慢时不闪回、写入失败回原样、键盘拿起跨组放下与焦点回到把手、拿起的行背景不透明（计算后的背景色）。
- `StatusLineFixture.vue`：`move` 与 `shift` 都接上、改成异步（延迟几十毫秒），加“换过边”与“写入失败”场景；`lab-agent-ui.e2e.ts` 的“状态栏设置页”改成拖到另一组、上移跨组、预览跟着变。
- `status-line.dom.test.ts` 里原生拖放的用例整体删掉，跨组指针拖动只在 e2e 测；写入形状（换边、跨组的上移）留在 dom 测试。
- 状态栏的窄宽：Lab 的状态栏场景加一个“用量换到左边、在等批准”的设置，e2e 在窄宽下断言提醒文字完整、右边先收、再收左边。
- nb-agent-ui 视图场景的标签与 `agent-conversation.e2e.ts` 的模式断言已改（状态栏不再有标记）。

## Spec 与文档改动

- `agent/conversation.md`：输出 15 删掉“全部放行”的警告；输出 45 设置形状加 `side`、项可换边、边的缺省随插件声明、窄时规则；输出 46 改成可跨组、拖动是实时布局（链接新 Spec）、上移下移跨组、放下后的次序留到写完。改动处标 planned，实现后去掉。
- `ui/agent-conversation-view.md`“状态栏”：删“非默认模式的标记”；`statusLine` 的形状与解算段加 `side`；窄时规则与上下文收起的取舍。
- `agent/modes.md` 输出 13：状态栏不另标模式，模式只看工具栏的控件（输出 11）。
- `agent/contributions.md` 输出 22：声明的 `side` 是缺省的一边，用户可以换。
- 新 Spec `ui/sortable-list.md`（planned，capability `ui.sortable-list`）：判定、跨区、空分区、键盘（含 Tab）、取消、一场至多一次提交、放下后等写入、播报与读屏、触摸只从把手；注册表加一行。
- `packages/nb-ui/docs/ui-development-spec.md` 的自检清单加一条：控件与多行文字并排时对齐第一行（按 `1lh` 算），不靠 `mt-*` 估。

## 切片

1. **nb-ui 对齐**：已提交（18cc9b372）。
2. **状态栏**：`status-line.ts`（`side`、`normalized`、换边、挪位、收起规则）、`AgentStatusItem` 拆分、模式标记的余项、Spec 改动。验证：nb-agent-ui `typecheck`、`test`（`status-line.test.ts`、`AgentStatusBar.dom.test.ts`、`locales.test.ts`）。
3. **nb-layout 排序**：`sortable.ts`、`useSortable.ts`、`SortableList.vue` 与 `.md`、locales、Lab 场景、`lab-sortable-list.e2e.ts`、新 Spec。验证：nb-layout `typecheck`、`test`；e2e 新文件。
4. **设置页接入**：schema、写入、`StatusLinePage`、包装、夹具、Lab 场景与 e2e、状态栏窄宽的 e2e。验证：neuro-book 受影响测试（`status-line.dom.test.ts`、settings 的 schema 测试），e2e `lab-agent-ui.e2e.ts`、`agent-conversation.e2e.ts`。
5. **收口**：实现审查（前端，Sonnet）、处理、Spec 去 planned 与证据、合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| conversation.md 输出 15、modes.md 输出 13（状态栏无模式标记） | `AgentStatusBar.dom.test.ts`；`agent-conversation.e2e.ts` 的 Agent 模式那条 |
| 输出 45 的设置（`side` 解算、换边、勾选不丢 `side`、换边到第 0 位 `order` 留着、换回去设置回到空对象） | `status-line.test.ts` |
| 输出 45 的窄时规则（先右后左、提醒不算进收起、提醒为 0 不扣间距） | `status-line.test.ts`（`collapsedItems`）；`AgentStatusBar.dom.test.ts`（量宽替身）；Lab e2e 的窄宽（真实布局） |
| 输出 46（跨组拖动、上移跨组、一次写入、等写入不闪回、失败回原样） | `lab-agent-ui.e2e.ts`“状态栏设置页”；`status-line.dom.test.ts`（写入形状） |
| `ui.sortable-list` 的判定与回滞、跨区、空分区、停靠位置 | `sortable.test.ts`（行高不等、来源是唯一成员、拖进空分区、头与行混排） |
| `ui.sortable-list` 的指针、Esc、键盘、等写入、背景不透明、播报 | `lab-sortable-list.e2e.ts` |

## 验证

- 各包 `typecheck` 与 `test`；e2e 只跑 `lab-sortable-list`、`lab-agent-ui`、`agent-conversation` 三个文件，加上新增与改过场景的 `lab-scenes`（或用 `nbdev shot` 的测量代替）。
- 真实浏览器：Lab 里拖 `SortableList` 与状态栏设置页，截图看拿起的行、跨组、窄宽 390；状态栏场景把用量换到左边后拉窄看收起次序。
- 未验证的边界：触摸拖动（会话支持，这次不在真机上试）。

## 不做与风险

- 不做网格形状；横排只按轴对称实现，这次没有使用方。表单（nb-form）的对象列表暂不接入。
- 上下文收起后不能从状态栏打开上下文详情（见上文 `AgentStatusBar.vue`）。
- 已停用插件的 id 在 `order`、`visible`、`side` 里原样留着，`order` 有 64 项上限：几乎碰不到，记为已知限制。
- 提醒宽随运行阶段的文字变（用时的位数、阶段名），收起的项会跟着收放。
