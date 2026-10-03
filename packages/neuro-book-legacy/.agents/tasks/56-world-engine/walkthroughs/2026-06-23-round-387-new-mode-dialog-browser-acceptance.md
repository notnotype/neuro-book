# Round 387 - New Mode Dialog Browser Acceptance

## Context

Round 386 把 `WorldEngineMutationEditor.vue` 内部“切换到新建模式”的草稿确认从原生 `window.confirm` 迁到应用内 `useDialog()`。本轮只补真实浏览器验收，不继续扩代码。

## Scope

- 验收目标：主 IDE Workbench 中，编辑已有 slice 后形成未保存草稿，点击 `新建模式`，再点击应用内确认的 `取消`。
- 不覆盖：写入 / 删除 / state query / proposal 全流程回归。
- 不写数据库：本轮只修改会话草稿，没有点击保存。

## Browser Acceptance

- 启动：
  - `bunx nuxt dev --port 3001`
  - 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`

- 步骤：
  1. 打开顶部 `World` 入口，进入主 IDE World Engine Workbench。
  2. 使用当前选中的真实 `[验收]` slice，点击 `编辑 Slice`。
  3. Composer 进入编辑模式，页面显示 `当前将整块替换 slice：19bda0a2-833e-432e-b158-a3e5572ac6cc`。
  4. 将 title 改为 `[验收草稿-新建模式取消] Round 387`。
  5. 页面出现 `当前有未保存草稿`。
  6. 点击 Composer Header 的 `新建模式`。
  7. 页面出现应用内 Dialog：
     - title：`Slice Composer 草稿未保存`
     - message：`当前编辑器有未保存草稿，确定切换到新建模式吗？`
     - buttons：`取消` / `确定`
  8. 点击 `取消`。

- 结果：
  - Dialog 关闭。
  - `world-slice-composer` 仍存在。
  - title 仍为 `[验收草稿-新建模式取消] Round 387`。
  - `当前有未保存草稿` 仍可见。
  - `当前将整块替换 slice` 仍可见，说明没有切换到新建模式。

## Verification

- 真实浏览器验收通过。
- 临时 dev server 已关闭，确认 `3001` 端口无监听。
- 本轮没有新增测试；Round 386 已用 `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 钉住静态契约。

## Actual vs Plan

- 计划：只补验 Round 386 的浏览器证据。
- 实际：按计划完成；没有改代码，没有写入 Project SQLite。

## Follow-up

- Workbench 仍可继续补验：
  - Workbench 关闭草稿确认取消分支。
  - 打开 `events.jsonl / state.md` 前草稿确认取消分支。
  - 删除 slice 应用内确认取消分支。
- 独立 `/world-engine.preview` 删除 slice 仍保留原生 `window.confirm`；是否迁移应单独决策。
