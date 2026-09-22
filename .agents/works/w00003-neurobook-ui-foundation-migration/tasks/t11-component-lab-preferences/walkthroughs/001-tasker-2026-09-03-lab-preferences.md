---
schema: nbook.walkthrough/v1
taskId: t11-component-lab-preferences
sequence: 1
role: tasker
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t11 Component Lab 界面偏好持久化

## 实际改动

- 新增版本化 localStorage 文档 `nb-lab:preferences:v1`，只保存主题、配色、桌面背景、画布背景、缩放、画布宽高与桌面侧栏开合。
- 存储解析把 localStorage 当作不可信输入：schema 必须为 `1`，枚举必须仍在当前登记表中，画布尺寸必须是 `0..16384` 的整数；字段独立校验，损坏值不拖垮其它有效字段。
- 新增 `useLabPreferences` 持有恢复、保存、重置与 hydration 时序；内部 `getStorage()` 捕获 `window.localStorage` getter 的 `SecurityError`，使不可用存储按空存储处理，默认启动、重置和保存 watcher 都不被阻断。
- 移动端自动收起只修改当前侧栏状态，不写入桌面侧栏偏好。用户点击侧栏按钮时才更新持久偏好。
- 顶栏新增“恢复 Lab 默认配置”图标按钮。它清除小型偏好并恢复当前默认主题与画布设置；自定义壁纸 Blob 仍由原有“清除”按钮单独删除。
- 恢复到 `custom` 桌面但 IndexedDB 壁纸不存在时回退默认桌面，不自动弹出文件选择器。IndexedDB 读取失败不阻止 localStorage 小型偏好恢复。
- fixture 数据、当前组件/场景、搜索、检查器 tab、选中元素与事件日志继续保持非持久状态。

## 已验证

- `bun run test app/component-lab/lab-preferences-store.test.ts`：4 tests passed。
- `bun run test app/component-lab/use-lab-preferences.test.ts`：3 tests passed，包含 localStorage accessor 抛出 `SecurityError` 时 restore/reset/save watcher 均不阻断。
- `bun run test app/component-lab`：3 个测试文件、9 tests passed。
- `bun run typecheck`：通过。
- `bun run scripts:typecheck`：通过。

## 真实浏览器验证

- 命令：`bun run smoke:component-lab -- --url http://127.0.0.1:3000 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`。
- 结果：`Component Lab smoke passed: http://127.0.0.1:3000/`。
- 真实流程修改为 macOS 主题与手机 `390 × 844` 画布，刷新后两项均恢复；离开 Lab 后根主题属性被清理，再次进入仍恢复偏好；点击“恢复 Lab 默认配置”后主题回到 `nbook` 且 `localStorage.getItem("nb-lab:preferences:v1") === null`。
- 首次超时根因不是偏好存储，而是公共 `Tree` 把 string id 直接传给需要节点对象的 Reka `TreeRoot`，初始行缺少 `data-selected`。修正公共 string-id 适配后，同一 smoke 完整通过，没有放宽选择器。

## 残余风险

- 未取得开发者单独授权，未进行人工视觉验收、截图对比或逐项键盘走查。
- nb-ui 全量 E2E 仍有 17 项既有失败；Tree 专项 E2E 与真实 NeuroBook smoke 均通过。
