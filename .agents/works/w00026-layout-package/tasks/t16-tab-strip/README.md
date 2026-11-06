---
schema: nbook.task/v2
taskId: t16-tab-strip
status: done
updated: 2026-11-06
---

# 统一标签条

## 目标与范围

nb-layout 提供一个标签条，工具面板和编辑组共用：语义、方向键、改顺序、多行与让位都只写一份，固定、未保存标记走插槽与分区。提案第 5 节的形状。排在 t07 之后、t08 之前。提案写的工作台发起的两阶段关闭（requestClose）这里不做，理由见计划。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、21；[workbench.editor](../../../../../docs/specs/workbench/editor.md) 输出 53 到 59。计划见 [`plan.md`](plan.md)。

## 当前状态

计划第二稿已按设计审查修订。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，18 条：重要 10、建议 8）的处理：

| 条 | 处理 |
|---|---|
| F01 核心里读 DOM | 成立。几何放 `src/vue/` |
| F02 插入判定丢信息 | 成立。返回邻居的键，下标、分区、原位由宿主按文档换算 |
| F03 标题动作的悬停 | 成立。用表面现成的 `data-hover-actions-scope` |
| F04 头高不过渡 | 成立一半。`placementMoved` 不算 inset；外框过渡中又折行时内容带着过渡，接受，很少见 |
| F05 `max-height` 的数 | 成立，改 56 |
| F06 标记两处都写 | 成立。比报告建议更简单：`data-editor-group` 只留在内容根，头写 `data-editor-group-head` |
| F07 没有 `attrs` | 成立，加 |
| F08 文件拖放的高亮 | 成立，量外框 |
| F09 外观靠变量不够 | 成立。列公开钩子，宿主 `:deep` |
| F10 键盘停靠点 | 成立。`stripIndexes` 取代 `stripCount` |
| F11 `returnFocus` | 成立 |
| F12 不做 `requestClose` 的理由写错 | 成立，改写；文档同步 |
| F13 测量层渲染插槽 | 成立。adapt 只用缺省内容，不和插槽一起用 |
| F14 复制 adapt 逻辑 | 成立。抽 `useTabsAdapt` 共用 |
| F15 工具面板的标签条矩形 | 成立，整个面板头不变 |
| F16 对 t17 的影响 | 成立。`layoutContents` 现在就按头高写；分层留给 t17 的计划 |
| F17 Spec 与样式遗漏 | 成立，补；“开发者说过没有问题”没有出处，改成推断并记入待确认清单 |
| F18 与提案的差别 | 成立，写明 |

已合入。`TabStrip` 在 nb-layout，工具面板（`adapt`）与编辑组（分区、多行）共用；插入判定 `resolveTabStripInsertion` 返回邻居，工作台按文档换算；`useTabsAdapt` 从 nb-ui `Tabs` 抽出来共用。编辑组的头（`EditorGroupHead`）搬到外框，内容按实测头高从它下面开始。`data-editor-group` 只在内容根，头写 `data-editor-group-head`。e2e 选择器由一个 Sonnet 迁移，主会话审 diff。

和计划不一样的地方：`TabStrip` 进了 SDK 的组件清单（`sdk.test.ts` 要求入口里的单文件组件逐个对上）。“更多”的图标由宿主给（`moreIconClass`）：应用的 Tailwind 不扫 nb-layout 的源码，库里写图标类不生效。

验证：类型检查只剩别的 Work 的（`plugins/agent` 的 `permission-page.dom.test.ts`、`nb-agent-ui`、`nb-story` 的 `qa-service`）；`test:affected --since master` 在 dev-panel、nb-agent-ui、nb-form、nb-layout、nb-markdown、nb-story、nb-ui、neuro-book 上只有已知的 `plugins/agent` 跨插件导入；e2e `lab-tab-strip`、`editor-area`、`workbench-views`、`workbench-dnd`、`editor-types`、`editor-code-settings`、`lab-editor`、`files-explorer`、`markdown-editing`、`markdown-input`、`themes`、`workbench-titlebar`、`bookshelf-stats`、`welcome`、`theme-editor` 全过；`scripts/perf` 改了选择器，只过了类型检查，没跑。

实现审查后台进行中，报告回来后处理。

## 下一步

[t17](../t17-per-tab-instance/README.md)。

从 t07 片 7b 审查留下的：关掉多行（`wrapTabs` 为假）且标签条横向滚动时，键盘拖动把滚出视口的标签也算成落点，停靠点落到标签条外面（工具面板的标签条只数看得见的，编辑组没有）。换成统一标签条时一起解决。
