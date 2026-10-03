# Round 425 - Stage Closeout Audit

## 背景

本轮不继续加功能，也不继续扩大边界测试。目标是把 Round 380-424 已经完成的真实浏览器 / API / 文档证据按作者路径收束，判断当前 World Engine 前后端拼接阶段是否可以收尾。

原始阶段目标：

1. 创建项目，以 `ming-ding-zhi-shi-2` 为例设置 subject schema / calendar。
2. 推演几步 slice。
3. 覆盖常用用户操作。
4. 避免过度测试，只验证最常用、最复杂、最容易犯错的路径。

## 完成审计矩阵

| 要求 | 证据 | 结论 |
| --- | --- | --- |
| 真实项目参考配置可读 | Round 371 / 372 只读预检 `ming-ding-zhi-shi-2`：确认 `world-engine/schema.yaml`、当前 `world-engine/calendar.ts`、`simulation/subjects/player` 六文件和 Project SQLite 当前状态可读，读时 issues 为 0。 | 已满足。真实项目作为参考样本存在且健康。 |
| 新 Project 可进入 World Engine 配置路径 | Round 416 / 417 修复并验收新建 Project 后 URL 同步和刷新；Round 420 / 421 把 schema / calendar 入口收敛到 `world-engine/calendar.ts`，旧 Project 缺文件时会创建默认草稿再打开。 | 已满足。作者从新 Project 进入配置文件不再卡在旧 `calendar.yaml` 或旧链接。 |
| 默认模板可直接使用 World Engine | Round 411 / 412 让默认模板 `character` schema 声明主体系统映射字段，并用浏览器验收同步内置 `player` 后 state 含六文件路径 / RAG source / 计数且 issues 为空。Round 423 用 API 验证默认 `calendar.ts` 下 create subject、write slice、state query、delete slice 与状态回退。 | 已满足。默认模板不再需要手写 schema 才能跑通主路径。 |
| 空 Project 第一脚可发现 | Round 407 / 408 增加并验收显式 `world` subject bootstrap；Round 424 再用空临时 Project 验收 Workbench 可见 schema/calendar、`创建 world subject`、`创建 Subject`、`新建 Slice`，点击后真实创建 `world` subject 和 init slice。 | 已满足。作者第一步不会自然撞到 `subject 不存在：world`。 |
| 能连续推演几步 slice | Round 380 在真实 `ming-ding-zhi-shi-2` 写入三条 `[验收]` 主线 slice；Round 406 用临时 Project 连续写两条 player-only event slice；Round 413 用默认模板临时 Project 写入 `world.events` / `player.events` 并使用 `写入并继续下一步`。 | 已满足。真实项目和新 Project 路线都已覆盖连续推演。 |
| 常用操作：创建 subject | Round 405 / 412 / 413 覆盖主体系统同步与 init attrs；Round 424 覆盖空 Project 创建 `world`。 | 已满足。 |
| 常用操作：写入 / 编辑 / 删除 slice | Round 380 覆盖真实项目写入、metadata 编辑和删除专用 slice；Round 413 覆盖默认模板写入、删除、编辑和最终 State Query 对账；Round 423 API 覆盖删除后状态回退。 | 已满足。 |
| 常用操作：查询 state / issues | Round 380 / 406 / 413 覆盖 State Snapshot；Round 423 API 明确 state/query issues 为 0；后端 / API / Agent 的 E/A issue 语义在 Round 375 目标测试中通过。 | 已满足。 |
| 常用操作：主体文件建议 | Round 380 暴露 proposal 直达问题；Round 381-402 修复并验收 `files N`、Inspector proposal、复制 / 打开、验收标签清理、人称修正、`events.jsonl` commit 会话态；Round 403 用临时 Project 验收真实 `events.jsonl` commit 的 `appended` / `already-exists`。 | 当前阶段已满足。`memory.jsonl` / `state.md` 自动 commit 未接入，仍是后续产品决策，不阻塞 World Engine 主路径。 |
| 常用操作：确认 / 草稿保护 | Round 385-388 把关键原生确认迁到应用内 Dialog，并用真实浏览器验收关闭 Workbench、关闭 Composer、切新建模式、打开文件、删除 slice 的取消分支。 | 已满足。 |
| 常用操作：Project 删除 / 旧链接恢复 | Round 404 / 409 / 414 修复 Project 删除时 World Engine client / Windows 句柄问题，改为 deleted marker 兜底；Round 415 / 417 验收删除后列表隐藏、新建刷新保持、旧链接返回稳定 404；Round 418 / 419 验收旧链接 fallback 与 `openPath` 丢弃。 | 已满足。 |
| Calendar 新路线一致 | Round 420-423 与 Task 64 / 65 文档同步确认 `calendar.ts` 是唯一当前入口，默认模板和前端入口都走 `calendar.ts`。 | 已满足。 |

## 阶段结论

World Engine 的“前后端雏形拼接 + 作者视角主路径”当前可以阶段收尾：

- 作者能从新 Project 打开主 IDE Workbench。
- 作者能看到并打开 schema / calendar 当前真相源。
- 作者能创建 `world` 和同步 / 创建角色 subject。
- 作者能连续写入 slice、编辑、删除、查询状态。
- 作者能看到 E/A issues 与主体文件建议。
- 作者能通过应用内确认保护草稿和删除动作。
- 临时 Project 清理和旧链接恢复不再阻断验收流程。

## 剩余事项

这些不是本阶段阻塞项，建议进入后续体验打磨或新任务：

- `memory.jsonl` / `state.md` 是否也做显式 commit，需要单独产品决策。
- `ming-ding-zhi-shi-2` 的真实 `[验收]` slice 是否清理，由用户决定；不要直接改 Project SQLite。
- World Engine 与未来 RP 模式 / simulation workflow 的关系仍需后续重新设计。
- 如果继续打磨前端，应优先看作者是否能自然理解“World Engine state”和“主体六文件建议”的边界，而不是继续增加输入守卫。

## 与计划出入

- 没有新增代码。
- 没有重新跑大测试；本轮只基于既有真实浏览器、API、目标测试证据做收尾审计。
- 没有再次启动浏览器；Round 424 已确认最后一个空 Project 第一脚，继续重复浏览器验收收益很低。
