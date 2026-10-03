# Round 119 - Template Demo Contract

## Context

本轮继续在未获浏览器验收授权前推进可验证的收尾项。代码和文档已经收敛到无 `old`、无后端 re-settle、以 E/A `issues` 和不可恢复 `deleteSlice` 作为第一版反馈 / 回退边界；剩余风险之一是默认 Project Workspace 模板是否真的能承载独立 Preview 的一键示例世界。

审查点：

- `assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema.yaml` 是否包含示例世界需要的 `world.events`、`location.events`、`character.location`、`character.inventory`、`character.events`、`item.name`、`item.durability`、`item.events`。
- `server/workspace-files/workspace-files.test.ts` 中 Project Workspace 初始化测试是否仍断言旧 DTO，例如 `mergedIntoExistingSlice` 或数组式 `queryState`。
- 新建 Project 后，模板 schema/calendar、Project SQLite 初始化、subject 创建、示例 slice 写入和 state 查询是否可以在无浏览器环境下串起来。

## Changes

- `server/workspace-files/workspace-files.test.ts`：把 Project Workspace 初始化测试里的 World Engine 断言对齐当前新 DTO。
  - `createSubject` 断言 `{subjectId, issues: []}`。
  - `queryState` 断言 `{subjects, issues}`。
  - 用默认模板创建 `world`、`capital`、`erina`、`old-sword`，写入与独立 Preview 一键示例世界同款的 slice。
  - 查询 `erina`、`old-sword`、`world`，确认默认值、ref、collection、list 和 `add` reduce 后状态正确，且 `issues: []`。
- `README.md` 与 `PROJECT-STATUS.md`：记录 round-119，说明默认 Project 模板已通过无浏览器版一键示例世界链路测试。

## Verification

- `bunx vitest run server/workspace-files/workspace-files.test.ts -t "创建 Project Workspace 时会写入 manifest"`：通过，1 file / 1 test passed / 75 skipped。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，7 files / 71 tests。
- `bun run typecheck`：通过。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮仍没有获得用户明确授权。

获得授权后仍需从用户视角覆盖：

- 独立 Preview：新建 Project、示例世界、写 / 编辑 / 删除 slice、查询 state、观察 action issues 与 State Query issues。
- 主 IDE Workbench：从当前 Project 打开工作台，重复写 / 编辑 / 删除 / 查询链路，确认 Timeline badge、Selected Slice 检查器和 issues 展示。

## Notes

这轮主要补“默认模板是否能跑起来”的契约测试，不改变核心数据模型、HTTP DTO 或前端交互。它把浏览器前的一条关键链路钉住：新建 Project 默认就具备可用的 World Engine schema/calendar，并且示例世界写入不会因为模板缺属性而产生 E issue。
