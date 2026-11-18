---
标签: [state:inject, env:portal, env:global]
别名: ["状态栏设置", "Status Line Page"]
---

# StatusLinePage

设置窗口 AI 分组下的“状态栏”页（[`agent/conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 45、46）：输入框下面那一行显示什么、按什么顺序。运行状态、等你处理、费用超过告警线、断线这些提醒总会显示，不在这里。它是页面，不是宿主：数据与写入在包装 `web/status-line-page.ts`，组件只吃普通的属性，写入交给配置服务。

## 布局

自上而下：预览，“左边”“右边”两组（nb-layout 的 `SortableList`）。

- **预览**：一条真实的状态栏（nb-agent-ui 的 `AgentStatusBar`）加样本数据，随设置变，整块 `inert`（只读，没有右键菜单、tab 停靠点与悬停提示）；显隐、次序、分边与窄时收起都是它自己的算法。插件的项在预览里不跑插件的代码，画一枚写着标题的占位。
- **两组**：每组一个小标题，下面每一项一行：拖动把手（`SortableList` 画）、勾选（标题加说明）、插件的项标“插件”、“上移”“下移”两个图标按钮。把手、插件标记与按钮都对齐勾选标题那一行。空的一组显示“拖到这里”。

## 交互

- 勾选发 `toggle`，带项 id；改的是显隐，立即写一次设置。
- 拖动是实时布局（[`ui/sortable-list.md`](../../../../../../../docs/specs/ui/sortable-list.md)）：被拖的行跟手，邻居让开，不画落点线，可以拖到另一组；松手调一次 `onMove`，带项 id 与目标位置（哪一边的第几位）。`onMove` 返回写入的 Promise 时，放下后的次序留到它 settle，写失败回到原样。键盘从把手拿起。
- 上移、下移发 `shift`，带项 id 与 -1 或 1，在“左边接右边”这一串里挪一位（右边第一项上移到左边最后，左边最后一项下移到右边第一），位置由写入时按最新的次序算，所以同一项连点几下每次都挪一格。只有左边第一项没有“上移”、右边最后一项没有“下移”（停用）。
- `writable` 为假（层坏了或连不上）时勾选、按钮与拖动都停用。

## 数据

```ts
type StatusLinePageProps = {
    /** 插件加的项（声明）；内置四项页面自己知道。 */
    pluginItems?: readonly StatusLineItem[];
    setting: StatusLineSetting;
    writable?: boolean;
    /** 拖动放下：移到哪一边的第几位。函数属性（模板里写 `@move`），返回写入的 Promise 时放下后的次序留到它 settle。 */
    onMove?: (id: string, to: StatusLineSlot) => void | PromiseLike<unknown>;
};

type StatusLinePageEmits = {
    toggle: [id: string];
    shift: [id: string, delta: -1 | 1];
};
```

没有插槽、没有 expose；attrs 落在根元素上。目录与解算用 nb-agent-ui 导出的 `statusLineCatalog`、`resolveStatusLine`，与视图同一份。

## 状态

没有自己的加载与出错状态：设置读不到时窗口自己说明层的状态，页面照缺省显示。

## 不支持

不做每个会话单独一份设置、提醒类的显隐。

## 隐藏通道理由

- `state:inject`：翻译端口。
- `env:global`（另一处来源）：排序列表（`SortableList`）的拖动会话在拿起到放下之间监听窗口的指针与按键。
- `env:portal`、`env:global`：来自内嵌的预览（`AgentStatusBar`）：它的右键菜单挂在 `body` 里，`ResizeObserver` 与文档监听也照挂；预览整块 `inert`，用户碰不到这些。
