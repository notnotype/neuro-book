---
标签: [state:local, env:portal, env:timer]
---

# AlertDialog

`AlertDialog` 是用于破坏性或重要操作的模态确认框，固定提供取消与确认按钮，并通过 `tone` 区分危险确认与普通确认；它与可承载任意内容和页脚操作的 `Dialog` 不同，范围限定为一次确认决策。

## 布局与交互

内容以 Portal 放在页面上方，最大宽度为 420px，居中显示并带全屏遮罩。标题始终显示；描述仅在 `description` 非空或提供 `description` 插槽时显示。底部固定为取消、确认两颗按钮。`tone="danger"` 时确认按钮使用危险样式，`warning` 与 `accent` 使用主按钮样式。

可选 `trigger` 插槽作为触发器。点击取消发出 `cancel`，点击确认发出 `confirm`；两者的关闭与受控状态同步由 Reka Alert Dialog 管理，关闭后发出 `update:open`。没有触发器时不执行 Reka 的自动焦点归还。组件不提供 outside-click 或 Escape 关闭流程。

## 数据

```ts
type AlertDialogTone = "danger" | "warning" | "accent";

interface AlertDialogProps {
    /** 是否打开；可选，传入后为受控值；默认 undefined（非受控） */
    open?: boolean;
    /** 非受控模式的初始打开值；可选，默认 false */
    defaultOpen?: boolean;
    /** 标题；可选，默认 "确认操作" */
    title?: string;
    /** 描述；可选，默认空字符串 */
    description?: string;
    /** 确认按钮文字；可选，默认 "确定" */
    confirmText?: string;
    /** 取消按钮文字；可选，默认 "取消" */
    cancelText?: string;
    /** 确认按钮色调；可选，默认 "danger" */
    tone?: AlertDialogTone;
}

interface AlertDialogEmits {
    /** Reka open 状态变化时发出 */
    (event: "update:open", value: boolean): void;
    /** 点击确认按钮时发出 */
    (event: "confirm"): void;
    /** 点击取消按钮时发出 */
    (event: "cancel"): void;
    /** 关闭完成、内容卸载且 Reka 焦点清理结束后发出；有触发器时焦点已归还 */
    (event: "closed"): void;
}

interface AlertDialogSlots {
    /** 可选触发器；按 Reka as-child 方式承载 */
    trigger?: () => any;
    /** 替换标题文字 */
    title?: () => any;
    /** 替换描述内容 */
    description?: () => any;
}
```

`open` 未提供时由 Reka 内部持有当前状态，`defaultOpen` 只决定其初始值；`open` 提供后由父组件持有。组件没有 `expose` API。attrs 不属于稳定公共合同：唯一根是 Reka `AlertDialogRoot`，最终 DOM 落点由上游决定，不应依赖其透传位置。

## 状态与边界

没有单独的 busy、disabled 或 loading 状态。描述为空且无描述插槽时不渲染描述节点。没有 trigger 时关闭完成仍会发出 `closed`，但组件会阻止焦点自动归还。`closed` 不是关闭请求：它等到内容确实卸载且 Reka 的焦点栈与指针锁已释放后才触发，宿主需要在关闭后接续另一个交互层时应监听它，而不是估算等待时长。

## 上游边界

Reka UI 负责 Alert Dialog 的模态语义、焦点管理、Portal、受控/非受控状态与关闭生命周期。本组件承诺标题/描述及按钮文案、色调映射、事件名称和 `closed` 的完成时机；其余行为以及 Reka 升级后的实现细节不属于本组件合同。

## 隐藏通道理由

- `env:portal`：确认框必须脱离宿主的局部层叠上下文显示在页面上方；组件使用 Reka Portal，不提供目标选择 prop。目标位置与目标缺失时的表现由 Reka 决定，当前组件及测试未核实其细节。
- `env:timer`：`closed` 需等 Reka 的卸载清理结束后才上报；关闭交接使用一次零延迟定时器，并在重开或卸载时作废，避免宿主过早激活下一交互层。
