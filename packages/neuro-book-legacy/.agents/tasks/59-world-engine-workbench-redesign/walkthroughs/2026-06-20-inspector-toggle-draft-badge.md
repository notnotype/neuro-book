# 2026-06-20 Inspector Toggle Draft Badge

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮 Draft Queue 已能直达 metadata / value 草稿处理面板，但如果用户收起右侧 Inspector，顶栏 `Inspector` 按钮没有显示 metadata 草稿状态。
- 本轮在顶栏 Inspector 开关上增加 metadata draft badge，让用户即使不看右栏，也能知道有未处理的 slice metadata 草稿。

## Changes

- `world-engine.workbench-preview`
  - 新增 `metadataDraftSliceCount` computed。
  - 新增 `inspectorButtonTitle` computed。
  - 顶栏 Inspector 按钮增加 `data-testid="world-workbench-inspector-toggle"`。
  - metadata 草稿存在时，按钮显示 `meta N` badge。
  - Inspector 隐藏且存在 metadata 草稿时，按钮使用琥珀色提示态。
  - title 会提示：
    - 无草稿：`隐藏 Inspector` / `打开 Inspector`。
    - 有草稿且显示中：`隐藏 Inspector；N 个 metadata 草稿仍会保留`。
    - 有草稿且隐藏中：`打开 Inspector 处理 N 个 metadata 草稿`。
- `world-engine-workbench-preview.test.ts`
  - 补充顶栏 Inspector draft badge 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - 默认顶栏按钮显示 `Inspector`，无 `meta` badge，title 为 `隐藏 Inspector`。
  - 修改首个 slice title 生成 metadata draft。
  - 顶栏按钮显示 `Inspector meta 1`，title 为 `隐藏 Inspector；1 个 metadata 草稿仍会保留`。
  - 中间 Draft Queue 同步出现。
  - 点击 `重置 mock` 后，顶栏 badge 和 Draft Queue 都消失。
  - 浏览器日志无 warning / error。

## UI/UX Notes

- 这次补的是“隐藏面板仍能看见待处理状态”的可见性。
- `Draft Queue` 负责主画布里的草稿入口，顶栏 badge 负责全局面板状态提示，两者不冲突。
- badge 只显示 metadata draft，因为 Inspector 主要处理 slice metadata；value draft 仍主要由左侧 value subject 统计、Slice Card、Draft Queue 和 Mutation Editor 处理。
