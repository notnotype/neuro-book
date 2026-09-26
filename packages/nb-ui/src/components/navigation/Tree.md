---
标签: [state:local, state:inject]
---

# Tree

`Tree` 是通用的层级节点树，面向章节、分类等不带固定文件系统语义的内容。它用稳定 `id` 对外表达选中值，由调用方决定节点标题和图标；不会因为节点有子项就替它画文件夹。需要文件/目录语义、拖放与右键操作时使用 `FileTree`。

## 布局与交互

根节点是 `role="tree"` 的纵向列表，默认带面板表面；`surface="plain"` 去掉卡片色面和描边但保留内边距。行按层级缩进，标题截断；只有存在 `children` 的节点显示展开箭头，无子项时保留同宽空位。只有调用方提供 `iconClass` 才显示节点图标。选中行以整行底色和文字强调表达，不使用左侧边框；焦点环另行显示。

方向键、Home / End、Enter / 空格与 typeahead 的焦点导航由上游树原语处理。右/左方向键展开或收起有子节点的行，并在可行时移动到子项或父项。点击行会选择节点；若其有 children，同一次点击也会切换展开态。选中行为随 `multiple` 切换：单选再次选择当前节点可清除选中，多选则切换该 id 是否在集合中。禁用整个树时所有节点不可操作。

## 数据

```ts
interface GenericTreeNode {
    id: string;
    title: string;
    /** 可选图标 class（例如 i-lucide-*）；不提供时不渲染图标。 */
    iconClass?: string;
    disabled?: boolean;
    children?: GenericTreeNode[];
}

type TreeSurface = "card" | "plain";

type TreeProps = {
    /** 递归节点数据；默认空数组。节点 id 应保持稳定且唯一。 */
    items?: GenericTreeNode[];
    /** 选中节点 id；默认 undefined。单选期望 string，多选期望 string[]。 */
    modelValue?: string | string[];
    /** 展开的节点 id 列表；默认空数组、受控。交互后须响应 update:expanded 更新它。 */
    expanded?: string[];
    /** 是否多选；默认 false。 */
    multiple?: boolean;
    /** 禁止树内交互；默认 false。 */
    disabled?: boolean;
    /** 根列表表面；默认 "card"。 */
    surface?: TreeSurface;
};

type TreeEmits = {
    /** 用户改变选中项后发出节点 id；multiple 时为 id 数组，清空单选时为 undefined。 */
    (event: "update:modelValue", value: string | string[] | undefined): void;
    /** 用户切换目录展开态后发出新的展开 id 列表。 */
    (event: "update:expanded", value: string[]): void;
    /** 用户选择节点后发出对应的完整节点数据。 */
    (event: "select", node: GenericTreeNode): void;
};

type TreeSlots = Record<never, never>;
```

`modelValue` 与 `update:modelValue` 对外使用 id，而不是上游原语要求的节点对象。单选 `modelValue` 可省略；此时选中状态在本次树实例内部暂存，同时仍发出 id 事件。传入 `modelValue` 时，父组件应更新它以维持受控选择。`expanded` 默认值为空数组且始终作为值传入上游，故展开是受控的：只监听事件但不更新 prop，节点不会保持展开。

组件没有 expose API 或插槽。未声明 attrs 按 Vue 单根行为传给 `TreeRoot`，最终落点由 Reka 的 `RovingFocusGroup` / `Primitive` 决定；不要依赖其透传到特定行节点。

## 状态与边界

- 默认空列表、卡片表面、单选、启用交互、没有展开节点和选中值。
- 多选时 `modelValue` 应是字符串数组；单选时应是单个字符串或 `undefined`。组件会按 `multiple` 从接收到的值构造节点对象，不接受外部节点对象作为公开值。
- `items` 中的 `children` 决定树层级；本组件不推导文件/目录含义。空 children 数组仍表示有子节点的分支类型。
- `GenericTreeNode.disabled` 当前未传给上游 `TreeItem`，因此节点级禁用字段不会阻止该行交互（已知偏差）；根级 `disabled` 会禁用整树。
- 组件没有空态文案、加载、错误或数据校验逻辑；空列表只呈现空的树根。

## 不支持

- 不提供节点拖放、右键菜单、文件图标推断、搜索或虚拟滚动。
- 不替调用方持久化选中与展开状态。

## 上游边界

Reka UI Tree 负责 tree/treeitem 语义、roving focus、typeahead、键盘导航以及节点选中/展开原语。本组件承诺 id 与节点数据的映射、行外观、选择事件和 `expanded` 受控映射；上游未在本组件中声明的焦点策略细节不属于额外合同。

## 隐藏通道理由

`state:local`：当父组件未提供 `modelValue` 时，上游 TreeRoot 会在本实例内部保留当前选中节点；这只供即时交互使用，组件卸载即丢失。传入 `modelValue` 后选中事实由父组件提供。展开状态则始终通过 `expanded` prop 受控，不使用本地回退。
`state:inject`：TreeRoot 通过 Reka ConfigProvider 的可选方向上下文取得 `dir`，未提供时回退 `ltr`；方向影响左右方向键的父子导航。沿用应用统一的阅读方向比要求每个树实例重复传递同一环境值更一致；本组件不读取业务 store。
