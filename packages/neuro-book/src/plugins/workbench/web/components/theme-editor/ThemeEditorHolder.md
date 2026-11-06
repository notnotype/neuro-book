---
标签: [state:local, io:read, io:mutate]
别名: ["主题编辑器持有者", "Theme Editor Holder"]
验证入口: ThemeEditor
---

# ThemeEditorHolder

把主题编辑器会话里的那份模型交给 `ThemeEditor`：挂载时 `acquire`，卸载时 `release`。页签和浮动窗口里放的都是它，所以同时开着两处也只有一份模型，预览取最后一个释放之前的状态。它也是主题包缺省配色进来的地方：配色来自装载整套主题包的模块，不能进首屏，而这个组件只在编辑器打开时才加载。

## 为什么自己发请求

导出要读场景图的字节（`io:read`，取回 `/api/nbook.files/raw/user/theme-assets/…`），导入要把包里的素材传上去（`io:mutate`，`PUT /api/nbook.files/theme-assets`）。两件事由用户点“导出”“导入”触发，主体（`ThemeEditor`）只调这里给的 `transfer` 并显示结果，这样主体不碰产品数据、能在 Lab 里单独看。格式与校验在 `package-io.ts`，请求在 `transfer.ts`。

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
