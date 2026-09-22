---
schema: nbook.task/v2
taskId: t32-storage-archive
---

# Storage 归档与单条记录一致性

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片 2。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md) 的物理落点与备份。
主 Agent 切换 Tasker，独占 `workspace-archive.ts` 及同名测试、`server/backup/backup-archive-{rules,service}` 及其测试、
必要的 `yazl.d.ts` 类型声明。不编辑 t30 的 Storage/Project 生命周期文件或 t31 的文件保护/路径策略。

## 结果与范围

- Project ZIP 强制保留 `.nbook/storage` 正式记录、墓碑及原件；继续尊重普通内容忽略规则。
- 完整 data 备份保留 user 身份域与两 scope 正式数据，排除 Storage 的 `.locks` 和临时文件。
- 单个 Storage 文件在原子替换期间导出仍是完整原版或新版，不以枚举时旧 size 校验之后的新文件。
- 真实解包验证；不引入跨键快照或跨数据库/正文事务承诺。

沿用 t31 的 `projectWorkspacePathPolicy` archive preserve/ignore 分类，待它完成后联测。
仅本地系统 Temp fixture，不操作真实用户 data，不远端写入；用户已有实现授权。
测试使用既有测试文件，无需与 t30 争用 Vitest 配置。完成后交独立 Reviewer 复核三项的相互作用。
