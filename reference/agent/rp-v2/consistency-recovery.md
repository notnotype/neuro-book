# RP v2 一致性、异常恢复与测试随机

本文定义 RP 长期运行的数据审计、可自动修复边界、切片损坏恢复阶梯和测试随机合同。它不赋予 Agent 修改剧情事实的额外权限。

## 1. 审计结果

最近一次报告固定写入 Project Workspace：

```text
.nbook/rp/runtime/consistency/latest.json
```

报告包含检查档位、`healthy / warning / blocked` 状态、问题列表、安全修复列表、执行时间和耗时。问题的 `repair` 只有三类：

- `none`：提示性问题，不要求自动变更。
- `automatic`：可由其他 canonical 字段唯一重建的索引或缓存。
- `player_confirmation`：可能改变剧情、角色、资源、关系、认知或正文，系统只能报告并给出选择，不能代选。

当前唯一自动修复项是切片树 `childrenIds`：它可由各节点 `parentId` 唯一重建。资源余额、关系值、角色 belief、World Engine patch、正文归属和事件结局都不能自动修复。

## 2. 三档检查

- `light`：提交前热路径。检查 store schema、回合/结算幂等集合、时间与资源基础引用、active 切片材料和 SQLite `quick_check`。
- `standard`：项目打开、长跳和时间线恢复前后。增加地图/NPC、事件/关注度、关系/认知、所有 turn/pipeline 与正文路径引用。
- `deep`：玩家手工验收和长期测试。逐个物化全部可用时间线节点，并运行 SQLite `integrity_check` 与 `foreign_key_check`。

触发规则：

- 已存在 RP intake 的项目打开后，后台运行一次 standard；普通小说项目不会因此创建 RP 文件。
- `rp_turn begin_commit` 必须通过 light，否则在 World Engine 写回前阻断。
- 长跳计划必须通过 standard。
- 时间线恢复前后各运行 standard；恢复后的问题写入状态页，不能静默忽略。
- 状态页可由玩家手工运行 light、standard 或 deep；详细报告留在项目文件，不注入聊天上下文。

## 3. 叙事与状态冲突

- 提交前的 pipeline snapshot、冲突收口、终裁和 narrative 登记不一致时，既有阶段门禁拒绝进入 world commit，应重新生成未提交叙事。
- committed turn 的正文路径与 pipeline narrative 不一致时，standard/deep 报告 `narrative.prose_mismatch`，状态页列出三种玩家选择：以 committed 正文为准修订 pipeline、以 pipeline 为准重新提交正文、回滚到提交前切片。
- 服务端不会自动选“哪一侧是真相”。任何选择都必须走对应的显式修订或时间线恢复流程。

## 4. 切片损坏恢复阶梯

目标节点恢复材料校验失败时：

1. 停止恢复，不移动 `activeNodeId`，也不先建立安全切片。
2. 记录目标完整基线/差量重放的实际失败原因。
3. 沿父节点链逐个 materialize，寻找最近可验证祖先。
4. 写入 `.nbook/rp/branches/problems/{reportId}.json`。
5. UI 显示问题、报告路径和最近可验证祖先，只提供“查看该节点”；是否恢复仍由玩家再次确认。

问题报告包含目标节点、尝试节点、失败原因、最近可验证节点及 `retry / restore_last_verified / keep_current / inspect_report` 选项。找不到可验证祖先时必须保留当前时间线并查阅报告，不能生成一个“看起来合理”的替代世界。

## 5. 固定随机只属于测试

正常游玩的骰子、候选事件抽取和概率风险都使用服务端 `crypto` 随机。`withRpTestRandomSeed()` 只在 `NODE_ENV=test` 可用，并通过 `AsyncLocalStorage` 隔离并发用例；环境变量、项目配置和玩家输入不能把生产游玩切换为固定种子。

`randomUUID` 只生成标识符，不影响玩法结果，因此不进入固定随机序列。长期验收必须验证骰子、候选事件和风险结算在同一种子下整体可复现。

## 6. 长期验收下限

P9 基线场景必须包含：

- 100 个完整 committed Tick，不能只有伪造文件；
- 20 个具名角色、30 个地图节点、10 个周期资源；
- light、standard、deep 三档运行强度；
- 至少三条时间线、多次长跳与恢复；
- 最终 deep 状态为 healthy；
- 无重复结算、无状态损坏、无支线角色记忆泄漏、无未确认开团。

