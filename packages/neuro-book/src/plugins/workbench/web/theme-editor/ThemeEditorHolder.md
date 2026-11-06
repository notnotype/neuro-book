---
标签: [state:local]
别名: ["主题编辑器持有者", "Theme Editor Holder"]
验证入口: ThemeEditor
---

# ThemeEditorHolder

把主题编辑器会话里的那份模型交给 `ThemeEditor`：挂载时 `acquire`，卸载时 `release`。页签和浮动窗口里放的都是它，所以同时开着两处也只有一份模型，预览取最后一个释放之前的状态。它也是主题包缺省配色进来的地方：配色来自装载整套主题包的模块，不能进首屏，而这个组件只在编辑器打开时才加载。

## 数据

```ts
type Props = {
    session: ThemeEditorSession;
    themes: ReadonlyArray<ThemeEntry>;
    closable?: boolean;      // 页签里为 false，浮动窗口里缺省
};
type Emits = {close: []};
```

没有自己的布局与交互，全部交给 `ThemeEditor`。
