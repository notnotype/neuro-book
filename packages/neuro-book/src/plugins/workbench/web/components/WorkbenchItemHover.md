---
标签: [state:local]
验证入口: WorkbenchItemStrip
---

# WorkbenchItemHover

状态栏与标题栏条目的悬停内容（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 43）：放在条目的提示框里，加载贡献方交来的组件并渲染它；还没加载完、加载失败或渲染出错时显示退回的文字。只在 `WorkbenchItemStrip` 里用，脱离条目条没有可验证的状态。

## 数据

```ts
type Props = {
    /** 注册表交来的悬停内容：加载按 `hover` 对象缓存，渲染出错时调 `failed` 记诊断。必填。 */
    source: HoverSource;
    /** 没有内容可显示时的文字：条目的提示文字，没有提示时是条目名。必填。 */
    fallback: string;
};
```

没有事件、插槽与 expose；attrs 落在根元素上。

## 状态

- 加载中：显示 `fallback`。
- 加载完成：渲染加载到的组件，它自己的响应式数据变化时原地更新。
- 加载失败、渲染出错：显示 `fallback`；渲染出错只记一次诊断，之后不再尝试渲染这一份组件，换了 `source` 才重新开始。
