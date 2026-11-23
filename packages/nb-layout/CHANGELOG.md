# 变更记录

`@notnotype/nb-layout` 每个版本里使用方看得到的变化，写给直接用这个包的人。怎么写见[发布手册的“写变更记录”](../../docs/standards/releasing.md#写变更记录)。变更记录不进 npm 包。

## [Unreleased]

## [0.1.0] - 2026-11-23

### 不兼容的改动

- 没有注入文字时，组件的读屏名称与提示用英文（以前是中文）。中文宿主注入 `zh-CN` 目录，见 README 的“文字”。

### 新增

- 第一次发到 npm：编译产物（ES 模块、类型声明、`style.css`），许可证 MIT。宿主是 Vue 3 加 Vite，要自己导入 `@notnotype/nb-layout/style.css`；对等依赖只有 `vue`。
- `layoutCatalogTranslate`（`@notnotype/nb-layout/text`）：只有一种语言、没有翻译引擎的宿主按自带目录注入文字。
- 公开名字都带稳定性标注，0.x 期间全部是 `@experimental`（编辑器悬停可见）；README 的“版本承诺”写了 `@stable` 的条件与它承诺什么。
- 实时布局的拖动会话 `createLiveDragSession` 与组件版 `useLiveDragSession`（`./vue`）：候选稳定才换预览、来源收起与展开、判定几何的冻结与换算、收起那一刻指针不动不重判、空位粘住、拿起的内容做成卡片跟手、一帧里先读后写，宿主只写落点与预览（类型 `LiveDragHost`、`LiveDragState`、`LiveDropFacts`、`LiveShowTarget`、`LiveGrid` 等）。`@experimental`，1.0 之前签名会变。
- 拖动会话的选项 `sampled`：会话的 `pointermove` 处理一开头调，按需排帧的循环在这里叫醒，不用另挂一个要抢在会话前面的监听。
- `NestedGrid`：拿起的内容项不在 `contents` 里时网格自己留住它（实例不卸载）；expose 加 `origin()`、`motionMs()`。
