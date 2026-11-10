---
schema: nbook.task/v2
taskId: t24-view-containers
status: active
updated: 2026-11-09
---

# 视图容器：活动栏、右栏、底部面板的一个图标是一整个容器

## 目标与范围

开发者 2026-11-09：活动栏一个图标切换侧栏的一整块内容（例：图标一是会话加资源管理器，记住位置与展开收起），右栏、底部面板也做；容器既有插件声明的也能由用户拖出来。先写提案

合同：先写提案 [工作台的视图容器](../../../../../docs/proposals/workbench-view-containers.md)，接受后改 [workbench-layout](../../../../../docs/specs/ui/workbench-layout.md)、[views](../../../../../docs/specs/workbench/views.md) 等。

## 当前状态

开发者 2026-11-09 定：右栏、底部面板也做；容器既有插件声明的，也能由用户拖出来。2026-11-10 待定项“都先按推荐”：容器里是分节，用户拖出来的容器用第一个视图的图标，旧记录不迁移、回落默认树，右栏、底部面板的入口在各自的头上。

提案 [工作台的视图容器](../../../../../docs/proposals/workbench-view-containers.md) 已提交（`reviewing`），设计审查进行中。

## 下一步

处理设计审查；开发者接受提案后写 Spec 与 `plan.md`，再按切片实施。
