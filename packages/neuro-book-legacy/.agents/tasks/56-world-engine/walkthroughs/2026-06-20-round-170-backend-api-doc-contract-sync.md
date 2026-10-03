# Round 170: 后端/API 文档契约同步

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 169 收尾后，额外巡检稳定设计文档时发现两处旧语义尾巴：

- `agent-tools.md` 仍把 `get_world_schema` 写成“是否需要”的待定问题，但工具实际已经接入。
- `worked-example.md` 仍把 `calendar.yaml` 描述成后续配置，并在 subject 初始化示例里笼统写“同 instant 已有切面就合并”，没有体现当前 `createSubject` 只会自动追加到 `kind=init` 切面的后端契约。

## 实现

- `docs/tasks/56-world-engine/agent-tools.md`
  - 将 `get_world_schema` 从待定讨论改为已接入工具。
  - 明确该工具用于让 agent 写入前查看当前项目的 subject 类型、属性、op/value 约束和默认值。

- `docs/tasks/56-world-engine/worked-example.md`
  - 将 `calendar.yaml` 描述改为当前第一版项目日历 parse/format 配置。
  - 更新示例说明：底层仍只保存真实 instant，项目日历只负责字符串与 instant 的互转。
  - 更新 `createSubject` 同 instant 初始化追加规则：只能自动追加到已有 `kind=init` 切面；如果该 instant 已有普通事件切面，调用方应使用 `editSlice` 显式合并或选择其他初始化时间。

## 验证

- 本轮只改文档，未改代码行为，未重跑测试。
- Round 169 已通过的后端/API/Agent/Profile 目标测试与 `bun run typecheck` 仍是当前最近一次代码验证基线。

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百七十轮状态。
  - 增加本 walkthrough 索引。
- `PROJECT-STATUS.md`
  - 增加 round-170 后端/API 文档补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“本次不用做前端，专注后端与 API 设计即可”的范围调整。
- 本轮没有修改数据库结构、HTTP DTO、Agent 工具 schema 或后端行为，只同步稳定设计文档中的旧描述。
