# Round 200：同 instant 冲突提示改成 UI 行动

## 背景

Round 198 的 P0 真实驾驶测试发现：当作者写入一个已存在 instant 时，后端错误会提示“请使用 `edit_world_slice` 合并”。这对 Agent / API 调用方是准确的，但 Preview / Workbench 用户看到的实际操作是 Timeline 的“载入编辑”和表单里的“保存 Slice 编辑”，工具名会把作者从写作流拽回 API 心智。

本轮只修前端展示，不改后端契约，不改 `op-behavior-matrix.md`，不新增输入校验。

## 变更

- `app/utils/world-engine-preview.ts`
  - 新增 `formatWorldEngineConflictMessage(message)`。
  - 当错误消息包含 `existingSliceId=` 时，把后端 / Agent 向提示翻译成 UI 可执行动作：
    - 在 Timeline 中找到该时间的 slice。
    - 点击“载入编辑”合并本次变更。
    - 或把 time 改到相邻时间。
  - 保留后端返回的 `existingSliceId / time / title` 细节，方便定位目标 slice。

- `app/pages/world-engine.preview.vue`
  - 一键示例世界、创建 subject、写入 / 编辑 slice 的错误出口接入冲突消息翻译。

- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - 主 Workbench 写入 / 编辑 slice 的错误出口接入同一翻译。

- `app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue`
  - 主 Workbench 创建 subject 的错误出口接入同一翻译。

- `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`
  - 主 Workbench 一键示例世界错误出口接入同一翻译。

- `app/utils/world-engine-preview.test.ts`
  - 补纯函数测试，确认 `edit_world_slice` 不再出现在 UI 消息中，并保留 `existingSliceId`。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 Preview、主 Workbench Mutation Editor、Subject Creator 都接入该翻译函数。

## 验证

已通过：

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件通过，20 条测试通过。

已通过：

```powershell
bun run typecheck
```

结果：`nuxt typecheck` 通过。

## 与计划出入

- 原计划只修独立 Preview 的同 instant 文案。实现时把同一纯函数接到了主 Workbench 的写入 / 创建 subject 错误出口，因为两个真实入口共享同一后端错误，且改动很小。
- 没有做浏览器自动验收。按项目约束，浏览器验证需要用户明确允许。

## 后续

P1 剩余真实驾驶问题：

- Project 列表污染 / 加载慢。
- Timeline 编辑 / 删除图标发现性不足。
- 若用户允许，可复跑浏览器真实链路，确认 round-199 和 round-200 的交互实际可见。
