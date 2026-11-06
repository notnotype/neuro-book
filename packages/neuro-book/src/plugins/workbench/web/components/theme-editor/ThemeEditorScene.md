---
标签: [state:local, state:inject]
别名: ["主题编辑器的场景分区", "Theme Editor Scene"]
验证入口: ThemeEditor
---

# ThemeEditorScene

主题编辑器的“场景与取景”分区（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 11、12、13）：当前明暗的场景图（上传、更换、移除）和下面的取景编辑（`CropEditor`）。亮、暗各一张，顶部的明暗切换决定这里编的是哪一张。

## 布局

上方一排：上传（已有图时叫“更换场景图”）、移除、状态文字；下面是错误行（上传失败、图片加载失败）；再下面是取景编辑，没有场景图时是一块虚线框的“这一套明暗还没有场景图”。

## 交互

- 选文件：浏览器先把图缩到最长边 2560px 以内、转成 WebP（不支持时 PNG），再经 `transfer.uploadScene`（持有者发 `PUT /api/nbook.files/theme-assets`）上传；原图不留。目标（哪一套主题、哪个明暗）在选文件时就定下，处理与上传期间切了明暗或换了主题，图也落在发起时的那一套上。成功后把返回的文件名写进当前明暗的 `scene`，状态文字写体积，超过建议的 300 KB 时改写成提示，不拒绝。
- 失败（超限、类型不对、符号链接、网络）：显示路由给的原因，原来的图不动。
- 移除：只去掉当前明暗的 `scene`，素材文件不删（文件名是内容摘要，留着不重复）。
- 换了图：取景编辑整个重建（按图的地址作 key），框按新图的比例重新算；上一张图的“图片加载失败”随图换掉。

## 数据

```ts
type Props = {model: ThemeEditorModel; transfer: ThemeTransfer};
```

文字取自 `nbook.workbench` 的 `themeEditor.scene.*`，经注入的翻译端口。
