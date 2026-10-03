# Round 424 - Main Workbench Empty Project Browser Smoke

## 背景

Round 423 已确认默认 Project 模板在 `calendar.ts` 路线下的 HTTP API 最短链路可用。本轮按“快速收尾”只做主 IDE Workbench 的极窄真实浏览器验收：作者打开空 Project 后，是否能看到第一步入口，并能显式创建 `world` subject。

## 验证范围

1. 启动本地 dev server。
2. 新建临时 Project：`workspace/world-engine-round-424-ui-smoke`。
3. 打开主 IDE：`/?project=workspace%2Fworld-engine-round-424-ui-smoke`。
4. 点击顶栏 `World` 打开主 Workbench。
5. 确认 Workbench 中可见：
   - `world-engine/schema.yaml`
   - `world-engine/calendar.ts`
   - `创建 world subject`
   - `创建 Subject`
   - `新建 Slice`
6. 点击 `创建 world subject`。
7. 用 HTTP API 确认 subject 与 init slice 已真实创建。
8. 关闭浏览器标签，删除临时 Project，关闭 dev server。

## 实际结果

- 主 IDE 能打开临时 Project，顶栏显示 `World Engine Round 424 UI Smoke`。
- 顶栏 `World` 能打开 `World Engine Workbench`。
- 空 Project Workbench 显示 schema / calendar 配置入口，均指向当前 `calendar.ts` 路线。
- 空状态中显示 `创建 world subject`、`创建 Subject` 和 `新建 Slice`。
- 点击 `创建 world subject` 后，界面提示 `已创建 world subject`，并出现一条 `init` slice。
- API 复核：
  - `GET /subjects` 返回 `world / world / 世界`。
  - `GET /slices` 返回一条 `kind=init`、标题为 `创建 世界` 的 slice，时间为 `新生纪元1年1月1日 00:00:00`。
- 临时 Project 已通过删除 API 删除。
- dev server 已关闭，`3001` 无监听。

## 与计划出入

- 本轮没有写入 event slice，也没有覆盖编辑 / 删除 / State Query；这些路径已在 Round 413 / 415 / 423 覆盖过，本轮只确认“空 Project 第一脚不会卡住”。
- 没有修改前端或后端代码。
- 浏览器里第一次读取 `document.body.innerText` 返回空字符串，但 DOM 实际已完整渲染；后续直接读取 `#__nuxt` 与按钮列表后正常完成验收。
