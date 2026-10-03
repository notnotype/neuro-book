# Round 215 - Workbench Snapshot Query Issues

## 背景

继续沿着“作者真实使用世界引擎会在哪里卡住”的方向检查主 IDE Workbench。当前后端/API 已经把 `queryState` 与 `getWorldState` 收敛为 `{subjects, issues}`，但主 Workbench 的 State Snapshot 如果只展示 `subjects`，作者在查看选中 slice 状态时会看不到 reduce 读时显形的 E issue。

## 本轮调整

- 主 Workbench 保存 `state/query` 返回的 `issues`，并把触及主体 snapshot issues 传给右侧 Inspector。
- Inspector 展开完整世界状态时，也接收 `GET /state?at=...` 返回的 `issues`。
- Inspector State Snapshot 顶部新增轻量 issues 列表，raw JSON 也包含 `{at, scope, issues, subjects}`，避免 issues 被只读 JSON 入口吞掉。
- State issue 行把 code 列调整为 112px，并给 code 加 `title`，避免 `broken-relative` / `dangling-ref` 这类较长 code 在窄列里溢出。
- `app/utils/world-engine-ide-entry.test.ts` 增加静态契约断言，固定主 Workbench 到 Inspector 的 `snapshotIssues` / `fullSnapshotIssues` 接线和 `snapshot-query-issues` 展示入口。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 个测试文件通过。
  - 3 个测试通过。
- `bun run typecheck`
  - 通过。

本轮未自动执行浏览器验证；如要确认视觉呈现，需要用户明确允许后再打开主 IDE Workbench 实跑。

## 后续

- 继续围绕 `ming-ding-zhi-shi-2` 跑作者路径时，应重点观察 State Snapshot 顶部 issue 列表是否足够可扫读。
- 如果真实作者需要从 issue 直接定位到对应 slice/mutation，再讨论 Inspector issue 行的跳转交互；本轮只补可见性，不扩大交互范围。
