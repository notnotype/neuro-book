# Round 52 - Workbench 创建 subject 与 dirty guard

## 背景

Round 51 已把 mutation 写入 / 编辑器迁入主 IDE World Engine Workbench，但从“新建 Project 后直接在主 IDE 里跑完整例子”的角度看仍缺两块：

- 创建 subject 还要依赖 Preview 或一键示例世界。
- Mutation Editor 载入其他 slice / 切换 subject 时，存在覆盖未保存草稿的风险。

本轮补齐这两个主 IDE 内工作流缺口。

## 本轮计划

1. 新增 Workbench 内置 subject 创建入口。
2. 创建成功后刷新 Workbench、选中新 subject，并切到 Edit tab 方便继续写 slice。
3. Mutation Editor 增加 dirty guard，避免未保存草稿被自动覆盖。
4. 更新契约测试、运行 typecheck，并同步任务文档。

## 实现

- 新增 `app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue`：
  - 根据当前 schema 展示 subject type 下拉和 attr 预览。
  - 使用 `/api/projects/world-engine/subjects` 创建 subject。
  - 创建成功后把 `WorldSubjectDto` 回传给 Workbench。
- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 左侧 subject 栏顶部接入 `WorldEngineSubjectCreator`。
  - 新增 `handleSubjectCreated()`，创建成功后 `loadWorld()`、选中新 subject，并切到 `Edit` tab。
- 更新 `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：
  - 增加 `cleanSnapshot` / `hasDirtyDraft`。
  - 当编辑器有未保存草稿时，外部触发“载入所选 slice”不会直接覆盖表单，而是提示“放弃草稿并载入”。
  - selected subject 变化时，如果当前新建模式下有未保存草稿，也会保留现有 mutations。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 Subject Creator、subject API、dirty guard 和“放弃草稿并载入”提示。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`
  - 2 个测试文件通过。
  - 14 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 代码审查自检

- Workbench 主组件 562 行，Mutation Editor 385 行，Subject Creator 105 行，仍未出现 800 行以上大型单文件组件。
- 新增代码未使用 `any` / `unknown`。
- 创建 subject 入口仍走后端 `createSubject`，初始化默认值和同 instant 初始化特例都继续由 service 处理。
- dirty guard 不使用浏览器 confirm；在 UI 内显示明确按钮，避免误触发覆盖。

## 与计划的出入

按计划补齐了 subject 创建和 dirty guard。没有在本轮做字段级结构化 mutation 表单；当前仍是 Builder + JSON textarea 的折中形态，适合先保证主 IDE 闭环。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。本轮由契约测试和 typecheck 覆盖。

## 后续

- 后续用户确认后，应在浏览器里从主 IDE Header 打开 Workbench，新建 Project 后依次创建 subject、写新 slice、编辑旧 slice、执行 re-settle。
- 继续评估字段级表单和模板化 mutation，降低 JSON textarea 的使用成本。
