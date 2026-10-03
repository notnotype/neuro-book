# Round 423 - Calendar.ts Default Template API Smoke

## 背景

Task 65 已硬切 `world-engine/calendar.ts`，Round 420-422 已完成前端入口与文档同步。本轮做一个不扩大范围的真实 API 烟测：确认新建 Project 的默认模板在 `calendar.ts` 路线下仍能完成 World Engine 最短链路。

## 验证范围

本轮不是浏览器验收，只验证默认模板 + HTTP API：

1. 新建临时 Project。
2. 读取模板自带 `world-engine/calendar.ts`。
3. 读取 World Engine schema。
4. 使用默认 `calendar.ts` 的时间格式创建 `world` / `player` subject。
5. 写入一条 event slice。
6. 查询 `world` / `player` state。
7. 删除该 slice，再查询状态回退。
8. 删除临时 Project，关闭 dev server。

## 实际结果

- 临时 Project：`workspace/world-engine-round-423-api-smoke`。
- `world-engine/calendar.ts` 存在，内容包含 `type: 'simple'` 与 `{eraName}{year}年{month}月{day}日` format。
- 使用时间：
  - `新生纪元1年1月1日 00:00:00`
  - `新生纪元1年1月1日 00:00:01`
- `createSubject(world)` issues：0。
- `createSubject(player)` issues：0。
- 写入 slice issues：0。
- `state/query` issues：0。
- 查询结果包含：
  - `world.events` 的 `临时主角迈出第一步。`
  - `player.events` 的 `我迈出第一步。`
  - `player.hp = 99`
- 删除 slice 返回 issues：0。
- 删除后再次查询：
  - 临时事件已移除。
  - `player.hp` 回到 100。
- 临时 Project 已删除，`/api/projects` 不再返回该 Project。
- dev server 已关闭，`3001` 无监听。

## 与计划出入

- 本轮只做 API 烟测，没有执行浏览器验收；目的是先确认 Task 65 硬切后默认模板底层链路健康，避免直接跑更重的浏览器流程时把问题混在一起。
- 没有修改前端或后端代码。
