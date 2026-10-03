# Round 385 - App Dialog Draft Confirm

## 背景

Round 384 发现：主 IDE World Engine Workbench 的原生 `window.confirm` 取消分支在 in-app browser 自动化中无法可靠 dismiss，导致草稿保护无法形成稳定浏览器证据。项目里已经有 `useDialog()`，用于替代浏览器原生 alert / confirm / prompt。

## 本轮目标

- 把 World Engine Workbench 里会丢状态的原生确认迁到应用内 Dialog。
- 优先覆盖作者最常见、最容易误关丢稿的路径：Slice Composer 有未保存草稿时点击关闭。
- 用真实 `ming-ding-zhi-shi-2` 浏览器验收取消分支。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 引入 `useDialog()`，使用 `confirmDialog` 替代原生 `window.confirm`。
  - `deleteSelectedSlice()` 删除确认改为应用内 Dialog。
  - `closeSliceComposer()` 草稿确认改为应用内 Dialog，并改为 async。
  - `requestWorkbenchClose()` Workbench 关闭草稿确认改为应用内 Dialog，并改为 async。
  - `openWorkspacePathFromWorkbench()` 打开工作区文件前的放弃草稿确认改为应用内 Dialog，并改为 async。
  - 模板事件统一用 `void ...()` 调用 async 入口，避免事件处理器返回值参与 Vue 模板状态。
- `world-engine-ide-entry.test.ts`
  - 更新静态契约断言：确认使用 `useDialog()` / `confirmDialog`，关闭与打开文件入口是 async，并保留 Round 384 新增关闭按钮 test id / aria-label。

## 验证

- 静态测试：
  - `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 3 tests passed。
- 真实浏览器：
  - 启动 `bunx nuxt dev --port 3001`。
  - 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
  - 打开 World Engine Workbench，等待真实数据同步。
  - 点击 `新建 Slice` 打开 Slice Composer。
  - 在 title 中用真实键盘输入 ` [验收草稿-应用内取消] Round 385`。
  - 页面出现 `当前有未保存草稿`。
  - 点击 `关闭 Slice Composer` 后出现应用内 Dialog：
    - 标题：`Slice Composer 草稿未保存`
    - 内容：`当前 Slice Composer 有未保存草稿，确定关闭吗？`
  - 点击 `取消` 后：
    - Dialog 消失。
    - `world-slice-composer` 仍存在。
    - title 仍为 `新的世界切面 [验收草稿-应用内取消] Round 385`。
    - `当前有未保存草稿` 提示仍存在。

## 与计划出入

- 原计划：继续补原生 confirm 的取消分支证据。
- 实际调整：改成应用内 Dialog 后再验收取消分支。这样更符合项目已有 `useDialog()` 方向，也让后续浏览器自动化可稳定定位按钮。
- 本轮只验证了最关键的取消保留草稿路径；确认放弃路径未作为必要验收项，因为它不写数据库，只丢弃当前会话草稿。

## 后续

- 如果继续收敛确认体验，可以把 `WorldEngineMutationEditor.vue` 内部“切换到新建模式”的原生 `window.confirm` 也迁到应用内 Dialog。
- 后续真实作者流验收可继续覆盖：
  - Workbench 关闭时取消保留 Composer 草稿。
  - 打开 `events.jsonl / state.md` 前取消保留草稿。
  - 删除 slice 的应用内确认取消分支。
