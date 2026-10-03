# Round 422 - Task 64/65 Calendar Docs Sync

## 背景

用户提醒 `docs/tasks/64-world-engine-prompt-engineering` 与 `docs/tasks/65-world-engine-calendar-enhancement` 需要按最新 Calendar 路线对齐。当前代码和前端入口已经硬切到 `world-engine/calendar.ts`，但 Task 64/65 的部分任务说明仍停留在 `calendar.yaml` 扩展或向后兼容设计。

## 实际变更

- 重写 Task 65 README：
  - 明确 `world-engine/calendar.ts` 是唯一稳定入口。
  - 记录 simple / gregorian / custom 三类 Calendar 策略。
  - 标注 `calendar.yaml` 兼容 / fallback 只属于历史设计演化，不再作为当前契约。
- 更新 Task 65 implementation progress：
  - 去掉 `calendar.yaml 继续可用` 和 loader 优先级表述。
  - 改为硬切 `calendar.ts`，Project 模板 / skill / 前端入口均已对齐。
- 更新 Task 65 design-v2：
  - 顶部加过时说明。
  - 将向后兼容段标为旧设想，说明当前已废弃。
- 更新 Task 64：
  - README 的 Calendar reference 描述改为 `calendar.ts` 契约。
  - 默认模板检查项改为 `world-engine/schema.yaml` + `world-engine/calendar.ts`。
  - 初始化需求文档改为 simple / gregorian / custom 策略引导。
  - 用户场景测试中的初始化示例改为写 `world-engine/calendar.ts`。
  - 旧 skill 名 `novel-workflow-04-world-engine-init` 改为当前 `novel-workflow-world-engine-init`。

## 验证

- `rg` 核查 Task 64/65：
  - 不再存在 `calendar.yaml 继续可用`、`当前 calendar.yaml 仍可用`、`保留 calendar.yaml 的项目不受影响`、`先用现有 calendar.yaml`、`novel-workflow-04-world-engine-init` 等当前误导句。
  - 剩余 `calendar.yaml` 只出现在“历史需求来源 / 已废弃旧设想 / 已下线”的语境中。

## 与计划出入

- 本轮只改文档，不改前端或后端代码。
- 没有运行单元测试；变更范围是 Markdown 任务文档，验证以定向 `rg` 文案核查为主。
