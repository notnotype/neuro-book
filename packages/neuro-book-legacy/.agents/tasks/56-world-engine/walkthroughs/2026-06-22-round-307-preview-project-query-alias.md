# Round 307 - Preview Project Query Alias

## 背景

继续按作者真实路径检查时，发现独立 `/world-engine.preview` 只识别 `?projectPath=workspace/...`。主 IDE 的通用 Project 路由参数是 `?project=workspace/...`，Preview 的 schema/calendar 深链也会生成 `/?project=<projectPath>&openPath=...`。

如果作者按主 IDE URL 习惯手动打开：

```text
/world-engine.preview?project=workspace/ming-ding-zhi-shi-2
```

旧逻辑会忽略 `project`，然后回退到 Project 列表第一项，容易在真实验收时选错 Project。

## 实际变更

- `app/pages/world-engine.preview.vue`
  - `loadProjects()` 读取 route project 时先看 `projectPath`，没有时回退到 `project`。
  - 旧入口 `/world-engine.preview?projectPath=...` 不变。
  - 新兼容 `/world-engine.preview?project=...`。

- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 保留 `route.query.project` fallback。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

通过。

## 与计划出入

- 本轮没有修改后端、API 或 Project 路由规范。
- 本轮没有自动浏览器验证，符合当前约定。
