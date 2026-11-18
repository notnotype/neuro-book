---
标签: [state:inject, env:portal, env:global]
别名: ["状态栏"]
---

# AgentStatusBar

输入框下面一行小字。行为合同见 [`conversation.md`](../../../../../../docs/specs/agent/conversation.md) 输出 15–18、45 与 [`agent-conversation-view.md`](../../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”。

## 布局与交互

- **两边**：数据项（上下文圆环与百分比，不知道窗口时只有绝对数；用量：累计 tokens、输入、输出、缓存命中，图标与轮末的用量相同，明细在悬停；费用：未知时不显示，0 写“免费”；模型与推理档，一行文字；宿主加的项）按设置的边与次序画，任一项都能在左边或右边。缺省（没有设置）是左边上下文，右边用量、费用。
- **提醒**：跟在左边的数据项后面：运行阶段与用时、等重发、等批准或回答、正在停止（超过 10 秒提示工具没有响应）、费用告警、断线。提醒类总显示，不受设置影响。Agent 模式与审批模式不在这里标，看输入框工具栏的控件。
- **窄时收项**：放不下时先收右边、从前往后，右边收完再收左边的数据项、从后往前；提醒不收，都收完还放不下时左边整块裁掉多出的部分。收起的项都进右边最前面的“…”，悬停按呈现顺序写它们的文字（上下文写百分比或绝对数，宿主的项只有标题）；上下文收起时圆环的“打开上下文详情”跟着收起。收起的项仍在页面里（不可见、不占位）用来量宽度，量到的自然宽度记着，放宽后据此判断放不放得下；提醒那一块不收缩，量的是自然宽。还没量到宽度（首次渲染、没有布局的环境）时不收；量到宽度 0 的项（组件还在加载、加载失败、没有内容）不占位，不参与计数。收起的槽贴着状态栏左缘脱离文档流，不撑出横向滚动；右边没有项、也没有收起时不画右边那一块。宿主的项渲染抛错时只这一项不画（`RenderGuard`），状态栏其余项照常。右键菜单关闭后焦点回到打开前的元素（点到菜单外时不抢）。
- **右键**：给了 `statusLine` 时，在状态栏上右键弹出勾选菜单，列目录里全部的项（宿主的项后面标“插件”，悬停写说明），最后一项“状态栏设置…”。点一项发 `toggle`，点设置发 `openSettings`。不给 `statusLine` 时不弹，浏览器的右键菜单照常。

## 数据

```ts
type AgentStatusBarProps = {
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
    /** 用户的状态栏设置（`{order?, visible?, side?}`，见 status-line.ts）；不给按缺省显示。 */
    statusLine?: StatusLineSetting;
};

type AgentStatusBarEmits = {
    (e: "inspect"): void;
    (e: "toggle", id: string): void;
    (e: "openSettings"): void;
};
```

`interaction.canInspectContext` 为真时圆环与缓存命中能点，发出 `inspect`，视图打开上下文详情。视图不自己计时，用时按 `ctx.now` 算。目录（内置四项加注册表 `statusItems` 里宿主的项）与显隐、次序、边的解算，以及窄时收哪几项，在 [`status-line.ts`](../../status-line.ts)，设置页与宿主用同一份。每一项由内部零件 `AgentStatusItem` 画。没有插槽、没有 expose。

## 状态

没选会话（`ctx.session` 为空）时不画数据项，提醒项照常。

## 隐藏通道理由

- `state:inject`：翻译端口，同视图里的其它零件。
- `env:portal`：右键菜单渲染到 `body`。
- `env:global`：`ResizeObserver` 量状态栏与各项的宽度（没有它的环境不收项）；右键菜单挂着时在 `document` 上监听外部点击。
