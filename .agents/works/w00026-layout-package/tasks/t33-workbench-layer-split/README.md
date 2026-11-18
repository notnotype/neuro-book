---
schema: nbook.task/v2
taskId: t33-workbench-layer-split
status: active
updated: 2026-11-18
---

# 拆出工作台层：新包 nb-workbench-layout

## 目标与范围

按提案第一档第 1 项与 ADR 0054：布局文档、投影、落点规则、presented-ids、夹具、TabStrip 与标签条几何搬进不发布的 nb-workbench-layout；L1 里带工作台概念的文件按提案“分层与新包”逐个处理；boundary.test 改三层规则；插件 SDK 的 Splitter 类型与 TabStrip 保留旧名作别名

合同：行为合同未变（只搬家、改依赖与导入）；实现合同与证据里的路径改到新包：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“分层与新包”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 1 条。

## 当前状态

2026-11-18 开工，计划第 1 稿见 [`plan.md`](plan.md)。

- 计划第 1 稿的设计审查（Claude Sonnet，2026-11-18，[`evidences/plan-review.txt`](evidences/plan-review.txt)）：9 条，阻断 2、重要 6、建议 1，都成立，按建议改成第 2 稿，没有新机制，不再送第二轮：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 新包的配置、开发依赖、Lab 来源、AGENTS 的根引用没列全 | 列全 |
  | 2 | SDK 打包的类型路径、组件分组、两条测试没覆盖，发布的 d.ts 会留外部引用 | 补上，搬前搬后比对 `build:sdk` 产物、零外部引用 |
  | 3 | 浮动窗矩形的类型在 L2，下沉会反向导入；公开入口只缺 `placeGrid` | L0 新增 `GridFloatRect`，`clampFloatRect` 一起下沉；只补 `placeGrid` |
  | 4 | `DropSectorsOverlay` 不用映射、`labels` 改必填是回归、换夹具丢覆盖 | 只放宽 `id`、`labels` 保持可选，真实形状的用例搬进 L2 |
  | 5 | `entryRect` 改可选去不掉概念；按词匹配的判据和现状矛盾 | 元素留 L1、注释改通用；判据限定导出名、数据属性、类型名；残留说法列清单 |
  | 6 | 导入改写漏多行、行内 `type`、`.vue` | 按 AST 与说明符改写，断言新入口有这个名字 |
  | 7 | 漏链接、依赖区段与 `bun.lock`；README 包表是多余的 | 照改，README 包表不动 |
  | 8 | e2e 漏直接受影响的文件，切片 1 没有浏览器验证 | 两片各列文件，切片 2 共 12 个，带 `NB_E2E_WIDE` |
  | 9 | 边界测试拆分前后都过，没有约束力 | 切片 1 先挪进 `src/workbench/` 并用 `excluding` 拦（先红）；L2 的边界分两层 |

- 第 1 片（worktree `w00026-t33-workbench-split`，分支 `refactor/w00026-t33-workbench-split`，`d341ba632`）：工作台层挪进 nb-layout 的 `src/workbench/`，L0、L1 不再导入它。验证：
  - nb-layout 类型检查，`bun test` 593、vitest 259 全过，`boundary.test` 先红后绿；
  - neuro-book 类型检查，工作台与编辑器单元测试 789 全过；
  - e2e 四个文件 109 条：107 过，`editor-area` 的 2171、2207 失败。单独重跑三轮，各失败两次、通过两次，负载 17 到 30。现象与 Work README 记的已知问题一样（预览停在 `source-removed`、拆组没发生）。第 1 片的运行时改动只有类型、注释与导入路径，搬到 `grid-rects.ts` 的两个函数体逐字未变，所以归负载，不另做基线对照。
- 和计划第 2 稿不同的两处（`plan.md` 已改）：
  - 浮动窗矩形用已有的 `GridRect`。设计审查第 3 条以为 L0 没有这个形状的类型，其实 `GridRect` 就是 `{x, y, width, height}`。`LayoutFloatRect` 写成它的别名。
  - TabStrip 一族第 1 片留在 `src/vue/`，第 2 片直接搬进新包。挪进 `src/workbench/vue/` 会断掉 Lab 的扫描、`TabStrip.md` 的相对链接与 `COMPONENT_EXPORT_PATTERN`，L0、L1 也没有别的文件导入它们。
