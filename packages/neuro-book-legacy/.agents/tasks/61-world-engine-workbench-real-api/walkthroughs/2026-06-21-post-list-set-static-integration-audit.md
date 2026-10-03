# 2026-06-21 Post List Set Static Integration Audit

## Summary

Round 205 补齐 `list` / `collection set` 整组替换契约后，本轮没有继续改业务代码，而是按作者路径对账当前任务状态：确认 round 198 暴露的 P0/P1 问题已经分别由 round 199-203 和 round 205 收口，随后做主 Workbench / Preview 的静态接线审查与窄前端契约测试。

## Findings

- 主 Workbench 的 Slice Composer 打开时默认仍是新建模式；只有点击编辑器内的“载入所选 Slice”才会进入整块编辑当前 slice。
- `usedTimes` 已从真实 timeline 传给 `WorldEngineMutationEditor`，连续新建 slice 会使用 `suggestNextPreviewTime()` 避免默认撞同 instant。
- Preview 和主 Workbench 都接入了同 instant 错误的人话 UI 行动提示、可见编辑/删除按钮、写入后刷新与 issue 展示的静态契约。
- `op-behavior-matrix.md` 未出现在当前 `docs/` / `reference/` 文件树中；当前可对账的是既有 task 文档和源码。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files passed, 28 tests passed.

## Remaining Evidence Gap

- 未自动执行浏览器验证；项目规则要求浏览器验收必须由用户明确允许。
- 下一步若获准，建议实跑主 Workbench 与独立 Preview：打开 `ming-ding-zhi-shi-2`、新建 / 编辑 / 删除 2-3 个 slice、创建或同步 subject、确认 State Snapshot / State Query / issues 展示随操作刷新。
