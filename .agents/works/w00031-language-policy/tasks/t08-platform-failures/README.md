---
schema: nbook.task/v2
taskId: t08-platform-failures
status: planned
updated: 2026-11-10
---

# 设置、存储、项目与插件平台的失败投影

## 目标与范围

各码表补全并用共用件兜底；存储 14 个码；entryReason 合一；插件页 entry-failed 原文进详情；开放域的存在性查询（t03 计划矩阵 M3、M6、M14）

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

t03 留下的（2026-11-10）：

- `projects/web/failure-text.ts` 的 `failureReason` 对不认识的码仍照原样显示并拼服务端说明（`码：detail`）：书架上的这些提示（`shelf-page.ts`、`browse.ts`）还没有“详情”可放。t03 只把路由码改成宿主文案；改成宿主的未知码文案、原文进详情归本 Task。
- 插件页加载失败（`PluginsPage.vue` 的 `refresh`）把原因和服务端详情用“ · ”拼成一行；`problem.reason` 存的是字符串，切换语言后不跟着变。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

待补充。