- SDK 比对的判据改成“没有两个包的模块说明符”：搬前的产物里已有打包工具写的 `//#region ../nb-layout/…` 来源注释，照字面 grep 不会是零。搬前的产物在任务临时目录，比对结果随第 2 片记。
- L0、L1 注释里仍有的工作台说法（按分界判据，注释不算 L2 概念，不改；t35、t36 碰到这些文件时顺手改成通用说法）：
  - `grid-drop.ts:24` 工作台边缘并入；`grid-types.ts:51` 工作台里一列工具面板；
  - `grid-motion.ts:34` 编辑组的头、`:161` 底部面板和编辑区、`:176` 切换侧栏的容器、`:280` 视图被活动栏吸收；
  - `sortable.ts:5` 链接 `ui/workbench-layout` 输出 38、`:74` 工作台实时布局的粘滞；
  - `vue/DropSectorsOverlay.vue:21` 编辑组最窄 220px；`vue/useRenderOrder.ts:24`、`:44` 编辑组；`vue/drop-targets.ts:3` 不需要工作台在场。

- 第 2 片（同一分支，`d56c0cd61`；并 master `5fc79e1ab`；变更记录 `9ec5cc0fc`）：新包 `packages/nb-workbench-layout`，搬家、应用 44 个文件改导入、SDK 与登记。
  - 并 master 时 `sdk/components.ts` 冲突：master 的 `88043837e` 给 SDK 组件清单补了 `SortableList`，合并后 `SortableList` 仍从 nb-layout 出，`TabStrip` 从新包出。合并后改写脚本 dry run 为 0 个文件，没有新的导入要改。
  - 合并后验证：两个包与应用的类型检查都过；nb-layout `bun test` 334、vitest 213，nb-workbench-layout `bun test` 261、vitest 46，`sdk.test` 4 条，全过（合并前 `sdk.test` 的 2 条失败是 master 上原有的，`88043837e` 已修）；`docs:check` 过。
  - SDK：搬前、搬后各跑一次 `build:sdk`，入口 d.ts 的导出名逐个相同，`components.d.ts` 只有属性先后不同；产物里没有两个包的模块说明符。比对在合并之前，合并只多了 nb-layout 的 `SortableList`。
  - 合并前应用单元测试的三处失败与本片无关：`pack.test` 4 条在负载 47 到 50 时 60 秒超时（放宽超时的副本 13 条全过）；`package-io` 的上限用例 master 上同样失败；`auto-save` 输出 63 重跑即过。
  - Spec 的三处实现路径（`ui/workbench-layout` 的 151、364、365 行）随代码在分支上改：文件一搬，旧链接就断，`docs:check` 会失败；master 上这份与分支起点相同，合入不会盖掉新内容。
  - 根 `AGENTS.md` 的仓库结构里先不加新包这一行：主工作区的这个文件有别的会话没提交的改动，这次不暂存它，留到它提交之后再补。
  - e2e：12 个文件 226 条，带 `NB_E2E_WIDE`，跑到第 96 条时撞上 90 分钟上限。Lab 的 7 个文件几乎全部失败，失败都在打开页面后 15 秒内等不到 Lab 就绪：截图停在宿主的加载条，trace 里 Vite 的模块请求在打开后 54 秒才轮到 Lab。当时负载 24 到 39，可用内存 2 GB，别的会话的 eval 内核、开发服务与截图都在跑。过了就绪的用例全部通过，没有一条是行为断言失败。`workbench-containers` 19 条过 18 条（1276 失败），`workbench-dnd`、`workbench-live-drag`、`workbench-shell`、`workbench-views` 没轮到。负载 25 时单独重跑 `lab-drop-sectors` 与 `lab-tab-strip`：过 2 条（TabStrip 的键盘与多行），其余 4 条照样卡在就绪。

## 下一步

1. 负载降下来以后，重跑 Lab 的 7 个文件、没轮到的 4 个文件与 `workbench-containers:1276`，再用 nbdev 起开发服务（不用 4217）看 `lab?c=TabStrip`。
2. 第 3 片：两个 Spec 的实现合同与证据（在 master，合入之后），nb-layout 的 README、AGENTS 与 `grid.md`，“布局文档”一节搬进新包的文档。
3. 实现审查（Claude Sonnet，不阻塞）、合入 master。
