# 外部布局库的现状（2026-11-22）

- **日期**：2026-11-22
- **问题**：[ADR 0044](../adr/0044-workbench-single-layout-tree.md) 第 5 条与提案 [nb-layout 做成通用布局库](../proposals/nb-layout-general-library.md) 的“备选 C”里，关于 dockview、allotment、splitpanes、reka-ui、golden-layout、Lumino 与 Trellis 的几句话是凭记忆写的。这里换成有出处的事实。
- **来源**：npm registry 的包元数据（`https://registry.npmjs.org/<包名>`，2026-11-22 取）、GitHub 的仓库元数据（`https://api.github.com/repos/<仓库>`）、各仓库默认分支上的 LICENSE 与 README 原文、dockview 仓库里的文档源文件、本机 `node_modules` 里 reka-ui 的源码。原始文件留在本地，不入库。
- **证据等级**：每条后面标注。“元数据”指 npm 或 GitHub 接口返回的字段；“官方文档”指仓库里的文档或 README 原文；“源码”指包的源码文件；“检索”是二手资料。
- **状态**：只核实了下文列出的事实。功能清单只写有一手出处的项，其余写“未查”。
- **关联工作**：[w00026 t43](../../.agents/works/w00026-layout-package/tasks/t43-tier2-verification/README.md)

## 仓库里的说法逐条核对

| 说法 | 核对结果 | 依据 |
|---|---|---|
| dockview 停靠时搬 DOM | 部分属实：缺省渲染方式（`onlyWhenVisible`）会把面板的元素移出 DOM，停靠时把元素在组之间搬动；`renderer: 'always'` 时元素不离开 DOM，隐藏用 `visibility: hidden` | 官方文档 `packages/docs/docs/core/panels/rendering.mdx` 的 iframes 一节：“docking moves a panel's element between groups”“render its panel with `renderer: 'always'` so the element is never removed from the DOM” |
| dockview 的多行标签、固定标签、键盘导航是付费档 | 多行标签、固定标签属实；键盘导航部分属实：“Keyboard focus navigation”在免费版里，“Spatial keyboard navigation”“Keyboard docking”只在企业版 | 官方文档 `packages/docs/docs/overview/licence.mdx` 的功能对照表 |
| GitHub 识别不出 dockview 的许可证 | 属实：仓库接口的 `license.spdx_id` 是 `NOASSERTION`；仓库根是 `LICENCE.md`，内容是“各包许可证不同”的说明加 MIT 全文 | 元数据；官方文档 `LICENCE.md` |
| dockview core 是 MIT、无依赖，另有按框架拆开的 Vue 与 React 包 | 属实：`dockview-core` 8.9.1 的 `license` 是 MIT、`dependencies` 为空；`dockview-vue`、`dockview-react` 各自只依赖 `dockview`。另有不开源的 `dockview-enterprise` | 元数据；官方文档 `LICENCE.md` |
| allotment 是 VS Code splitview 的移植（React） | 属实：README 写“derived from the same codebase”（指 VS Code 的 split view），peer 依赖是 `react`、`react-dom` | 官方文档 README；元数据 |
| splitpanes 是 Vue 的分隔窗格 | 属实：README 写“A Vue.js reliable, simple and touch-ready panes splitter / resizer. Vue 3 compatible.” | 官方文档 README |
| reka-ui 的 Splitter | 名字不准：reka-ui 没有叫 `Splitter` 的单个组件，原语是 `SplitterGroup`、`SplitterPanel`、`SplitterResizeHandle` 三个组件 | 源码 `reka-ui/src/Splitter/`（本机 2.10.3） |
| Trellis 的许可证与 AGPL 不兼容（判断，不是法律意见） | 只核对许可证原文（不做法律判断）：三档许可，非商业免费；商业项目、10 名开发者以内要在 GitHub Sponsors 上按档赞助，赞助期间有商业许可；超过 10 名开发者要另签企业许可。网站写“Trellis is source-available” | 官方文档 `LICENSE.md`；网站首页的许可一节；npm 的 `license` 字段是 `SEE LICENSE IN LICENSE.md`；GitHub 识别为 `NOASSERTION` |
| golden-layout、Lumino 没有核实 | 见下表：只核了元数据，功能未查 | 元数据 |

## 各库的元数据

取自 npm 的 `latest` 版本与 GitHub 仓库接口，2026-11-22。“近一年发布数”是 npm `time` 里 2025-11-22 之后的版本条数。

