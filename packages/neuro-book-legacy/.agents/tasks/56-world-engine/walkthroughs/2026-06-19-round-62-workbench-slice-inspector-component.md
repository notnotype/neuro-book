# Round 62 - Workbench Selected Slice Inspector 组件拆分

## 目标

继续降低主 IDE World Engine Workbench 的单文件体量，把右侧 Inspector 中已经稳定的 Selected Slice 检查区抽成独立组件，避免后续继续加查询、编辑和诊断动作时主 Dialog 重新膨胀。

## 计划

1. 读取 `WorldEngineWorkbenchDialog.vue` 的 selected slice 区域，确认父子边界。
2. 新增 `WorldEngineSliceInspector.vue`，只负责展示 selected slice 与触发事件。
3. 父组件保留选择、查询和 API 请求逻辑，通过 props / emits 连接子组件。
4. 更新 IDE 入口契约测试与任务文档。
5. 运行相关测试和类型检查。

## 实现

- 新增 `app/components/novel-ide/world-engine/WorldEngineSliceInspector.vue`：
  - 接收 `selectedSlice`、`selectedSubjectId`、`actionBusy`。
  - 内部计算 selected slice 触及的 subject chip。
  - 保留“查询此时状态”“查询切面主体”按钮。
  - 保留 mutation 摘要列表和原始 mutations JSON 预览。
  - 通过 `select-subject`、`query-at-slice`、`query-slice-subjects` emit 交回父组件处理。
- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 引入 `WorldEngineSliceInspector`。
  - 移除 selected slice 展示相关的 inline 模板。
  - 移除只服务该模板的 `selectedSliceSubjectIds`、`selectedSliceJson`、`formatMutationValue`。
  - 父组件继续持有查询、选择 subject、API 请求和 state tab 切换逻辑。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加读取 `WorldEngineSliceInspector.vue`。
  - 父组件断言组件接入和事件方法。
  - 子组件断言 selected slice chip、查询按钮和事件名。

## 验证

```powershell
bun run typecheck
```

结果：通过。

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

第一次结果：15 个测试中 1 个失败。原因是拆分后测试仍在父组件中查找“查询此时状态”“查询切面主体”文案。

修正契约测试边界后重跑：

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

## 实际结果与计划出入

- 实际实现符合计划，没有调整用户可见交互。
- 测试阶段发现契约断言还绑定在父组件文案上，已改为父组件查事件方法、子组件查文案和事件名。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- `WorldEngineWorkbenchDialog.vue` 从 683 行降到 614 行。
- 新增 `WorldEngineSliceInspector.vue` 55 行。
- API、数据库、Agent 工具和 Preview 行为未变。

## 后续

- 可以继续拆分右侧 Resettle 面板或 Timeline 列表，但下一步更重要的是在用户确认后做一次主 IDE Workbench 浏览器实跑：从新建 Project 到示例世界、写 slice、编辑旧 slice、显式 re-settle、查询状态。
