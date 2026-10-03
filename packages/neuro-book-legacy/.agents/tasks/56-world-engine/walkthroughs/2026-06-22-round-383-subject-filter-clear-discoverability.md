# Round 383: Subject Filter 清空入口可发现性

## 背景

Round 382 真实浏览器验收后留下一个作者流 P1：进入 subject filter 后，视口内不容易看到“清空 subject 过滤”，作者会误以为其它 slice 消失。这个问题不属于模型边界，而是实际写世界时的导航恢复成本。

## 改动

- 在 `WorldEngineWorkbenchPreviewSliceList.vue` 顶部 scope 区域增加 `清空过滤` 按钮。
- 按钮仅在 `selectedSubjectIds.length > 0` 时显示。
- 单 subject 过滤和多 subject 过滤都使用同一个入口。
- 点击后继续沿用既有 `clearSubjectFilter` 事件，不改变过滤语义或真实 API 查询契约。
- 保留下方 `当前筛选` chip 区的 `整体世界` 入口；顶部按钮只是提高可发现性。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 结果：2 files / 9 tests passed。
- 真实浏览器验收，Project：`workspace/ming-ding-zhi-shi-2`。
  - 打开主 IDE `/?project=workspace%2Fming-ding-zhi-shi-2`。
  - 打开 World Engine Workbench：通过。
  - 点击 `眼镜长发女生` 的 `只看` 进入 subject filter：通过，顶部显示 `单 subject：眼镜长发女生`，旁边出现 `清空过滤`。
  - 点击顶部 `清空过滤`：通过，按钮消失，左侧显示 `无筛选`，中间列表回到整体世界视角；kind 计数恢复 `全部 4 / init 1 / event 3`。
  - 页面中的 `1 / 4` 是当前选中切片在整体可见列表里的位置，不是只剩 1 条。

## 与计划的出入

- 本轮没有新增复杂测试，只补静态契约和一次真实浏览器 smoke。
- 没有写入或删除真实 Project 数据。
- `bun run typecheck` 未重复执行；当前已知会被无关 `server/agent/tools/control-tools.test.ts` 类型漂移阻塞。

## 下一步建议

- 继续围绕“作者真实写世界的下一处卡点”做浏览器验收，不再扩大畸形输入测试。
- 原生 `window.confirm` 的取消分支仍需一次人工可见浏览器补验。
