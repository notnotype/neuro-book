---
标签: [state:local, env:portal]
别名: ["Agent 面板", "对话视图", "Agent Conversation"]
---

# Agent 对话视图

右侧 Agent 面板的纯视图：会话顶栏、消息流、待处理区、输入框与状态栏。数据全部由宿主通过 `ctx` 传入，用户意图全部以 `action` 事件交给宿主执行，视图自己不取数、不发请求、不持久化。和旧的 `AgentSidebarView` 相比，它有两处别处没有的特点：消息流按注意力分层，运行中 Agent 说出的话与人机交互控件常显、思维链默认折叠，已结束的轮次整轮收起，只露出最终回复与改动文件；工具呈现、顶栏动作、面板等全部走注册表，新增一种工具只需登记一项。

行为合同见 [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)。本文只写 Lab 演示不出来的部分。

## 布局

自上而下：顶栏、消息流、输入框。顶栏与输入框固定，消息流占据剩余高度并独立滚动。390 宽时顶栏标题区不小于 160px，右侧只留溢出菜单按钮。

消息流里每一轮由 `AgentConversationTurn` 呈现（一条用户消息加一条助手消息，沿用旧侧栏的对话气泡版式），见其同名文档；原始视图由 `AgentRawView` 呈现。消息流滚动容器保留滚动条槽位，流式追加内容时不因滚动条出现而挤动。面板拉宽时每轮限宽 800px 居中，避免正文行过长。

还有更早的内容时，消息流顶部是一行历史行：平时是两侧带细线的“更早的内容”，可以点击加载；加载中换成转圈和说明（约 200ms 后才淡入，读得快时不闪）；失败时是危险色说明和“重试”。三种状态高度一致。离开底部后，消息流底部正中浮着“回到最新”按钮。

## 交互

- 顶栏溢出菜单在“分轮视图”和“原始视图”之间切换，发出 `update:viewMode`。
- 点击整轮摘要行或思维链摘要行展开或收起；已结束的轮次默认收起，思维链默认折叠，手动操作过的轮次不再跟随自动收起。切换会话（`ctx.session.id` 变化）时每一轮重新挂载，展开记录随之清空。
- 每条消息角色行右端有消息操作（复制、编辑、重试、从此处分支及插件登记的操作），点击发出对应 action。常显，颜色弱；有多个分支时分支切换在操作条最前。
- 输入框：回车发送，Shift+回车换行；运行中回车为 steer，Ctrl/⌘+回车为 followup；运行中且输入为空时按钮变为停止。发送后不自行清空，等宿主给出新版本草稿。

## 滚动

由 `use-stream-scroll.ts` 负责，要点：

- 停在底部（距底不超过 24px）时跟随新内容；用户往上滚就不再跟随，出现“回到最新”，点击回到底部并恢复跟随。切换会话后回到最新。
- 离开底部后，内容高度变化不移动视口里正在读的内容：锚点是视口顶部第一个露出来的元素（取最深的那个）；它被移除时依次改用它的下一个兄弟、父元素……所以运行结束、过程收起时，正在读过程的人看到的是最终回复停在原处。宿主数据变化时，在视图更新之前记下锚点。
- 用户点开或收起某一项引起的变化以被点的那一项为锚点，即使原本停在底部也不把它推走。
- 滚动容器声明 `overflow-anchor: none`，不用浏览器自带的滚动锚定（Tauri 的 WebKit 没有它，且会和跟随底部各修一次）。历史行也声明 `overflow-anchor: none`，不当锚点。
- 滚到距顶 160px 以内、或内容不足一屏时发出 `history.loadPrevious`；宿主把 `history.loading` 置为 true 或补上内容之前不重复发出；失败后不自动重试。一页加载完而高度没变（补上的内容都收在已收起的轮次里）时，再检查一次是否仍在顶部。
- 开头不完整的一轮补上更早的消息后沿用原来的组件 key（`assignTurnKeys`），展开状态和阅读位置都不丢。

## 数据

```ts
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, AgentViewMode} from "./agent-view.types";
import type {AgentViewRegistry} from "./agent-view-registry";

type AgentConversationViewProps = {
    /** 只读领域数据，必填；可完整 JSON 化。形状见 agent-view.types.ts。 */
    ctx: AgentConversationContext;
    /** 纯函数能力，必填。 */
    services: AgentConversationServices;
    /** 扩展点注册表，必填；用 createAgentViewRegistry 构造，内置登记也在其中。 */
    registry: AgentViewRegistry;
    /** 消息流视图模式；可选受控。不传时由视图自持，初始为 "turns"。 */
    viewMode?: AgentViewMode;
    /** 浮层渲染目标；false 表示就地渲染。默认 false。 */
    teleportTarget?: string | false;
};

type AgentConversationViewEmits = {
    /** 用户意图。视图不去重，也不关心宿主如何执行。 */
    (e: "action", action: AgentViewAction): void;
    /** 从溢出菜单切换视图模式时发出；受控时父组件回写 viewMode 才生效。 */
    (e: "update:viewMode", mode: AgentViewMode): void;
};

type AgentConversationViewExpose = {
    /** 聚焦输入框。 */
    focusComposer(): void;
    /** 滚动消息流到最新内容。 */
    scrollToLatest(): void;
};
```

没有插槽，扩展一律通过注册表。未声明的 attribute、`class` 与 `style` 落到根节点。

`ctx.messages` 的语义约束：按时间顺序排列；同一 `id` 只出现一次；运行中尚未落盘的内容也在其中。`ctx.now` 是宿主提供的当前时间，运行中的用时按它计算，视图不自己计时，所以 Lab 可以确定性回放。

## 状态

- 未选择会话（`ctx.session` 为 null）：顶栏显示“未选择会话”，消息流为空态。
- 没有消息：消息流显示空态文字。
- `ctx.availability.status` 不是 `ready`：输入框只读，并在输入框上方显示说明。

## 不支持

- 不订阅 SSE、不调用接口、不读写浏览器存储与剪贴板；复制、上传、草稿持久化都通过 action 交给宿主。
- 不提供插槽替换任何区域。

## 隐藏通道理由

- `state:local`：未受控时的视图模式、输入框中尚未发送的文字、是否跟随底部与阅读锚点。这些是纯界面状态，不影响会话数据。每一轮里的展开状态由 `AgentConversationTurn` 自持。
- `env:portal`：溢出菜单使用 nb-ui `Dropdown`，其菜单浮层渲染到 `body`。后续切片的面板与弹窗渲染到 `teleportTarget`，目标不存在时就地渲染。

## 已知偏差

当前完成了切片 S1 到 S3（S5 的工具详情也已提前做了），以下 Spec 行为尚未实现：

- 渲染器（S5）：提问留痕、模式切换、Workflow、系统条目与错误条目的专用渲染器。
- 输入框（S6）：编辑器组件（输入框与历史消息的就地编辑共用）、触发菜单、命令、图片、模式与模型、提问向导。
- 顶栏动作、面板、待处理区、状态栏与弹窗（S7）。
