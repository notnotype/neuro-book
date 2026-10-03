# Round 420 - Calendar.ts Frontend Entry

## 背景

Task 65 已把 World Engine Calendar 主入口推进到 `world-engine/calendar.ts`。本轮收窄为只处理前端与前后端交互层，不继续改后端 calendar 实现。

## 实际变更

- 独立 Preview 的 Schema / Calendar 路径 chip 改为打开 `world-engine/calendar.ts`。
- 独立 Preview 的配置路径 chip 从 schema 成功态移到 Project 已选中态；即使 `calendar.ts` 缺失导致 schema 加载失败，作者仍能打开 / 创建配置文件。
- 主 Workbench 左侧 Schema 区的 Calendar 路径 chip 改为打开 `world-engine/calendar.ts`。
- 主 IDE 消费 `openPath=world-engine/calendar.ts` 时，如果旧 Project 中该文件不存在，会通过现有 workspace-files create API 创建一份默认 Simple Calendar 草稿，然后打开文件。
- 创建 `world` subject / 同步主体系统时，若初始化时间不可解析，前端错误提示改为引导配置 `world-engine/calendar.ts`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 2 files / 9 tests passed。
- `rg` 核查前端 World Engine 组件、首页和相关前端测试，未发现 `calendar.yaml` 入口残留。

## 与计划出入

- 原本准备继续做浏览器验收，但用户提醒 Task 64 / 65 已更新 calendar 路线，并明确本轮只负责前端与前后端交互层；因此本轮未执行真实浏览器验收，也未改后端。
- 历史 walkthrough 中的 `calendar.yaml` 记录保留为当时事实；当前稳定入口已改为 `calendar.ts`。
