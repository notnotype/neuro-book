---
标签: [state:inject]
别名: ["设定树", "条目树", "Entry Tree"]
---

# EntryTree

侧栏“设定”里的条目树（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 2、5）：一层一层列出条目，根下按分组插一层分组行；条目在缺省位置上还没出场时名字用次级色、后面写“未出场”，已删除的写“已删除”；一层没列完时末尾一行“再显示（还有 N 项）”。它是受控的领域视图：各层读到的数据、展开了哪些、选中哪个都由宿主给，它只把作者的点击翻成事件，不读世界。

## 布局与交互

主体是一棵 nb-ui 的 `Tree`（平面、单选、`toggleOn: "arrow"`），断开时上面多一条横幅；撑满父容器的宽度，高度随内容，滚动由父容器负责。根这一层按分组插分组行（分组名，不可打开，点了展开或收起）；分组为空的条目直接挂在根下，排在它在根里出现的位置；分组按它的第一个条目在根里出现的先后排。有子条目的条目带展开箭头；展开了但那一层还没读到时，下面一行次级色的“读取中…”。

- 单击条目行：发 `open`，不动展开（条目本身能打开，下面又有子条目：打开它不该顺带收起子条目）；Enter 同样。展开、收起有子条目的行只认点箭头（20 像素见方的点击目标）与键盘的左右键。
- 单击分组行：分组打不开，点它是展开或收起（发 `update:expanded`）。
- 单击“再显示”行：发 `more`，参数是那一层的父条目（根是 `null`）。
- 方向键、Home、End 与按字母跳转由 `Tree` 处理。
- `creatable` 时有右键菜单（nb-ui `ContextMenu`）“在它下面新建”：右键一行，或焦点在一行上按菜单键、Shift+F10；选了发 `create`，参数是那一行的条目（分组、“再显示”“读取中”与空白处是 `null`，即根这一层）。
- 根这一层正在读、还一项都没有时，只显示一行“读取中…”；读到了但一项也没有时：`creatable` 时是空状态（nb-ui `EmptyState`）：标题“还没有设定”，说明“人物、地点、物品、规矩，都可以建成设定”，主按钮“新建人物”（发 `create-person`）与按钮“新建条目”（发 `create`，`null`）；`createPerson` 为 false 时没有“新建人物”，“新建条目”成为主按钮；侧栏窄时两个按钮纵排。给了 `blockedReason` 时两个按钮禁用、悬停提示是它。不 `creatable` 时只写一行“还没有条目”。

宽度 390 像素时结构不变，名字截断，“未出场”这类说明保留。

## 数据

```ts
interface EntryTreeItem {
    readonly id: string;
    /** 缺省位置上的名字。 */
    readonly name: string;
    /** 分组；空字符串是没有分组。只在根这一层用。 */
    readonly folder: string;
    readonly hasChildren: boolean;
    /** 缺省位置上是否已出场。 */
    readonly appeared: boolean;
    readonly deleted: boolean;
}

interface EntryTreeLayer {
    /** 到目前读到的各页，按顺序。 */
    readonly items: readonly EntryTreeItem[];
    /** 这一层在已读的之后还会列出几项；大于 0 时末尾有“再显示”。 */
    readonly remaining: number;
    /** 还没读到过。 */
    readonly loading: boolean;
}

type EntryTreeProps = {
    /** 各层，键是父条目的 id，根这一层的键是空字符串。展开了、还没有这个键的层按“读取中”显示。必填、受控。 */
    layers: Readonly<Record<string, EntryTreeLayer>>;
    /** 展开的行：条目 id，以及分组行的 id（`folder:` 加分组名）。必填、受控，交互后由 `update:expanded` 给出新值。 */
    expanded: readonly string[];
    /** 选中的条目 id；没有时不写。受控。 */
    selected?: string;
    /** 世界已断开（订阅被提供方结束）：树上面一条横幅“世界已断开”与“重试”，树留着。默认 false。 */
    disconnected?: boolean;
    /** 有右键菜单“在它下面新建”，空着时是带新建按钮的空状态。默认 false。 */
    creatable?: boolean;
    /** 现在不能写（世界只读、别人独占、断开）：空状态的按钮禁用，悬停提示是它。默认空。 */
    blockedReason?: string;
    /** 空状态里有“新建人物”（宿主按“人物”这个种类登记了没有给）。默认 true。 */
    createPerson?: boolean;
};

type EntryTreeEmits = {
    /** 作者要打开这个条目（单击或 Enter）。 */
    (event: "open", id: string): void;
    /** 展开状态变了（点箭头、方向键、点分组行）；给出新的完整列表。 */
    (event: "update:expanded", value: string[]): void;
    /** 作者要接着读这一层；`parent` 为 null 是根这一层。 */
    (event: "more", parent: string | null): void;
    /** 点了横幅上的“重试”。 */
    (event: "retry"): void;
    /** 右键菜单里的“在它下面新建”，或空状态的“新建条目”；`parent` 为 null 是根这一层。 */
    (event: "create", parent: string | null): void;
    /** 空状态的“新建人物”：宿主打开预填了人物的新建对话框。 */
    (event: "create-person"): void;
};
```

没有插槽与 expose；未声明的 attrs 落在组件的根 `div` 上（横幅与树都在它里面）。

## 状态

- 默认：如上。
- 加载中：根这一层还没读到时一行“读取中…”；展开的条目那一层还没读到时它下面一行“读取中…”。
- 空数据：可以新建时是带两个新建按钮的空状态，否则一行“还没有条目”。
- 世界断开：`disconnected` 时树上面一条警告色横幅（`role="status"`）“世界已断开”与“重试”按钮，树照常显示已读到的内容（author-ui.md 输出 27）。
- 出错、禁用、只读：本组件没有这些状态。

## 不支持

- 拖动排序、搜索、多选。
- 图标：条目的种类不画图标。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口，“未出场”“再显示”这些界面文字在本插件的目录（命名空间 `nbook.canon`）；测试与 Lab 场景要注入登记了本插件目录的端口，否则只显示键名。
