# t38 实施计划：状态栏去掉模式标记、项可换边、拖动排序做成共用的实时布局

## Context

t37 交付后开发者提了三点（原话见 [README](README.md#目标与范围)），评审板第 1 轮定了决定 1 到 5（[README 的“决定”](README.md#决定)）：

1. 状态栏不再显示“计划模式”“全部放行”两个标记（决定 1）。
2. 拖动排序用“行跟手”的实时布局，能跨组，不画落点线；拿起的行底不透明（决定 2）。
3. 项可以换边；窄时先收右边（从前往后），再收左边的数据项（从后往前），都进右边的“…”，提醒不收（决定 3）。
4. 拖动排序做成 composable 加薄组件，放 nb-layout 的 Vue 层，手势复用拖动会话（决定 4）。
5. 直接修：单选组的圆点对齐文字第一行；设置页每行的控件对齐标题行；删落点线（决定 5）。

依据：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15、45、46；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”；[`agent/modes.md`](../../../../../docs/specs/agent/modes.md) 输出 13；[`ui/layout-drag.md`](../../../../../docs/specs/ui/layout-drag.md)（手势会话）；[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 的“标签条上”（手感与判定的参照）。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 拖动手势 | nb-layout 的 `createDragSession` 与 `drag-gesture` | 门槛、指针捕获、Esc 与失焦取消、结构变了取消、键盘拿起都现成，手感与工作台一致；2026-10-09 已定自写、不引入 dnd-kit。否决原生拖放（只能画浏览器拖影，做不了实时布局，不支持触摸与键盘）、SortableJS 与 vue-draggable-plus（直接搬 DOM，与 Vue 渲染抢节点，没有键盘） |
| 邻居让位动画 | Vue `TransitionGroup` 的 move 类 | 与 `TabStrip` 同一种做法；被拖的那一行不参与 move 过渡，自己写 `translate` 跟手 |

## 关键设计

### `packages/nb-layout/src/sortable.ts`（核心，新增）

纯函数，不碰 DOM，bun test 直接测。

```ts
export type SortableAxis = "vertical" | "horizontal";
export interface SortableSpan { readonly start: number; readonly end: number }
/** 拿起时量一份，呈现顺序：分区头与成员交错。整场不再读 DOM（预览里行在滑，读 DOM 不准）。 */
export interface SortableSnapshot {
    readonly sections: ReadonlyArray<{readonly id: string; readonly head: SortableSpan | null; readonly members: ReadonlyArray<{readonly key: string; readonly span: SortableSpan}>}>;
    readonly gap: number;
}
export interface SortableSlot { readonly section: string; readonly index: number }
/** 被拖的东西此刻占 `held`，现在在 `current`：交回该在的位置。 */
export function sortableSlotIn(snapshot: SortableSnapshot, source: string, current: SortableSlot, held: SortableSpan): SortableSlot;
/** 键盘一步：前后一个位置，跨过分区头算一步。 */
export function sortableStep(snapshot: SortableSnapshot, source: string, current: SortableSlot, delta: -1 | 1): SortableSlot;
```

判定同标签条（`workbench-layout.md` 输出 38“标签条上”）：把除来源之外的成员与第二个起的分区头排成一串“邻居”，按“摘掉来源、补上空位”的布局算各邻居的中线；往后要被拖的后沿过“下一个邻居的中线加来源的长度”，往前要前沿过“上一个邻居的中线”，自带回滞；过了分区头就进了那一区。原型（评审板 `r1/sortable-proto.js`）验证过这套规则，换成拿起时的快照。

### `packages/nb-layout/src/vue/useSortable.ts`（新增）

```ts
export interface SortableSection { readonly id: string; readonly keys: readonly string[] }
export interface SortableMove { readonly key: string; readonly from: SortableSlot; readonly to: SortableSlot }
export function useSortable(options: {
    root: Readonly<Ref<HTMLElement | null>>;
    sections: () => readonly SortableSection[];
    axis?: SortableAxis;                  // 缺省 vertical
    disabled?: () => boolean;
    label: (key: string) => string;       // 读屏播报用
    onMove: (move: SortableMove) => void; // 一场至多一次，放下且位置变了才调
}): {
    readonly preview: ComputedRef<readonly SortableSection[]>; // 拖动中是放下后的样子，平时等于 sections()
    readonly held: Readonly<Ref<string | null>>;
    readonly announcement: Readonly<Ref<string>>;
};
```

- DOM 标记：成员 `data-sortable-key`，把手 `data-sortable-handle`（整行都能起拖，按钮、勾选框上按下不起拖），分区头 `data-sortable-head`。
- 拿起（`activate`）时量快照；`resolve` 用 `sortableSlotIn` 算位置并改 `preview`；被拖那一行的 `translate` 每帧直接写到元素上，不经响应式（`design-language.md` 的跟手规则）；位置夹在第一个分区头到最后一个成员之间。
- `commitsUnderPointer` 为真：松手提交指针下的位置；回到原位不提交。放下后被拖那一行从 `translate` 滑回 0（`--motion-move`）。Esc、失焦：`preview` 回原样，零写入。
- `structure()` 是 `sections()` 的序列化：拖动中设置被别处改了（右键菜单勾选不改结构，次序或分区变了才算），整场取消。
- 键盘：把手是可聚焦的按钮，空格拿起，上下键用 `sortableStep` 一步一位（跨分区），回车放下，Esc 取消，焦点回到把手。读屏经常驻的 `role="status"` 播报“已拿起”“第几位”“已放到某区第几位”“已取消”，文案进 nb-layout 的 locales。

### `packages/nb-layout/src/vue/SortableList.vue`（新增，导出，带同名 `.md`）

- 属性 `sections: {id; title; keys}[]`、`label(key)`、`disabled?`；事件 `move(SortableMove)`；插槽 `#item="{key, held}"` 画一行的内容（勾选、文字、按钮），`#head` 可选。
- 渲染一个平铺的 `TransitionGroup`：分区头与行交错，跨区也是同一组里换序，元素身份不变（拖着的行不重建）。空分区放一行“拖到这里”的占位，作落点。
- 组件画把手（六点图标，在与首行同高的盒子里居中）；拿起的行 `is-held`：底用 `--bg-panel`、`--elevation-raised` 的投影，盖在邻居上；不参与 move 过渡。悬停底色在拖动中关掉（原型里拿起的行底变透明就是悬停样式盖过了它）。

### `packages/nb-agent-ui/src/status-line.ts`

- `StatusLineSetting` 加 `side?: Readonly<Record<string, StatusLineSide>>`，只记与目录不同的一边。`resolveStatusLine` 按 `side[id] ?? item.side` 分边；插件声明的一边成了缺省的一边。
- `moveStatusItem(catalog, setting, id, to: {side, index})`：可换边；`shiftStatusItem(catalog, setting, id, delta)`：在“左边接右边”这一串里挪一位（右边第一项上移到左边最后），从 `status-line-writes.ts` 挪进来。`normalized` 一并去掉与目录相同的 `side`，目录里没有的 id 原样留着。
- `collapsedCount` 换成 `collapsedItems({left, right, available, gap, moreWidth})`：先右边从前往后，再左边从后往前，交回收起的 id。

### `packages/nb-agent-ui/src/vue/composer/`

- `AgentStatusBar.vue`：删掉模式标记与全部放行警告（`modeFlag`、`yolo`、对应文案）。左右两边的数据项改用新的内部组件 `AgentStatusItem.vue` 画（上下文、用量、费用、模型、宿主项都能在任一边），收起的槽位两边都量；提醒（运行阶段、等你批准或回答、等重发、费用告警、断线）包在一个量宽的容器里，`available = 栏宽 - 内边距 - 提醒宽 - 间距`，取代 `LEFT_MIN`。收起的项都进右边的“…”，悬停按呈现顺序列出。提醒宽随用时变，时间用等宽数字，免得每秒来回收放。
- `AgentStatusBar.md` 同步。

### `packages/nb-ui/src/components/form/`（决定 5）

`RadioGroup.vue` 与 `Checkbox.vue`：控件放进高 `1lh` 的盒子里居中，字号与行高写在 `label` 上让盒子与首行同一行高，去掉 `mt-0.5`。同名 `.md` 的“布局”写这条。

### `packages/neuro-book/src/plugins/agent/`

- `shared/settings.ts`：`StatusLineSchema` 加 `side`（值只收 `left`、`right`，至多 64 个键），`additionalProperties: false` 不变。
- `web/status-line-writes.ts`：`move(id, to: {side, index})`；`shift` 用 `shiftStatusItem`。
- `web/components/StatusLinePage.vue`：两组改用 `SortableList`；上移下移跨组（只有整串第一项没有上移、最后一项没有下移）；行内控件对齐标题行；删落点线与原生拖放。`.md` 同步。
- `web/plugin.ts`：接新的 `move` 形状。

### Lab 与 e2e

- nb-layout 的 Lab 场景：`SortableList` 两组、空分区、停用、英文；e2e 新文件 `lab-sortable-list.e2e.ts`：指针同组与跨组、Esc 回原样零事件、键盘拿起跨组放下、拿起的行底不透明（取计算后的背景色）。
- `StatusLinePage` 场景加“换过边”；`lab-agent-ui.e2e.ts` 的“状态栏设置页”改成拖到另一组、上移跨组。
- nb-agent-ui 视图场景 `modes-plan-yolo`、`host-cost` 改标签（状态栏不再有标记）；`agent-conversation.e2e.ts` 第 689、703 行的 `[data-status-mode]` 断言改成“状态栏没有模式标记，工具栏的模式控件在”。

## Spec 与文档改动

- `agent/conversation.md`：输出 15 删掉“全部放行”的警告；输出 45 设置形状加 `side`、项可换边、窄时规则；输出 46 改成可跨组、拖动是实时布局（链接新 Spec）、上移下移跨组。改动处标 planned，实现后去掉。
- `ui/agent-conversation-view.md`“状态栏”：删“非默认模式的标记”，可选项与次序、`StatusLineSetting` 加 `side`，窄时规则。
- `agent/modes.md` 输出 13：状态栏不另标模式，模式只看工具栏的控件（输出 11）。
- 新 Spec `ui/sortable-list.md`（planned，capability `ui.sortable-list`）：判定、跨区、键盘、取消、一场至多一次提交、播报；注册表加一行。
- `packages/nb-ui/docs/ui-development-spec.md` 的自检清单加一条：控件与多行文字并排时对齐第一行（`1lh` 盒子），不靠 `mt-*` 估。

## 切片

1. **nb-ui 对齐**（决定 5 的单选与复选）：`RadioGroup`、`Checkbox` 与 `.md`。验证：nb-ui 的 `typecheck`、`test`；Lab 截图对比单选组与复选框的场景。
2. **状态栏**：`status-line.ts`（换边、挪位、收起规则）、`AgentStatusItem` 拆分、删模式标记、Spec 改动。验证：nb-agent-ui `typecheck`、`test`（`status-line.test.ts`、`AgentStatusBar.dom.test.ts`）。
3. **nb-layout 排序**：`sortable.ts`、`useSortable.ts`、`SortableList.vue` 与 `.md`、locales、Lab 场景、`lab-sortable-list.e2e.ts`、新 Spec。验证：nb-layout `typecheck`、`test`；e2e 新文件。
4. **设置页接入**：schema、写入、`StatusLinePage`、plugin 接线、Lab 场景与 e2e。验证：neuro-book 受影响测试（`status-line.dom.test.ts`、settings 的 schema 测试），e2e `lab-agent-ui.e2e.ts`、`agent-conversation.e2e.ts`。
5. **收口**：实现审查（前端，Sonnet）、处理、Spec 去 planned 与证据、合入。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| conversation.md 输出 15（状态栏无模式标记） | `AgentStatusBar.dom.test.ts`；`agent-conversation.e2e.ts` 模式那条 |
| 输出 45（`side` 解算、换边、写回去掉缺省） | `status-line.test.ts`；`status-line.dom.test.ts` |
| 输出 45 窄时规则（先右后左、提醒不收） | `status-line.test.ts`（`collapsedItems`）；`AgentStatusBar.dom.test.ts`（量宽替身，同现有写法） |
| 输出 46（跨组拖动、上移跨组、一次写入） | `lab-agent-ui.e2e.ts`“状态栏设置页”；`status-line.dom.test.ts` |
| `ui.sortable-list` 判定与回滞、跨区、键盘一步 | `sortable.test.ts` |
| `ui.sortable-list` 指针、Esc 零事件、键盘、拿起的行不透明 | `lab-sortable-list.e2e.ts` |
| modes.md 输出 13 | 同输出 15 |

## 验证

- 各包 `typecheck` 与 `test`；e2e 只跑上面列的三个文件。
- 真实浏览器：Lab 里拖 `SortableList` 与状态栏设置页，截图看拿起的行、跨组、窄宽 390；状态栏场景把用量换到左边后拉窄看收起次序。
- 未验证的边界：触摸拖动（会话支持，但这次不在真机上试）。

## 不做与风险

- 不做网格形状；横排只按轴对称实现，这次没有使用方。
- 表单（nb-form）的对象列表暂不接入，留给需要时。
- 风险：提醒宽随运行阶段的文字变，收起的项可能在文字变长变短时跟着收放；时间用等宽数字，阶段名换了才会动。
- 风险：键盘拖动的位置按拿起时的快照算，拖动中窗口改了尺寸会不准；会话的“结构变了取消”只看次序，尺寸变化整场取消照工作台的做法（量到容器尺寸变了就取消）。
