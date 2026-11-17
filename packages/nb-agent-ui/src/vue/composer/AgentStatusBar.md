---
标签: [state:inject, env:portal, env:global]
别名: ["状态栏"]
---

# AgentStatusBar

输入框下面一行小字。行为合同见 [`conversation.md`](../../../../../../docs/specs/agent/conversation.md) 输出 15–18、45 与 [`agent-conversation-view.md`](../../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”。

## 布局与交互

- **左边**：数据项（上下文圆环与百分比，不知道窗口时只有绝对数；宿主加到左边的项）按设置的次序在前，提醒类跟在后面：运行阶段与用时、等重发、等批准或回答、正在停止（超过 10 秒提示工具没有响应）、费用告警、非普通模式的标记、“全部放行”的警告、断线。提醒类总显示，不受设置影响。左边放不下时省略，不挤右边。
- **右边**：数据项按设置的次序：用量（累计 tokens、输入、输出、缓存命中，图标与轮末的用量相同，明细在悬停）、费用（未知时不显示，0 写“免费”）、模型与推理档（一行文字）、宿主加到右边的项。缺省（没有设置）是用量、费用。
- **窄时收项**：右边按次序从前往后收进悬停，放得下为止，最后一项最后收；最后一项也放不下时全收，右边只剩“…”，左边的提醒不被挤没。收起的项仍在页面里（不可见、不占位）用来量宽度，量到的自然宽度记着，放宽后据此判断放不放得下；收起时最前面多一个“…”，悬停写收起的项的文字（宿主的项只有标题）。右边最多占状态栏宽度减去内边距与左边至少留的 72px（圆环与百分比）；还没量到宽度（首次渲染、没有布局的环境）时不收；量到宽度 0 的项（组件还在加载、加载失败、没有内容）不占位，不参与计数。收起的槽贴着状态栏左缘脱离文档流，不撑出横向滚动。宿主的项渲染抛错时只这一项不画（`RenderGuard`），状态栏其余项照常。右键菜单关闭后焦点回到打开前的元素（点到菜单外时不抢）。
- **右键**：给了 `statusLine` 时，在状态栏上右键弹出勾选菜单，列目录里全部的项（宿主的项后面标“插件”，悬停写说明），最后一项“状态栏设置…”。点一项发 `toggle`，点设置发 `openSettings`。不给 `statusLine` 时不弹，浏览器的右键菜单照常。

## 数据

```ts
type AgentStatusBarProps = {
    ctx: AgentConversationContext;
    registry: AgentViewRegistry;
    /** 用户的状态栏设置（`{order?, visible?}`，见 status-line.ts）；不给按缺省显示。 */
    statusLine?: StatusLineSetting;
};

type AgentStatusBarEmits = {
    (e: "inspect"): void;
    (e: "toggle", id: string): void;
    (e: "openSettings"): void;
};
```

`interaction.canInspectContext` 为真时圆环与缓存命中能点，发出 `inspect`，视图打开上下文详情。视图不自己计时，用时按 `ctx.now` 算。目录（内置四项加注册表 `statusItems` 里宿主的项）与显隐、次序的解算在 [`status-line.ts`](../../status-line.ts)，设置页与宿主用同一份。没有插槽、没有 expose。

## 状态

没选会话（`ctx.session` 为空）时不画数据项，提醒项照常。

## 隐藏通道理由

- `state:inject`：翻译端口，同视图里的其它零件。
- `env:portal`：右键菜单渲染到 `body`。
- `env:global`：`ResizeObserver` 量状态栏与各项的宽度（没有它的环境不收项）；右键菜单挂着时在 `document` 上监听外部点击。
