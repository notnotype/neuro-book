# Round 03：工具 description 与运行时 profile 审查修复

## 背景

用户要求在上一轮文档契约收口后继续审查，重点看相关工具的 description，并忽略无关 git 变更。审查发现 reference / bundled skills 的主流程基本已迁移，但仍有两个直接喂给 Agent 的入口存在残留风险：

- `server/agent/world-engine-tool-description.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`

## 修复内容

1. `execute_world` 工具 description 补充 advisory issue 处理规则：
   - `severity="error"` 仍要求 throw / rollback。
   - `severity="advisory"` 不自动回滚，但 Agent 需要用 `title/message/explanation` 给用户做简短确认或后续提醒。

2. `execute_world` 工具 description 补充 `world.search.text` 参数语义：
   - `types` 过滤 subject type，例如 `character` / `location`。
   - `types` 不是事件文本或 slice kind。
   - 搜索事件文本应使用 `attrs: ["events"]`。

3. builtin `leader.default` profile 修正 World Engine 高频要点：
   - 时间示例从旧奇幻历法 `星辉历312年 5月15日 14:00` 改为默认公历 `公元2020年4月12日 18:00`。
   - 保留“以当前项目 calendar.ts 为准”的提醒，避免 Agent 照抄不匹配的时间字符串。
   - issues 说明从旧的 E/A code 分类改为按 `severity` 处理，并要求优先使用返回的 `title/message/explanation` 面向用户解释。

## 验证

- 手动检查 `server/agent/world-engine-tool-description.ts`：
  - 写入规则已包含 advisory 处理。
  - search rules 已明确 `types` / `attrs` 区别。
- 手动检查 `leader.default.profile.tsx`：
  - 旧 `星辉历` 示例已移除。
  - 旧 `E issues / A issues` 主说法已替换为 severity 主导。

## 与原计划出入

本轮不是新增 API 或 runtime 行为，只修复 Agent 实际可见的协议文案入口。没有新增自动测试；仍符合用户此前确认的“本轮只修文档 / 提示词契约，不加 docs lint”的范围。
