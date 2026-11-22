---
schema: nbook.task/v2
taskId: t43-tier2-verification
status: done
updated: 2026-11-22
---

# 第二档开工核实：外部布局库的现状与编译产物原型构建

## 目标与范围

按提案 [nb-layout 做成通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 的“备选 C”与“第二档：发布流水线”，在第二档开工前：

- 核实外部布局库的现状，把 ADR 0044 第 5 条与提案里凭记忆写的说法换成有出处的事实；
- 用一次性的原型构建确认“已知的坑”那几条；
- 另补 ADR 0054 第 5 条要求的 Trellis 核对（没有逐字复制）：t37 整理控制器时应顺手做，记录里没有，挡着 t47 改 MIT。

只出调研与证据，不定流水线的形状（那是 t47 的事）。

合同：行为合同未变（只出调研与证据，没有 Spec 改动）。

## 当前状态

2026-11-22 完成。

- **外部库**：[调研](../../../../../docs/research/layout-libraries.md)。仓库里的几句说法大体属实，三处要更正：
  - dockview 只有缺省渲染方式在停靠时搬 DOM，`renderer: 'always'` 时元素不离开 DOM；
  - dockview 的免费版有键盘焦点导航，企业版独有的是空间键盘导航与键盘停靠（多行标签、固定标签确实只在企业版）；
  - reka-ui 没有叫 `Splitter` 的组件，原语是 `SplitterGroup`、`SplitterPanel`、`SplitterResizeHandle`。
  - Trellis 的许可证原文：source-available，非商业免费，商业使用要按档赞助或另签企业许可。
- **原型构建**（[证据](evidences/proto-build.txt)）：照插件 SDK 的做法（Vite 库模式出 JS 与 CSS，rolldown 加 `rolldown-plugin-dts` 出声明）一次就过。凭记忆写的坑逐条看：
  - 声明生成没有 TS2742、TS4023，空项目使用方 `vue-tsc`（不跳过库检查）通过。仓库已有的 `rolldown-plugin-dts`（`vue: true`）够用，不用另选出声明的工具；
  - `import.meta.env` 碰不到：t41 已把开发模式检查做成运行时开关；
  - 根入口的产物不带 `vue`，只导入一个没有依赖的共享块；
  - 样式全抽进 `style.css`，JS 不导入它，使用方必须自己导入。Vite 8 不按 `sideEffects` 摇掉显式导入的 CSS（写 `false` 也保留），webpack 没测；
  - 新发现一条：**声明文件不可复现**。同一份源码连续两次构建，JS 与 CSS 逐字节相同，`vue.d.ts` 里 `FloatWindowHandles` 的事件先后不同；
  - 不压缩的产物带着源码注释，里面有 Spec 的输出编号。
- **Trellis 核对**（[证据](evidences/trellis-similarity.txt)）：nb-layout、nb-workbench-layout 与工作台拖动的四个文件，和 Trellis 源码做机械比对，没有发现逐字复制的代码块。共有的片段都是通用写法；最长的一段是读屏文字的视觉隐藏样式，旧应用里也有。两处“照 Trellis”的注释与 470ms 缓出是行为参照。
- **派审查的问题**：外部库原本派给 Claude Sonnet（`claude -p`）查，它的联网工具在本会话里走被映射掉的模型，全部失败、只读到本机的 reka-ui，改由主会话用 curl 读 npm registry、GitHub 接口与仓库原文。

## 给 t47 的输入

- 出声明沿用 `rolldown-plugin-dts`。registry 上同版本字节不同的处理要考虑声明不可复现：要么对声明做排序或规范化，要么那条通道只比 JS 与 CSS。
- `style.css` 写进 README 的安装一步；`package.json` 仍写 `sideEffects: ["**/*.css"]`，没测过的打包器不靠运气。
- `lab-sources` 不进发布的 `exports`：它用 `import.meta.glob`，只有 Vite 宿主能用。
- 产物压缩或去注释，Spec 的输出编号不进包；共享块的名字（现在是 `theme-vars-*.js`、`sortable-*.d.ts`）用 `chunkFileNames` 改成中性的。
- MIT 的两项前置里，Trellis 的核对已完成；“MIT 的包不从 AGPL 的代码搬内容”写进 nb-layout 的 AGENTS.md 仍在 t47。
- 压缩后的体积（gzip -9）：`index.js` 约 7 KB、共享块约 14 KB、`vue.js` 约 34 KB、`style.css` 约 3 KB。

## 未验证边界

- dockview 停靠时搬 DOM 只有文档原文，没有在浏览器里实测；golden-layout、Lumino 只核了元数据。
- 原型只在 Vite 8 上构建与消费；webpack、Nuxt 没有试（提案本来就不承诺）。
- 原型的使用方只做了类型检查与构建，没有在浏览器里拖分隔线：发布前的空项目冒烟在 t47。
