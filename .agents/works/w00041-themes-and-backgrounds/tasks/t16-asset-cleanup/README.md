---
schema: nbook.task/v2
taskId: t16-asset-cleanup
status: done
updated: 2026-11-06
---

# 清理没人引用的主题素材

## 目标与范围

经 Files 的删除清理 `user://theme-assets/` 里没人引用的素材：编辑器操作条里的“清理素材”，先统计、用户确认后只删统计里的名单。合同：[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 22、验收 22；[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“主题编辑器”一段。计划：[plan.md](plan.md)（两段设计审查与实现审查后的口径以 Spec 为准：`names` 里格式不合格的名字是 400，格式合格但已经不是候选的记进 `skipped`；保护期是 30 分钟，用服务端内存里的“最近返回”表，不用 `utimes`）。

## 决定

- 2026-11-06 开发者：做。设计审查（Opus）改了几处：`keep` 取记录原始 JSON 里全部素材文件名（不合格条目引用的素材也保留）；真删带 `names` 且服务端逐项重新核对；保护期用内存表不改文件时间；`expected` 只是目录项身份令牌，“改过就不删”靠互斥内的重新核对；`keep`、`names` 上限 8192、请求体 1 MiB。

## 完成情况

- 后端：`files/backend/theme-asset-common.ts`（目录名、源类型、`ThemeAssetGuard` 互斥与最近返回表）、`theme-asset-sweep.ts`（`POST /theme-assets/sweep`）、上传路由接入互斥与最近返回；统计上限 8192 并标 `truncated`；只有 ENOENT、ENOTDIR 算不存在，别的读错误 500 `io-error`；真删每项前再核对素材目录。
- 前端：`ThemeEditor.vue` 操作条的“清理素材”与确认行（统计、确认、结果、失败；焦点落在“取消”；切主题或分区清掉）、`theme-editor-model.ts` 的 `canClean`、`unusedAssets`、`removeUnused`、`trackAssetWork`、`assets.ts` 的 `referencedAssetNames`（原始 JSON 里找素材名）、`asset-upload.ts` 的 `sweepAssets`；记录损坏或版本不兼容时拒绝。
- 测试：路由合同测试 `theme-asset-route.test.ts`（真实 Files、真实磁盘：统计、真删、保护期不看 utimes、先后与同时的并发、统计上限、权限、目录换成链接、删除结果各种形状、互斥队列）；`theme-editor.test.ts`（真实路由与真实 Storage：不合格条目、两窗口并集、损坏与版本不兼容、响应形状、失败计数）；`theme-editor.e2e` 清理用例。变异检查十余个（不记最近返回、不看 mtime、不核对 keep、不互斥、keep 只取合格条目或只取一边、canClean 只看 ready、不复核目录、错误当不存在、统计不设上限），都会失败。
- 验证：`files` 与 `workbench` 单测 773 通过；`theme-editor.e2e` 全文件 18 通过；治理检查无失败；类型检查通过（`agent/backend/permissions/bash-dialect.ts`、`agent/web/permission-page.dom.test.ts` 的错误是别的会话在 master 上的既有问题）。
- 实现审查：后端 omp（重要 4、建议 1），前端 Sonnet（阻断 1、重要 4、建议 4），[后端报告](evidences/impl-review-backend.txt)、[前端报告](evidences/impl-review-frontend.txt)、[处理](evidences/impl-review-disposition.txt)：阻断那条（记录损坏时清单为空会把全部旧素材当成没人用）与别的 12 条已改，保护期受系统时钟跳变影响一条接受取舍。设计审查证据在 [t13 的 evidences](../t13-scene-provider-title/evidences/)。
- 提交：合入 `a3b086492`、`206696342`；Spec `9e75c1dac`、`b9c3c3fd3`。

## 下一步

无。已知窄窗口（写进 Spec）：同时在另一个窗口导入超过 30 分钟的大包、进程重启后保护退回文件修改时间、校时向前拨过 30 分钟，都可能让刚写的素材被当成旧素材。
