---
标签: [state:local, state:inject]
别名: ["场景图上传条", "Scene Image Slot"]
验证入口: ThemeEditor
---

# SceneImageSlot

主题编辑器里“选一张位图、处理、上传、写进声明”的一排操作（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 11、19）：场景图与工作态场景共用它，只差写进声明的哪个字段。

## 布局

一排：上传（已有图时叫“更换…”）、移除、状态文字；下面一行错误（上传失败）。不画图：缩略图或取景编辑由用到它的分区自己画，因为各自对“图片加载失败”的处理不同。

## 交互

- 选文件：浏览器先把图缩到最长边 2560px 以内、转成 WebP（不支持时 PNG），再经 `transfer.uploadScene` 上传；原图不留。目标（哪一套主题、哪个明暗）在选文件时就定下，处理与上传期间切了明暗或换了主题，图也落在发起时的那一套上。成功后用 `kind` 对应的模型动作（`setScene` 或 `setWorkingScene`）写进声明；写进去了才算成功：状态文字写体积（超过建议的 300 KB 时改写成提示，不拒绝）并发出 `stored`；声明被拒绝或提交失败时不报成功，原因在编辑器的提示行（`model.rejected`）。
- 进度、成功提示与失败原因属于发起上传时的那个目标（主题加明暗），只在界面当前正是那个目标时显示（`use-upload-status.ts`）；上传期间切走，别的目标不会看到转圈、体积或失败原因。有上传在进行时上传与移除按钮停用。“移除”按钮的可访问名写明是场景图还是工作态场景。
- 失败（超限、类型不对、符号链接、网络）：显示路由给的原因，原来的图不动。
- 移除：只去掉当前明暗的那个字段，素材文件不删（文件名是内容摘要，留着不重复）。

## 数据

```ts
type Props = {
    model: ThemeEditorModel;
    transfer: ThemeTransfer;
    kind: "scene" | "working";   // 写 scene 还是 workingScene
    name: string | null;         // 当前明暗里这个字段的素材文件名；null 表示没有
};
type Emits = {stored: []};
```

文字取自 `nbook.workbench` 的 `themeEditor.scene.*`（工作态场景用 `themeEditor.scene.working.*`），经注入的翻译端口。
