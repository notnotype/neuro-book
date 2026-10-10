---
schema: nbook.task/v2
taskId: t75-bookshelf
---

# 书架页

## 目标与范围

开发者 2026-10-10 要求重新设计没打开项目时的书架页，更贴合 NeuroBook 的产品与风格，可以不沿用旧应用的封面网格。

方向与取舍见提案 [书架页](../../../../../docs/proposals/bookshelf.md)（`reviewing`）。推荐“书房”：上半是继续写作，下半是书脊书架，另有列表视图。

后续步骤：

1. 开发者选定方向；
2. 在 Lab 做静态稿，开发者看过后定稿；
3. 写 Spec 与实施计划：`nbook.projects` 增加新建、修改作品信息、从书架移除与统计缓存，新增书架页面。

行为合同：现有 [`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 将增加新建、修改作品信息、移除登记，书架页另建 Spec，方向选定后起草。

## 前置

[t73](../t73-lab-nb-ui-and-storage/README.md)；项目切换与 [t74](../t74-workbench-titlebar/README.md) 共用作品列表。

## 当前状态

- 2026-10-10 建立；提案起草，开发者同意全部推荐（书房方向、作品目录、今天与总字数、不做封面图），交 omp 审查后实施。
- 2026-10-10 实施计划起草（[plan.md](plan.md)），逐条回答 P10–P14、F06、F07；待 t74 之后交 omp 计划审查。
- 2026-10-10 S1 Lab 静态稿完成（提案要求先出静态稿给开发者看）：
  - 组件在 `packages/neuro-book/src/plugins/projects/web/components/`：`BookshelfPage`、`ContinueCard`、`SpineShelf`、`BookSpine`、`ShelfTitlePage`、`ShelfList`，各带同名 `.md`；只呈现数据、发出动作，接真实数据在 S4。
  - 显示规则 `web/shelf-format.ts`：字数写法（一万以上写“万字”）、今天净增（可为负）、相对时间、书脊厚度（按字数对数插值，30 到 64px）、书脊高度四档与色档（色相从主题强调色起每档转 45°）、排序、继续写作选最近编辑的那部。
  - Lab 场景：书架页 9 个（书脊与列表、一部、没有写作记录、空书架、加载、出错、英文），其余五个组件各 3 到 4 个；固定数据在 `lab/web/fixtures/shelf-fixture-data.ts`。
  - 截图（`lab:shot`，1180×980 与 390×844、明暗两种配色，全部没有溢出与页面问题）：[书脊明](evidences/s1-spines-light.png)、[书脊暗](evidences/s1-spines-dark.png)、[英文](evidences/s1-english-light.png)、[空书架](evidences/s1-empty-light.png)、[手机列表](evidences/s1-list-phone-light.png)、[手机暗色](evidences/s1-phone-dark.png)。本机没有装 nbook 主题的宋体（Source Han Serif、Noto Serif SC），截图里的书名与片段落到了黑体。
  - 验证：typecheck；`shelf-format.test.ts` 10 例、`SpineShelf.dom.test.ts` 4 例、Lab 索引与场景测试；变异 3 个全杀（Home 键、厚度上限、负数今天）。
  - 外观意见按 [待开发者确认](../../pending-confirmations.md) 的做法不阻塞后续切片。
- 2026-10-10 计划审查：omp 审查 18 条（阻断 2 条：统计写入与条件保存不相容、握手加书名破坏协议），[报告](evidences/plan-review.txt)；修订后交 fable 子代理复核，7 条必须先改与 6 条建议，[报告](evidences/plan-rereview.txt)。全部写进 [plan.md](plan.md) 的“计划审查的处理”。新增书架页 Spec 草稿 [`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)（`planned`）；5 条产品取舍登记在 [待开发者确认](../../pending-confirmations.md)。
