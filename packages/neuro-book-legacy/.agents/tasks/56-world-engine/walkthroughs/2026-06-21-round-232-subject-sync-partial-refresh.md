# Round 232: 主体系统同步部分成功后刷新状态

继续沿“同步主体系统”真实路径审查。Round 230 / 231 已分别处理点击前的初始化时间可见性，以及初始化时间冲突时的 UI 行动文案。本轮继续看批量同步：当前 Workbench 会逐个调用 `POST /subjects` 接入 pending subjects，如果前几个已经成功、后面某个请求失败，旧代码会直接进入 `catch`，不会刷新已成功的 subject。作者看到的是“同步失败”，但列表仍可能把已经创建成功的 subject 显示为“待接入”，下一次再点同步会进入重复 subject 冲突。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `syncPendingSubjectSystemSubjects()` 把 `created` / `issues` 提升到 `try` 外。
  - 如果失败前没有任何成功项，保持原有错误展示。
  - 如果失败前已有成功项：
    - 选中并聚焦已成功接入的 subject。
    - 调用 `loadWorld({preferredSubjectIds: created})` 刷新 subject / timeline / 主体系统摘要。
    - 记录已成功请求返回的 transient issues。
    - 错误文案改为 `已接入 N 个主体系统 subject，但后续同步失败：...`。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 partial-success 分支仍存在。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续找主体系统同步路径里的真实卡点。实际改动只处理批量同步中途失败后的 UI 状态恢复，没有改后端事务语义，也没有把多个 `createSubject` 合成一个新 API。第一版仍接受“部分 subject 已接入、后续失败”的真实状态，只是让 Workbench 不再显示过期 pending 视图。
