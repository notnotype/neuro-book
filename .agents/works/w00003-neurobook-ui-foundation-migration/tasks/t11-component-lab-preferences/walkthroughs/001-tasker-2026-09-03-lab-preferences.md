---
schema: nbook.walkthrough/v1
taskId: t11-component-lab-preferences
sequence: 1
role: tasker
status: blocked
createdAt: 2026-09-03T00:00:00Z
---

# t11 Component Lab 界面偏好持久化

## 实际改动

- 新增版本化 localStorage 文档 `nb-lab:preferences:v1`，只保存主题、配色、桌面背景、画布背景、缩放、画布宽高与桌面侧栏开合。
- 存储解析把 localStorage 当作不可信输入：schema 必须为 `1`，枚举必须仍在当前登记表中，画布尺寸必须是 `0..16384` 的整数；字段独立校验，损坏值不拖垮其它有效字段。
- 新增 `useLabPreferences` 持有恢复、保存、重置与 hydration 时序；`LabShell.vue` 只负责把界面 refs 接入该边界。
- 移动端自动收起只修改当前侧栏状态，不写入桌面侧栏偏好。用户点击侧栏按钮时才更新持久偏好。
- 顶栏新增“恢复 Lab 默认配置”图标按钮。它清除小型偏好并恢复当前默认主题与画布设置；自定义壁纸 Blob 仍由原有“清除”按钮单独删除。
- 恢复到 `custom` 桌面但 IndexedDB 壁纸不存在时回退默认桌面，不自动弹文件选择器。IndexedDB 读取失败不阻止 localStorage 小型偏好恢复。
- fixture 数据、当前组件/场景、搜索、检查器 tab、选中元素与事件日志继续保持非持久状态。

## 已验证

- `bun run test app/component-lab/lab-preferences-store.test.ts`：4 tests passed。
- `bun run test app/component-lab/use-lab-preferences.test.ts`：2 tests passed。
- `bun run test app/component-lab`：当前聚焦测试通过。
- `bun run typecheck`：通过（提取 composable 后首次发现并删除 `LabShell.vue` 的旧 hydration 收尾残留，随后重跑通过）。
- `bun run scripts:typecheck`：通过。

## 待验证与阻塞

- 本轮真实 smoke 命令：`bun run smoke:component-lab -- --url http://127.0.0.1:3000 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`。
- 实际结果：退出码 `1`，在 `packages/neuro-book/scripts/smoke/component-lab.ts:64` 等待 `.nb-lab-panel--nav [role='treeitem'][data-selected]` 超时 `30000ms`，因此未执行到偏好 reload/reset 断言。
在取得真实页面证据前，本 walkthrough 保持 `status: blocked`，不把功能记为浏览器验收通过。
