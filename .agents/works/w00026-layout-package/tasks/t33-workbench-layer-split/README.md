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

## 下一步

开 worktree `w00026-t33-workbench-split`（分支 `refactor/w00026-t33-workbench-split`），做第 1 片。
