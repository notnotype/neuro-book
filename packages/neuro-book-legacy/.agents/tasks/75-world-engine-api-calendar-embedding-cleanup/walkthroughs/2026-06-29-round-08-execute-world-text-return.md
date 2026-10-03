# Round 08：execute_world 文本摘要返回契约

## 背景

本轮接续 Task 75 的 Agent instruction surface 收口。用户指出 `execute_world` 的 CodeAct 代码已经可以返回任意对象，但实际 Agent 倾向返回低效率 JSON；当 subject schema 形状明确时，应让 Agent 主动把状态对象整理成人读文本，方便自己阅读和后续回复。

只处理工具返回文本与提示词契约，不新增 `world.schema.*` API，也不改变 CodeAct 事务、issue collector、readonly/readwrite 权限边界。

## 改动

- `server/agent/tools/world-engine-tools.ts`
  - `details` 继续保留规范化后的 `{data, issues}`。
  - 当 `data` 是字符串且 `issues=[]` 时，工具 `content[0].text` 直接展示该字符串。
  - 当 `data` 是字符串且有 issues 时，先展示字符串摘要，再追加 issues JSON，避免 advisory/error 被隐藏。
  - 对象、数组、数字、布尔返回值继续按 JSON 展示。
- `server/agent/world-engine-tool-description.ts`
  - 增加 return rules：subject schema 形状明确时，在脚本内把 JSON attrs 转成人读 `return string`；只有后续代码确实需要结构化数据时才返回 object/array。
- builtin profiles
  - `leader.default`、`world.engine`、`writer` 均补充：查询结果也应优先作为文本摘要返回，不默认回传原始 attrs JSON。
- reference / status
  - `reference/world-engine/api-migration-zod.md` 的最小示例改为 `return [...].join("\n")`。
  - `PROJECT-STATUS.md` 与本 task README 同步当前契约。

## 验证

- 更新 `server/agent/tools/world-engine-tools.test.ts`：
  - 覆盖字符串 `data` 直接成为工具文本。
  - 覆盖字符串 `data` 带 `base-shifted` advisory 时仍展示 issues。
  - 保留对象返回 JSON 展示的既有断言。
- 更新 `server/agent/profiles/world-engine-profile.test.ts`：
  - 断言 world.engine profile 注入 `return string` 与文本摘要约束。

## 与计划出入

本轮没有增加 schema 查询 API，也没有做浏览器验证。实现范围保持在工具展示、提示词、reference 与任务状态文档。