| 包 | 最新版本与日期 | 许可证 | 运行时依赖 | peer | 解包大小 | 近一年发布数 | GitHub 识别的许可证 | 仓库最近推送 |
|---|---|---|---|---|---|---|---|---|
| `dockview-core` | 8.9.1，2026-11-17 | MIT | 无 | 无 | 5,764,388 字节 | 73 | `NOASSERTION` | 2026-11-18 |
| `dockview-vue` | 8.9.1，2026-11-17 | MIT | `dockview` | `vue ^3.4.0` | 259,127 字节 | 70 | 同上 | 同上 |
| `dockview-react` | 8.9.1，2026-11-17 | MIT | `dockview` | `react`、`react-dom` 16.8 到 19 | 1,944,516 字节 | 70 | 同上 | 同上 |
| `allotment` | 1.20.6，2026-10-12 | MIT | `classnames`、`usehooks-ts`、`lodash.clamp`、`eventemitter3`、`fast-deep-equal`、`lodash.debounce` | `react`、`react-dom` 17 到 19 | 217,957 字节 | 2 | MIT | 2026-11-21 |
| `splitpanes` | 4.1.2，2026-05-26 | MIT | 无 | `vue ^3.2.0` | 82,718 字节 | 4 | MIT | 2026-08-12 |
| `reka-ui` | 2.11.0，2026-10-05 | MIT | 9 个（`@floating-ui/vue`、`@vueuse/core`、`@tanstack/vue-virtual` 等） | `vue >= 3.4.0` | 9,181,459 字节（整个组件库） | 24 | MIT | 2026-11-21 |
| `golden-layout` | 2.6.0，2022-09-26 | MIT | 无 | 无 | 2,059,600 字节 | 0 | MIT | 2026-09-12 |
| `@lumino/widgets` | 2.10.0，2026-10-08 | BSD-3-Clause | 11 个 `@lumino/*` 包 | 无 | 4,811,243 字节 | 6 | `NOASSERTION` | 2026-11-21 |
| `@danfessler/trellis` | 0.3.0，2026-09-28 | `SEE LICENSE IN LICENSE.md` | 无 | 无 | 666,729 字节 | 3 | `NOASSERTION`（名称 Other） | 2026-11-20 |
| `react-resizable-panels` | 4.24.1，2026-11-18 | MIT | 无 | `react`、`react-dom` 18 到 19 | 2,729,217 字节 | 116 | — | — |

- 解包大小是 npm 的 `dist.unpackedSize`，含各种模块格式、类型声明与源码映射，不是打进应用的体积。
- `react-resizable-panels` 不在原来的名单里，allotment 的 README 把它列为替代品，一并记下元数据。
- Trellis 的 npm 包另有 `@danfessler/trellis-react`（网站的安装命令 `npm i @danfessler/trellis @danfessler/trellis-react`）；仓库的 `packages/` 下有 `core`、`element`、`react` 三个目录。

## 功能（只写有一手出处的）

### dockview

出处：官方文档 `licence.mdx` 的对照表。“免费”指 MIT 的 `dockview`，“企业版”指 `dockview-enterprise`。

- 免费：可停靠的网格与嵌套布局；标签与组的拖放、外部拖入、触屏与笔、边缘落点、自定义落点覆盖层与拖影；最大化、浮动组、弹出到新窗口、边缘组、锁定；拖动调整尺寸、尺寸约束；两种渲染方式；保存与恢复布局；主题与 CSS 变量；ARIA 角色与读屏播报、焦点指示、键盘焦点导航；React、Vue 3、Angular 绑定。
- 只在企业版：搜索与最近优先的溢出菜单、多行标签、固定标签、DnD compass、smart guides、自动隐藏的边缘组、停靠到边缘组、布局历史、空间键盘导航、键盘停靠。
- 企业版用 `LicenseManager.setLicenseKey(...)` 设授权码，导入 `dockview-enterprise` 即启用（官方文档 `packages/dockview-enterprise/README.md`）。

### allotment

出处：README。可以把窗格吸附收起、嵌套分割、显示与隐藏窗格、跨重新加载记住尺寸。README 写它“aims to reproduce the behaviour of VS Code's split view”。拖放停靠、键盘操作：未查。

### splitpanes

出处：README 的版本记录。4.1.0 起分隔条可聚焦、方向键调整、`keyboard-step` 属性与 ARIA 属性；1.1.0 起拖分隔条时可以推开别的窗格；3.0.0 起支持 Vue 3（Vue 2 用 `splitpanes@legacy`）。停靠、收起：未查。

### reka-ui 的分割原语

出处：源码 `reka-ui/src/Splitter/`（本机 2.10.3，不是最新的 2.11.0）。

- `SplitterGroup` 的 `direction` 定方向；`SplitterPanel` 有 `minSize`、`maxSize`、`collapsible`、`collapsedSize`，单位由 `sizeUnit` 选百分比或像素。
- 面板的尺寸写成 flex 值（`utils/style.ts`：`flexBasis`、`flexGrow`、`flexShrink`），改尺寸不换父元素。
- `SplitterResizeHandle` 是 `role="separator"`（`SplitterResizeHandle.vue:158`）；方向键每次移动 `keyboardResizeBy`（缺省 10，`SplitterGroup.vue:101`）。
- `autoSaveId` 把布局存进 `localStorage`，也可以传自定义的 `storage`。
- 组件清单里没有标签条、浮动、停靠或落点指示。

### golden-layout、Lumino、Trellis

功能未查。Trellis 只记 [w00026 t01](../../.agents/works/w00026-layout-package/tasks/t01-requirements/README.md) 当时读文档与 IDE 示例得到的行为（“内容只挂载一次，移动时只改位置”等），本次没有复核。

## 未验证边界

- dockview 的“停靠时元素在组之间搬动”来自文档原文，没有在浏览器里实测；`always` 模式下元素是否在停靠时完全不换父元素，只有文档“never removed from the DOM”一句。
- 各库的体积只有 npm 的解包大小，没有量打进应用之后的体积。
- golden-layout、Lumino 只核了元数据；allotment、splitpanes 只读了 README，没读源码与文档站。
- reka-ui 读的是本机 2.10.3 的源码，2.11.0 的变化没有核对。
- Trellis 只核了许可证原文与包元数据，功能与实现没有读。
