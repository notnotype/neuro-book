---
标签: [env:portal, env:global]
别名: ["拖影", "Drag Feedback"]
验证入口: WorkbenchShellLayout
---

# WorkbenchDragFeedback

工作台拖放的两样反馈（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳三输出 22）：跟着指针的拖影（拖动源的图标加标题，容器与视图同一种），以及落点预览（Switcher 的一条插入线，或内容区接收的那一半、剩余区、空 Part 的整个内容区）。它是受控的：拖动会话（`views/drag-session.ts`）算好预览，外壳把它和文字传进来，这里只画。

## 布局

拖影放到 `body` 下，`position: fixed`，在指针右下 12px，`pointer-events: none`。落点预览交给 nb-ui `DropFeedbackOverlay`（内缩、提示药丸、淡入与 aria-live 播报都在那里）。两者都带 `data-drag-feedback`：命中检测跳过它们，所以它们不会挡住落点。拖动源本身原地不动，不降透明度、不插占位。

拖动进行中，会话在根元素上写 `data-workbench-dragging`；本组件的全局样式据此把整页光标换成抓手、禁止扩选文字，并撤掉拖动源上按钮按下的缩放（指针捕获在源上，`:active` 会一直生效），源保持原尺寸。

## 数据

```ts
import type {DropFeedbackPreview} from "@notnotype/nb-ui/components";

type Props = {
    /** 跟着指针的拖影：拖动源的图标与标题，x、y 是指针的视口坐标；没有拖动为 null。 */
    ghost: {label: string; icon: string; x: number; y: number} | null;
    /** 落点预览：插入线或接收区域；没有可显示的落点为 null。 */
    preview: DropFeedbackPreview | null;
    /** 落点提示与播报的文字；空字符串不显示提示。 */
    label: string;
    /** 动作种类与拖动的视图数，写到覆盖层根的 data-drop-kind、data-drop-count，供探针读。 */
    kind: string;
    count: number;
};
```

没有事件、slot 与 expose。拖影根带 `data-workbench-drag-ghost`。

## 隐藏通道理由

- `env:portal`：拖影与预览都用视口坐标，要避开祖先的裁剪与 transform，所以放到 `body` 下。
- `env:global`：拖动中的光标与禁选写在全局样式里，按根元素上的 `data-workbench-dragging` 生效；标记由拖动会话写、会话结束时删。

## 不支持

不求命中、不判定、不提交；没有放下动画。
