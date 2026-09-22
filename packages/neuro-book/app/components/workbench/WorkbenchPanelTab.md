---
标签: []
别名: ["面板页签", "Panel Tab"]
---

# WorkbenchPanelTab

底部面板标签条上的**一个页签**：单根 `<button role="tab">`，可带图标、角标与关闭区。

它是**纯零件**：只画自己、只把「点了」与「要关我」交回宿主，自己不改激活项、不关任何东西、不读 store、不认识视图或命令。面板标签条因此可以是 `WorkbenchPanelSurface` 的 `#tabs` 插槽里任意一组页签，也可以被别的宿主复用。

## 布局

- 根：一个 `<button type="button">`，`role="tab"`、`aria-selected` 跟着 `active` 走，`disabled` 跟着 `disabled` 走；带 `data-tab-id="<id>"` 与 `data-tab-active="true|false"` 两个核对点。
- 内容从左到右：图标（12px 级）→ 文本 → 角标 → 关闭区。三者都由插槽可替换（见「数据」）。
- 固定高 32px（`--space-8`），单行不换行（`white-space: nowrap`）；**不自己伸缩、也不自己滚动**——横向溢出由父级标签条决定（`WorkbenchPanelSurface` 的标签条是 `overflow-x: auto`）。
- 角标只有非空（`!== undefined`、`!== null`、`!== ''`）才渲染；计数类字号用 `--text-2xs`，底色随变体走。
- `390×844` 下这一项只是变窄或由父级标签条横向滚动，自身结构不变。

## 交互

- 点击：根按钮发 `click(id, e)`。**它不改变自己的激活态**——激活项是宿主的受控值，判断「点了当前项」也在宿主。
- 关闭：`closable` 时右侧渲染关闭区，点它发 `close(id, e)`，并 `stop` 掉冒泡（不会同时触发 `click`）。
- 禁用：`disabled` 时 `click` 与 `close` 都不发，指针与键盘都不响应；视觉降为 40% 不透明度。
- 焦点：只有根按钮进入 Tab 序列（关闭区 `tabindex="-1"`）。`focus-visible` 时画 `--focus-ring`。
- **键盘语义归宿主**：`role="tab"` 只声明「我是一个标签」，方向键 / `Home` / `End` 的漫游、`aria-selected` 的跟随、以及点击当前项时是激活还是收起，都由标签条的实现决定（`WorkbenchPanelSurface` 今天只把项横向排开，视宿主将来接入漫游）。本组件不监听任何按键，也不替宿主抢焦点。

## 数据

```ts
type Props = {
    /** 标签唯一标识（透传在 data-tab-id 上，事件原样带回） */
    id: string;
    /** 标签文本（默认插槽可替换） */
    label: string;
    /** 图标 class，例如 i-lucide-terminal */
    icon?: string;
    /** 标签角标（数字或文本） */
    badge?: string | number;
    /** 是否激活（受控：组件不自己改） */
    active?: boolean;
    /** 是否显示关闭区 */
    closable?: boolean;
    /** 是否禁用 */
    disabled?: boolean;
};

type Emits = {
    /** 根按钮被点击（禁用时不发） */
    (event: "click", id: string, e: MouseEvent): void;
    /** 关闭区被点击（禁用时不发） */
    (event: "close", id: string, e: MouseEvent): void;
};

type Slots = {
    /** 替换文本 */
    default?(): unknown;
    /** 替换图标 */
    icon?(): unknown;
    /** 替换角标 */
    badge?(): unknown;
};
```

- 默认值：`icon` / `badge` 无（不渲染），`active` / `closable` / `disabled` 为 `false`。
- 扩展面：有 `slots`（三个，见上）；**没有 expose**；`attrs` 透传到根按钮（`data-*`、`class`、`title` 都会落到那个 `<button>` 上）。
- 关闭区的无障碍名称固定拼成「关闭 `<label>`」；宿主若需要自定义措辞，用插槽替换整个项，而不是改这里。

## 状态

- 默认：文字次级（`--text-muted`），悬停给一层 `--overlay-item-active` 底色并把文字提亮到 `--text-main`。
- 激活：文字 `--text-main` + 字重加粗 + 底部 2px `--accent-main` 指示条（`aria-selected="true"`）。
- 禁用：40% 不透明度、`cursor: not-allowed`，不发事件。
- 加载 / 出错 / 空数据：**没有这些形态**。要表达这些状态的页面请用文本或角标插槽自己画，组件不内置转圈与错误色。

## 不支持

- 不做键盘漫游（方向键、`Home` / `End`）与 roving `tabindex`——那是标签条的事。
- 不改变激活项、不关闭视图、不移动位置、不读 store、不访问存储、不发请求。
- 不解析 i18n（`label` 是已经解析好的文本）。
- 不做右键菜单、拖拽排序、固定 / 预览态（编辑器标签那些形态属于编辑器标签条，不属于面板标签条）。

## 注意事项

- 关闭区是根按钮**内部**的一个 `role="button"` 元素：它不进 Tab 序列，只响应指针；键盘用户要关闭面板视图得由宿主另给入口（快捷命令或标题动作）。这是当前实现的取舍，改它要么动这里要么由宿主提供键盘路径。
- 根按钮的 `disabled` 是原生属性：禁用项的指针事件不会触发，宿主不会收到任何回调——想「点了给个原因」就不该做成禁用页签。
- 标签条里横向平铺一排这样的按钮，宽度由内容决定；宿主需要压缩时给标签条 `overflow`，不要试图让本组件自己截断文字。
