# Round 46 - Preview Project 搜索过滤

## 背景

Round 45 的用户视角浏览器实跑发现一个真实体验问题：`/world-engine.preview` 顶部 Project 下拉会显示所有 Project。连续测试后，列表里积累了大量 `world-engine-test-*` 和浏览器试用 Project，用户要找到当前目标 Project 会变得很费劲。

这不是后端 bug，但会直接影响 World Engine 调试台的可用性。

## 本轮计划

1. 给 Preview 顶部 Project 选择区增加搜索输入。
2. 搜索按 `title` / `projectPath` / `summary` 匹配。
3. 搜索词不匹配当前选中项时，仍保留当前选中项，避免 select 显示成空值。
4. 补 util 单测。

## 实现

- 更新 `app/utils/world-engine-preview.ts`：
  - 新增 `WorldPreviewProject` 类型。
  - 新增 `filterPreviewProjects(projects, query)`。
  - 新增 `keepSelectedPreviewProject(projects, selectedProject)`。
- 更新 `app/pages/world-engine.preview.vue`：
  - 顶部 Project 区增加 `搜索 Project` 输入框。
  - Project 下拉改为展示 `projectOptions`。
  - 搜索没有命中时显示 `没有匹配的 Project`。
- 更新 `app/utils/world-engine-preview.test.ts`：
  - 覆盖按标题、路径、摘要过滤。
  - 覆盖搜索过滤后仍保留当前选中 Project。

## 验证

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 个测试文件通过。
  - 12 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 55 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划只优化 Preview 的 Project 选择体验，没有改动后端 API / Agent 工具 / World Engine 数据模型。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮改动由 util 单测与 typecheck 覆盖。

## 后续

- 如果 Preview 继续积累大量测试 Project，可以考虑增加“仅显示 World Engine 相关 Project”或测试 Project 清理入口。
- 正式主 IDE UI 仍需单独设计，Preview 不作为最终产品交互。
