---
标签: [state:local]
---

# LabToolbar

Lab 的顶栏：改**整页**的那几个旋钮。主题、配色、桌面背景与自定义壁纸，复制场景链接，恢复 Lab 默认配置。中栏工具条上的场景、画布尺寸、缩放与画布底改的是画布里的东西，不在这里。

它只呈现与转发：三个下拉是 `v-model`，值由 LabShell 持有并写进偏好；选壁纸、清除壁纸、复制链接、恢复默认都以事件交给 LabShell。

## 布局

一条全宽的应用条，左边是标题与组件总数，右边是旋钮。每一项都不收缩，空间不够时先藏组件计数、再收窄三个下拉、最后换行，旋钮一个都不消失（样式在 `lab-shell.css` 的容器查询里）。

桌面背景选「自定义图片」时才出现「选图片 / 换图片」与「清除」两个按钮。

## 交互

- 选了「自定义图片」却还没有图片时，直接打开文件选择框，而不是先显示一片空白再让人去找按钮。
- 选同一张图片两次也会生效：每次选完都清空文件框。
- 复制场景链接后按钮换成对勾，约 1.6 秒后复原；提示时长由 LabShell 决定。

## 数据

```ts
props: {
    componentCount: number;
    hasWallpaper: boolean;   // 已经有一张自定义壁纸
    linkCopied: boolean;     // 刚复制过场景链接
}
models: themeId, colorwayId, pageBackdrop   // 都是 string，必填
emits: {
    wallpaper: [file: File];
    "drop-wallpaper": [];
    "copy-link": [];
    reset: [];
}
```

## 隐藏通道理由

`state:local` 只有文件选择框的元素引用，用来在选「自定义图片」时替使用者打开它。不读写 store、不访问浏览器存储、不发请求。
