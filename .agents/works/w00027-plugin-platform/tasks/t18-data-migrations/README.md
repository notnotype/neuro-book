---
schema: nbook.task/v2
taskId: t18-data-migrations
status: planned
updated: 2026-11-15
---

# 统一的数据版本迁移（应用与插件）

## 目标与范围

应用与插件升级时，旧格式的数据要么迁移成新格式，要么按记录废弃，并且有一份统一的迁移记录；做法参照 Prisma Migrate 一类的“有序迁移步骤 + 已执行记录 + 启动时统一执行”。来源：开发者 2026-11-15 在 w00046 t11 问“migrate 是否像 Prisma 那样成体系、插件能不能用、能不能有统一的版本迁移脚本记录”。

**搁置**：开发者 2026-11-15 定，先建 Task，要用的时候再开。开工时先写提案（改公开接口与数据格式），由开发者定范围。

合同：开工时定。会涉及 [`storage/persistence`](../../../../../docs/specs/storage/persistence.md)（现在明确把“记录格式的迁移函数”列为不承诺）、[`state/store`](../../../../../docs/specs/state/store.md)，以及插件 SDK 的 `defineRecord`。

## 现状（2026-11-15 只读调研）

没有统一的迁移机制，各类数据各管各的版本号：

| 数据 | 版本不对时 |
|---|---|
| 插件存储记录（`defineRecord` 的 `version`） | 读出 `unsupported-version`，普通保存为 `protected`，只能 `reset` 覆盖（原件进原件区）；persistence Spec 不承诺迁移函数 |
| 每个分区的存储库（SQLite，库格式版本 1） | 不认识的格式为 `io-error`，不改写 |
| `projects.json`、作品的 `.nbook/project.json` | `schema: 1`，没有升级路径 |
| Agent 会话日志（format 1，nb-harness） | `needs-migration`，Spec 说“先跑迁移脚本”，但脚本还没有 |
| nb-memory 索引 | 版本变了删表重建（派生数据） |
| 旧应用的数据 | 不迁移 |

插件没有“从 X 版升到 Y 版”的钩子；插件降级只提示数据风险。

## 开工时的初步方向（未经设计审查）

- 每个数据所有者（宿主各项、每个插件）声明有序的迁移步骤，包括“废弃旧数据”一类的步骤；
- 状态根里一份迁移账本：所有者、步骤、执行时的应用或插件版本、时间、结果；
- 应用或插件版本变化后的启动、打开作品时，在服务端就绪之前执行；先备份，失败就停下并报告；
- `defineRecord` 加 `migrate`，代替现在只能 `reset` 的路径；
- 桌面更新的“上一版到本次”冒烟（w00046 t11 的 `upgrade-from-previous`）可以顺带验迁移。

## 当前状态

2026-11-15 经 nbdev 新建；搁置，未开工。

## 下一步

开发者决定开工时：写提案，按 implementation-planning 出计划。
