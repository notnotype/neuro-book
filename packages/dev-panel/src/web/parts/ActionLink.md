---
标签: []
---

# ActionLink

去别的页的次要操作（t15 阶段 3f）：“编辑 README”“新建 Task”“看文档”“单独打开”这类入口，样子是带图标与文字的 ghost 按钮，本身是真实链接。主要操作（写入）用 nb-ui 的 `Button`；不再用 11px 的灰字链接当按钮。

用链接而不是 nb-ui `Button`：`Button` 只渲染 `<button>`，不能中键开新标签页、不能复制地址；面板的约定是去别的页的入口都是真实链接（docs/panel.md 的“零件”）。

## 布局

行内弹性块：可选的图标加文字，高 1.75rem，左右 0.5rem 内边距，`--text-xs`、500 字重；最宽是所在的行，放不下就换行（首页的会话入口文字随状态变长，390 宽时不换行会横向溢出）。短入口照样一行。悬停有浅底。焦点环用面板的全局焦点样式（nb-ui 的 `--focus-outline`）。

## 交互

普通左键点击时零件 `preventDefault` 并发 `navigate`，由宿主 `router.push`；中键与带修饰键的点击交给浏览器（新标签页、复制地址）。`external` 时在新标签页打开、不发 `navigate`（产物页的“单独打开”）。

## 数据

```ts
interface ActionLinkProps {
    /** 去哪里（面板内的地址由 host/routes.ts 拼；external 时是完整地址）；必填 */
    href: string;
    /** 图标类名（i-lucide-*）；可选，默认不给 */
    icon?: string;
    /** 外部地址：新标签页打开，不发 navigate；可选，默认 false */
    external?: boolean;
    /** 页头的主要操作：实心强调色底、白字（t22：每页一个，Work 页“新建 Task”、Task 页“编辑 README”）；可选，默认 false */
    primary?: boolean;
}
interface ActionLinkEmits {
    /** 普通左键点击面板内的地址 */
    (event: "navigate", href: string): void;
}
interface ActionLinkSlots {
    /** 文字；必填 */
    default: () => unknown;
}
```

没有 expose；attrs 落到 `<a>`。

## 不支持

- 不写入、不确认：写入用 nb-ui `Button`。
- 不做禁用态：不能去的入口由宿主不渲染，并写明原因。
