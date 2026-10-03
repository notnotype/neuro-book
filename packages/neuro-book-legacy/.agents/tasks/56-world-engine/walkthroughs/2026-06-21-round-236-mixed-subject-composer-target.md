# Round 236: mixed subject 过滤下新建 Slice 优先使用已注册主体

继续沿“作者在真实 Workbench 中选择 subject 后马上新建 Slice”的路径检查。Round 235 已把空状态按视角区分；进一步看 mixed subject 过滤时，会出现一个细小但容易卡人的情况：如果当前过滤里同时有已注册 World Engine subject 和“待接入”的主体系统 subject，`focusedSubjectId` 可能落在待接入 subject 上。此时空状态会提供“新建 Slice”，但点击后会先提示“主体尚未接入”，即使过滤里已经有可写入的已注册 subject。

本轮只调整 Slice Composer 的默认目标选择：focused subject 已注册时仍优先使用它；focused subject 未接入但当前选中列表里有已注册 subject 时，回落到最后一个已注册 subject。这样 mixed 视角不会把作者挡在“新建 Slice”入口前。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `selectedRegisteredSubjectIds`。
  - `sliceComposerRequestedSubjectId` 改为：
    - focused subject 已注册：使用 focused subject。
    - focused subject 未接入、但 selected subjects 中有已注册 subject：使用最后一个已注册 subject。
    - 没有任何已注册 selected subject：保留原待接入 subject 提示路径。
  - 不改变 subject 过滤、timeline 查询、主体系统同步或后端 API。
- `world-engine-ide-entry.test.ts`
  - 更新静态契约断言，锁住 mixed pending / registered subject 下 Composer 目标回落规则。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续修真实作者路径里的下一处小卡点。实际改动没有引入自动同步，也没有改变 pending subject 的写入限制；只是让 mixed subject 视角下的“新建 Slice”优先落到已注册主体，避免可写入口被未接入焦点挡住。
