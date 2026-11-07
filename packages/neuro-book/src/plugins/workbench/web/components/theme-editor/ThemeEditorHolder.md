---
标签: [state:local, io:read, io:mutate]
别名: ["主题编辑器持有者", "Theme Editor Holder"]
验证入口: ThemeEditor
---

# ThemeEditorHolder

把主题编辑器会话里的那份模型交给 `ThemeEditor`：挂载时 `acquire`，组件作用域停止时 `release`（不用 `onBeforeUnmount`：setup 之后、挂载之前出错时它不会来，持有计数就不归零）。页签和浮动窗口里放的都是它，所以同时开着两处也只有一份模型，预览取最后一个释放之前的状态。它也是主题包缺省配色进来的地方：配色来自装载整套主题包的模块，不能进首屏，而这个组件只在编辑器打开时才加载。

## 为什么自己发请求

导出要读素材（场景图、工作态场景、图标）的字节（`io:read`，取回 `/api/nbook.files/raw/user/theme-assets/…`），导入要把包里的素材传上去、场景与图标分区要上传选好的文件、复制插件主题时要把它的素材读出来传成我的素材（`io:mutate`，位图 `PUT /api/nbook.files/theme-assets`，图标 `PUT /api/nbook.files/theme-icons`）。清理没人引用的素材（`POST /api/nbook.files/theme-assets/sweep`，先统计、确认后只删统计里的名单，请求在 `asset-upload.ts`，清单与流程在模型的 `unusedAssets`、`removeUnused`）也在这里发。写素材的入口（导入、上传、复制）都经 `model.trackAssetWork` 包一次，清理据此在它们进行时停用。这些由用户点“导出”“导入”“上传”“清理素材”触发，主体（`ThemeEditor`）只调这里给的 `transfer` 并显示结果，这样主体不碰产品数据、能在 Lab 里单独看。格式与校验在 `package-io.ts`，上传与复制在 `transfer.ts`、`asset-upload.ts`，导出下载在 `export-current.ts`。插件主题素材的地址经会话的 `assetUrl`（目录的 `assetUrl`）取，不在这里拼。

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
