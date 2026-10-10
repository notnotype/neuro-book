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
