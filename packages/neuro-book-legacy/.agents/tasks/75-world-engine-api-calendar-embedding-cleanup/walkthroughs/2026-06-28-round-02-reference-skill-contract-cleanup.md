# Round 02：Reference / Skill 文档契约补漏

## 背景

Round 01 后运行时 API、EmbeddingText 初始化、默认 Calendar 模板已经收口，但审查发现当前 reference 与 bundled skills 仍有可照抄的旧示例：

- 时间字符串仍出现 `星辉历...` / `春之月...`，与默认 Gregorian `calendar.ts` 不一致。
- 默认 schema 语境下 `/events` 仍有裸字符串 value。
- 部分首写 subject 示例缺少 `type`。
- `schema-system.md` 仍保留过期说法，暗示 Agent 只能改时间重写，不能用当前 `world.slice.editPatches` 修已有切面。
- `world.search.text` 示例把 `types` 当成 event / slice kind。

## 用户决策

- 当前主示例统一使用公历：`公元2020年4月12日 18:00`。
- 默认 `/events` 示例统一按 `EmbeddingText` 写 `{text:"..."}`。
- 本轮只修文档，不新增 docs lint、静态契约测试或运行时兼容逻辑。

## 本轮修改

- `reference/world-engine/*`：统一主示例时间到公历分钟级；修正 `search.text` 示例为 `attrs:["events"]`；补充 `types` 是 subject type 过滤。
- `reference/world-engine/schema-system.md`：把简化 schema 示例里的 `events` / `memory` 改为 `EmbeddingText`，并把 patch value 改为 `{text:"..."}`。
- `reference/world-engine/recording-principles.md`：补齐首写 `type` / `name`，统一公历时间和 `EmbeddingText` events 载荷。
- `assets/workspace/.nbook/agent/skills/novel-workflow-*`：初始化、剧情推进、章节写作、writer 执行说明均改为公历示例，避免继续引导 `星辉历` / `春之月`。
- `docs/tasks/56-world-engine/agent-tools.md`：推荐脚本改为公历示例，并说明 `search.types` / `search.attrs` 的区别。

## 验证

手动 grep 当前协议面：

- `星辉历`：无命中。
- `春之月`：无命中。
- `types: ["event"]`：无命中。
- 过期的“Agent 不能编辑已有切面”说法：无命中。
- 默认 schema 语境下 `/events` 裸字符串 value：无命中。

本轮按用户决策没有新增自动测试。运行时代码未改。
