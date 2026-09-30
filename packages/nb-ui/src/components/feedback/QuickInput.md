---
标签: [state:local, env:portal, env:timer]
---

# QuickInput

`QuickInput` 是全局快速选择面板的受控 UI 基座：宿主提供查询、候选列表和活动项，组件只发出用户操作请求，不解释查询语义，也不执行候选项。它因此可以承载命令面板、资源跳转或其它快速选择，而不把业务执行逻辑带进组件。

## 布局

打开时显示模态遮罩和居中面板。面板宽度最多 640px，并在窄屏保留 12px 边距；顶距为视口高度的 8% 并限制在 16–72px，最大高度为 `min(560px, 100dvh - 48px)`。输入框固定在顶部，候选列表占据可滚动中间区域，加载/消息状态固定在底部。每条候选显示主标签，可选图标、分类、说明和快捷键；空列表且未加载时显示 `emptyText`。

输入框使用 `placeholder` 同时作为占位文本和可访问名称；标题关联到列表。活动项由 `aria-activedescendant` 表达。弹层默认传送到 `body`；若 `teleportTarget` 选择器未命中，回退到 `body`。

## 交互

- 打开时将焦点放到输入框并记录原焦点。关闭交接完成后，若 `restoreFocus` 为 true 且原焦点仍连接在文档中，则恢复焦点；随后发出 `closed`。
- 输入文字发出 `update:query`。上下方向键在可用项之间循环并发出 `update:activeId`；Home/End 跳至首尾可用项。鼠标悬停可请求激活对应可用项。
- Enter 对当前有效活动项发出 `accept(id)`；加载中、没有活动项、活动项已禁用时不接受。输入法组合态的 Enter 保留给输入法。
- Escape 与鼠标左键外点请求关闭，依次发出 `update:open(false)` 和 `close(reason)`；组件不自行改变受控 `open`。右键和 Ctrl+左键外点不关闭。其它由 Dialog 根产生的状态变化转发为 `update:open`。
- Tab 焦点循环由 Reka Dialog FocusScope 负责；本组件阻止 Tab 事件继续传播到下层监听。关闭交接使用微任务和下一宏任务等待浮层卸载及焦点范围清理，`closed` 不代表固定时长。

## 数据

```ts
type QuickInputItem = Readonly<{
    id: string;
    label: string;
    description?: string;
    category?: string;
    iconClass?: string;
    shortcut?: string;
    disabled?: boolean;
    /** label 中用于标亮的 UTF-16 [start, endExclusive) 范围。 */
    labelMatches?: readonly (readonly [number, number])[];
}>;

type QuickInputCloseReason = "escape" | "outside";

type QuickInputProps = {
    /** 是否打开；必填且受控。 */
    open: boolean;
    /** 当前查询；必填、受控。 */
    query: string;
    /** 完整候选列表；必填、受控。id 应唯一。 */
    items: readonly QuickInputItem[];
    /** 活动候选 id 或 null；必填、受控。 */
    activeId: string | null;
    /** Dialog 标题和列表可访问名称；必填。 */
    title: string;
    /** 输入框 placeholder 与可访问名称；必填。 */
    placeholder: string;
    /** 空列表提示；必填。 */
    emptyText: string;
    /** 底部辅助消息；默认空字符串。 */
    message?: string;
    /** 是否显示加载指示器；默认 false。 */
    loading?: boolean;
    /** CSS 选择器形式的 Portal 目标；默认 "body"，目标未找到时回退 body。 */
    teleportTarget?: string;
    /** 关闭完成后是否恢复打开前焦点；默认 true。 */
    restoreFocus?: boolean;
    /** 变化且面板打开时重新聚焦输入框；默认 0。 */
    focusRequest?: number;
};

interface QuickInputEmits {
    /** 根弹层状态变化；Escape/外点还会发 close。 */
    (event: "update:open", value: boolean): void;
    /** 查询输入变化。 */
    (event: "update:query", value: string): void;
    /** 键盘导航或悬停改变活动项。 */
    (event: "update:activeId", value: string | null): void;
    /** Enter 或点击有效候选项时发出。 */
    (event: "accept", id: string): void;
    /** Escape 或外点关闭请求；不等价于组件自行关闭。 */
    (event: "close", reason: QuickInputCloseReason): void;
    /** 浮层卸载、焦点交还完成后发出；中止的关闭交接不发。 */
    (event: "closed"): void;
}

interface QuickInputSlots {}
```

组件不提供 slot 或 expose 方法。继承属性被关闭，并显式绑定到浮层 `DialogContent` 根节点；ARIA 标记由组件生成，不应依赖覆盖这些关系属性。

## 状态与边界

- 默认关闭由必填 `open` 决定。查询、活动 id 和候选内容均由父组件持有。
- `loading` 时显示 Spinner，隐藏空列表提示，并阻止 Enter 与点击接受候选；鼠标悬停仍可能请求更新活动 id。
- 禁用候选带禁用语义，不可通过 Enter 或点击接受。对列表变更时的 activeId 保留、失效后选首个可用项、空列表置 null，属于宿主责任。
- 空候选且不加载时显示 `emptyText`；组件无独立错误态，错误消息可由宿主提供 `message`。
- 标签高亮范围越界、反向、重叠或切断代理对时会被忽略，仍以纯文本渲染，不解释标记语言。

## 不支持

- 不解析 `>` 命令、`:` 行号或其它查询语法；不筛选、排序候选，也不执行任何动作。
- 不替宿主修复无效 `activeId`，不持久化查询或活动项。
- 不提供结果列表自定义 slot。

## 上游边界

Reka UI Dialog 提供模态对话框生命周期、焦点范围、遮罩与 Portal 原语。本组件自行实现候选导航、焦点恢复及关闭交接；Dialog 的底层模态焦点管理和未声明的键盘细节仍由 Reka 负责，升级可能变化。

## 隐藏通道理由

`state:local`：组件持有输入元素引用、打开前焦点引用和关闭交接的有效性标记；这些临时生命周期状态随本实例结束，不作为业务状态对外暴露。

`env:portal`：全局面板需脱离宿主局部裁剪与 stacking context；`teleportTarget` 允许指定目标，选择器不存在时显式回退 `body`，避免浮层整块消失。Dialog 模态层也负责消费外点，防止点击穿透到底层。

`env:timer`：关闭交接在 Reka 浮层卸载并清理焦点范围后才发出 `closed`；`useCloseHandoff` 通过微任务和零延迟定时器把通知推迟到卸载清理之后，并在重开或销毁时使旧交接失效。仅靠同步事件无法表达此生命周期边界。
