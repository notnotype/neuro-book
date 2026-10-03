# Round 51 - Workbench mutation 写入 / 编辑器

## 背景

Round 50 已经把主 IDE Header 入口升级为内嵌 World Engine Workbench，能浏览 subjects / timeline / schema，能查询 selected subject 状态，也能做一键示例世界和显式 re-settle。

但它还缺少正式编辑能力：真正写入新 slice 或编辑已有 slice 仍要回到 `/world-engine.preview`。本轮把 Preview 中已经验证过的 Mutation Builder / `writeSlice` / `editSlice` 能力迁入 Workbench。

## 本轮计划

1. 不继续膨胀 `WorldEngineWorkbenchDialog.vue`，新增独立 mutation editor 子组件。
2. 抽出 Workbench 共享 DTO，避免组件间重复定义。
3. Workbench 增加 `Edit` tab，timeline 每个 slice 可直接载入编辑。
4. 编辑器复用 preview util 的 mutation JSON 校验、schema attr 默认值、op 推导和时间推导。
5. 补契约测试、运行 typecheck，并更新任务文档。

## 实现

- 新增 `app/components/novel-ide/world-engine/world-engine-workbench.types.ts`：
  - 抽出 `WorldSchemaProjectionDto`、`WorldSubjectDto`、`WorldSliceDto`、`WorldSliceMutationDto`、`SubjectStateDto`、`SliceWriteResultDto`、`ResettleResultDto`。
- 新增 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 支持新建 slice。
  - 支持载入 selected slice 后走 `/api/projects/world-engine/slices/:sliceId/edit` 整块替换。
  - 内置 Mutation Builder，按 selected subject / schema attr 推导 op 和默认 value。
  - 支持 schema shortcuts，一键把某个 attr 填成合法 mutation draft。
  - 写入前使用 `parseMutationJson()` 校验 textarea JSON，避免把明显非法结构打到 API。
- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 增加 `Edit` tab。
  - timeline slice 卡片增加编辑按钮。
  - 接入 `WorldEngineMutationEditor` 的保存结果。
  - 写入结果如果 `needsResettle`，自动填充右侧 re-settle 表单并提示实际重算范围。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 契约覆盖 Workbench 内置 editor、Mutation Builder、`writeSlice` / `editSlice` API 入口。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 个测试文件通过。
  - 14 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 代码审查自检

- Workbench 主组件 544 行，Mutation Editor 334 行，没有把正式工作台堆成 800 行以上的大型单文件组件。
- 新增组件未使用 `any` / `unknown`。组件内展示用 JSON 类型保持浅层，完整 mutation JSON 校验继续复用 preview util 和后端 service。
- 未改 `NovelIdeTab`、store 持久化或左侧 sidebar 状态，UI 影响面仍限定在 Header 打开的 workbench dialog。
- 本轮仍保留 `/world-engine.preview`，作为调试页和对照路径。

## 与计划的出入

按计划完成了 Workbench 内置 mutation 写入 / 编辑器。与 Preview 相比，本轮没有迁入“创建 subject”表单，也没有做字段级的完全结构化编辑器；当前仍保留 JSON textarea + Builder 的混合形态。这样先把真实写入链路接进主 IDE，再逐步打磨输入体验。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮由契约测试和 typecheck 覆盖。

## 后续

- 在 Workbench 里补创建 subject 入口，减少跳转 Preview 的需求。
- 为 mutation editor 增加 dirty guard，避免切换 slice 时覆盖正在编辑的草稿。
- 后续用户确认后，在浏览器里从主 IDE Header 打开 Workbench，新建 Project 后跑示例世界、写新 slice、编辑旧 slice、执行 re-settle。
