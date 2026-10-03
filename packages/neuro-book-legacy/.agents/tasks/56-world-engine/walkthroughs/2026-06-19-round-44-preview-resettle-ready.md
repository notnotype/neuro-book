# Round 44 - Preview resettle 提交条件

## 背景

本轮继续审查 Preview 的 re-settle 交互。后端和 service 层已经要求 `resettleTimeline.subjectIds` 非空，但 `/world-engine.preview` 的按钮只看 Project 是否就绪和 action 是否 busy：

- `from` 为空时仍可点击，点击后才报错。
- `subjectIds` 为空或只有逗号 / 空白时仍可点击，点击后才会请求失败。

这会让 Preview 看起来像允许提交一个不完整的显式重结算动作。

## 本轮计划

1. 把 Preview re-settle 的可提交条件抽到 util，便于单测覆盖。
2. 按 `from` 非空、`subjectIds` CSV 解析后非空来禁用按钮。
3. 保留提交函数内部的错误提示，避免绕过按钮状态时静默失败。

## 实现

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `canSubmitResettle(from, subjectIds)`。
  - 复用既有 CSV 解析规则判断 `subjectIds` 是否有效。
- 更新 `app/pages/world-engine.preview.vue`：
  - 新增 `resettleReady` computed。
  - re-settle 按钮在 `from` 或 `subjectIds` 不完整时禁用。
  - `resettleTimeline()` 开头补充 `from` 空值提示。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖完整表单可提交。
  - 覆盖空 `from` 不可提交。
  - 覆盖空白 / 逗号组成的 `subjectIds` 不可提交。
- 更新文档：
  - `README.md` 记录第四十四轮进展。
  - `sqlite-and-api.md` 修正仍停留在早期草案的同 instant / re-settle 契约。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 个测试文件通过。
  - 10 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 53 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮除 Preview 提交条件外，还顺手修正了任务文档里仍停留在早期草案的关键契约：同 instant 不再是多个切面排序或默认合并，第一版也已经包含显式 re-settle。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 浏览器验证仍待用户确认后执行。
- 正式主 IDE UI 仍需后续设计，Preview 只作为调试入口。
