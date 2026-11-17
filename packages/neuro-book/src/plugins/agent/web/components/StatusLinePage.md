---
标签: [state:inject, state:local]
别名: ["状态栏设置", "Status Line Page"]
---

# StatusLinePage

设置窗口 AI 分组下的“状态栏”页（[`agent/conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 45、46）：输入框下面那一行显示什么、按什么顺序。运行状态、等你处理、费用超过告警线、断线这些提醒总会显示，不在这里。它是页面，不是宿主：数据与写入在包装 `web/status-line-page.ts`，组件只吃普通的属性，写入交给配置服务。

## 布局

自上而下：预览，“左边”一组，“右边”一组。

- **预览**：一条真实的状态栏（nb-agent-ui 的 `AgentStatusBar`）加样本数据，随设置变；显隐、次序与窄时收起都是它自己的算法。插件的项在预览里不跑插件的代码，画一枚写着标题的占位。
- **每一组**：一个小标题，下面每一项一行：拖动柄、勾选（标题加说明）、插件的项标“插件”、“上移”“下移”两个图标按钮。第一项没有“上移”、最后一项没有“下移”（停用）。

## 交互

- 勾选发 `toggle`，带项 id；改的是显隐，立即写一次设置。
- 上移、下移与拖动都发 `move`，带项 id 与目标位置（这一侧里的第几位）。拖动用原生拖放，只在同一侧内排序：别的一侧的行不是落点，落点行的上沿画一条线。每一项的左右由目录定，不能移到另一侧。
- `writable` 为假（层坏了或连不上）时勾选、按钮与拖动都停用。

## 数据

```ts
type StatusLinePageProps = {
    /** 插件加的项（声明）；内置四项页面自己知道。 */
    pluginItems?: readonly StatusLineItem[];
    setting: StatusLineSetting;
    writable?: boolean;
};

type StatusLinePageEmits = {
    toggle: [id: string];
    move: [id: string, to: number];
};
```

没有插槽、没有 expose；attrs 落在根元素上。目录与解算用 nb-agent-ui 导出的 `statusLineCatalog`、`resolveStatusLine`，与视图同一份。

## 状态

没有自己的加载与出错状态：设置读不到时窗口自己说明层的状态，页面照缺省显示。

## 不支持

不做每个会话单独一份设置、提醒类的显隐、项在左右之间移动。

## 隐藏通道理由

- `state:inject`：翻译端口。
- `state:local`：拖动时的“正在拖哪一项、落在第几行”，只是界面状态，松手即清。
