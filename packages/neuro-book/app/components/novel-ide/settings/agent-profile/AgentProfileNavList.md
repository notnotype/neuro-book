---
标签: [state:inject]
---

# AgentProfileNavList

Agent Profile 设置页的二级导航。它只负责呈现默认设置入口、可搜索的 Profile 列表及每个 Profile 的状态元数据；Profile 数据加载、草稿、保存和当前详情页由父级编排器负责。

## 布局

根节点是单一的 `nav`，顶部身份区用可见的 `Agent Profiles` 标题和领域图标建立导航层级；搜索框、默认设置入口、Profile 分组标题和列表依次位于其下。导航标题通过实例级 `id` 与 `nav` 的 `aria-labelledby` 关联；搜索框不渲染可见文字标签，label 文本通过 `sr-only` 与 input 保持 `for`/`id` 关联，placeholder 由 `FormInput` 呈现。

搜索和默认设置入口位于列表上方，默认入口作为独立的基线区块与 Profile 列表分隔；Profile 列表使用独立的纵向滚动容器。Profile 增多时先让位的是列表内容，顶部身份区、搜索和默认入口保持可见。Profile 行第一行是图标、名称、`profileKey`（名称右侧等宽小字）与状态图标，第二行是固定高度徽章轨道；所有行由相同的内容结构决定高度，名称与 `profileKey` 截断，长文本与多个徽章不会撑破按钮和页面宽度。默认设置入口使用相同的两行结构（标题 + 描述），与 Profile 行等高。

`390 × 844` 下仍使用固定搜索加纵向列表，不切换为横向导航条、横向轮播或抽屉。核心入口、状态文字、焦点环和 Profile 选择保持可见；内容超出时只由列表自身滚动，名称、key 和徽章在行内不重叠。

## 交互

搜索按 `search.trim()` 后的值进行大小写不敏感的 `includes` 匹配，同时匹配 Profile 的 `name` 和 `profileKey`。它只过滤 Profile 列表，不隐藏默认设置入口、不改变排序、不修改 `activeKey`；当前 Profile 被过滤后，详情状态仍由父组件持有，清空搜索后当前标记恢复。搜索每次输入都发出原始字符串，包括前后空格；用户直接编辑原生搜索 input 清空内容，焦点保持在该 input。

默认设置入口点击时发出 `update:activeKey`，值为 `""`；Profile 入口点击时发出对应的 `profileKey`。重复点击当前入口仍发出事件。非 `loaded` Profile 仍可选择，加载状态只提供说明，不擅自改变详情页可用性。

所有入口都是原生 `button type="button"`。Tab 顺序是搜索 input、默认设置按钮、每个当前可见的 Profile 按钮。Enter 和 Space 使用原生按钮行为完成选择；不自定义方向键、Home 或 End 模型。当前入口使用 `aria-current="page"`，并同时使用持续可见的非颜色选择标记。

## 数据

```ts
interface AgentProfileNavListProps {
    items: AgentProfileNavItem[];
    /** 空串表示默认设置页；受控，组件不自行修改。 */
    activeKey: string;
    /** 原始搜索输入；组件只用 trim 后的小写值过滤。 */
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

四个 prop 都是必填的受控值，组件不修改它们，也不会为未知 `activeKey` 自动发出纠正事件。`activeKey === ""` 表示默认设置页，否则表示当前 Profile key。`items` 由父组件按稳定的 `profileKey` 排序并提供；`overrideCount` 是模型、运行策略和 Profile 设置的显式覆盖字段总数，`dirty` 表示当前草稿不同于已保存快照，`isDefault` 表示当前生效的默认 Profile。

组件没有 slots，也不 expose 方法或属性。未声明的 attribute、`class`、`style` 和 `data-*` 按 Vue 默认行为透传到单一根 `nav`。不启用 nb-ui `FormInput.clearable`，因此不存在额外的清空按钮或额外 Tab 停靠点。
- **Profile 当前项**：只有 `activeKey` 与某个可见 `profileKey` 相等时，该 Profile 按钮带 `aria-current="page"`。当前项使用整行 accent 软底表达选择，不依赖 check 图标、左侧标记或按钮边框；过滤掉当前项或传入未知 key 时，不伪造可见 current。
- **加载状态**：七种 `loadStatus` 都有持续可见的本地化文字和右侧装饰图标。`loaded` 使用 `success`；`compiling` 使用 `accent`；`not_compiled`、`compile_stale` 使用 `warning`；`compile_failed`、`compiled_load_failed`、`source_error` 使用 `danger`。颜色不是唯一信息源。
- **Profile 元数据**：`isDefault` 显示“当前默认”；`dirty` 显示“有未保存的修改”；`overrideCount > 0` 显示本地化覆盖计数，零覆盖不显示计数徽章。默认、dirty 和覆盖数不只依赖颜色或 `title`，且与状态徽章位于同一条名称下方徽章轨道。Profile 区说明通过 info 按钮的 Tooltip 提供，不常驻占用列表标题高度。

## 不支持

- 不支持 `Listbox` 的方向键、Home、End 或节点对象模型；这是页面导航，不是假装成选项列表的控件。
- 不支持 disabled、readonly、loading 等额外 props，不支持自动聚焦。
- 不支持排序、拼音搜索、模糊搜索、搜索高亮或由导航层改变 Profile 可用性。
- 不支持持久化、真实配置读取、API 调用、store 访问或宿主条件分支。
- 不负责 Profile 消失后的 `activeKey` 纠正；父组件负责该数据一致性。
- 组件不是浮层，不负责挂载时抢焦点、卸载时焦点转移或把焦点归还给触发控件。

## 隐藏通道理由

`state:inject` 仅表示组件通过 Nuxt i18n provider 获取 `t` 翻译能力。状态文字和导航文案必须由当前应用的 i18n provider 提供，避免把同一套本地化资源复制进领域组件；除此之外组件不读取 store、路由、浏览器存储、API、Provider/Model、Project 或 Session，也不注册全局监听、不使用计时器、不创建 portal。
