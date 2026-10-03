# 2026-06-22 Round 313 - Preview Project Switch Busy Guard

## 背景

上一轮已让独立 `/world-engine.preview` 的 World State 面板在请求飞行中禁用刷新、subject 选择、载入编辑和删除 slice。

继续沿作者真实操作路径检查后，发现页面顶部 Project 选择器和刷新 Project 列表按钮仍可在 `actionBusy` 时使用。写入 / 编辑 / 删除请求飞行中切换 Project，会触发 `selectedProjectPath` watcher 重置 Preview 会话状态并重新加载世界，造成当前操作上下文被提前切走。

## 变更

- 顶部 Project `<select>` 在 `loadingProjects || actionBusy` 时禁用。
- 顶部刷新按钮在 `loadingProjects || actionBusy` 时禁用。
- 新增 `refreshProjects()` 作为用户点击刷新入口；请求飞行中直接返回。
- 保留 `loadProjects()` 的内部调用能力，因为新建 Project 成功后需要在 `actionBusy` 期间调用它来选中新 Project。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

结果：通过，1 个测试文件、3 条测试。

## 与计划出入

- 本轮没有自动执行浏览器验收，符合当前约束。
- 本轮没有运行全量 typecheck；只对改动入口跑窄静态契约测试，避免过度测试。
