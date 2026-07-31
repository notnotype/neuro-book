# RP v2 时间、资源、关系与认知

P4 规则层把确定性机械结算保存在 Project Workspace `.nbook/rp/runtime/`，同时保持 World Engine Instant 是唯一当前时间源。Agent 负责提案和解释，服务端负责时间校验、周期批量计算、概率抽取、数值边界、幂等与权限。

## 1. 时间与长跳

- 每个 committed IC 回合只保存 `startTime` 与 `endTime`；OOC 不启动回合、不推进时间。
- 人读时间必须由 `rp/world-engine/calendar.ts` 解析；规则层只保存解析后的 Instant 字符串用于计算，不另立当前时间。
- `rp_turn commit.rules.time.endTime` 必须等于 RP World Engine 的最新 Instant，否则拒绝提交。
- 长时间跳跃只产生一个回合和一次批量结算，不逐日生成 Tick。
- `rp_mechanics plan_jump` 检查 active/suspended 事件和区间内到期硬性事件。存在阻断时，`approve_jump` 通过真实用户审批建立凭证；凭证绑定 turnId、起止 Instant 和当时全部阻断事件。
- commit 若缺少匹配凭证会拒绝，Agent 不能自行声称玩家批准。

## 2. 资源与周期

资源状态位于 `.nbook/rp/runtime/mechanics/state.json`，流水位于 `mechanics-ledger.jsonl`。

三类资源：

- `ledger`：金钱、物品数量等账本值。金钱第一版使用一个资源定义、一个余额和交易流水。
- `time_derived`：由锚点值和经过时间计算，读取时派生，不逐时写记录。
- `dynamic`：欲望、体力等动态整数状态，可同时受直接变化和周期规则影响。

规则：

- 精确值使用整数最小单位，避免货币浮点误差。
- 精确账户只允许 `player`、`resident`、`major`；普通 NPC 只保留身份/家境描述。
- 资源可以声明 min/max、前台状态词 bands、周期规则和派生速率；玩家自定义资源也只能使用这套声明式配置，不执行任意代码。
- 周期规则按起止 Instant 计算发生次数，一次写入汇总交易。
- 欲望建议 0-100，默认状态词为平静、微热、亢奋、难耐；它只能影响倾向，不能替角色做决定。

周期模块：

- 任意角色可声明锚点、周期总秒数和完整连续阶段；生理周期只是其中一种私密配置。
- 读取指定时刻时用 modulo 计算阶段，不逐日生成数据。
- 私密周期与概率结果默认不进入玩家视图。

概率结算：

- `rp_mechanics resolve_risk` 由服务端随机，输入行为风险等级、周期 factor 和措施 factor，全部使用 ppm 整数。
- 默认行为风险基准为 none=0%、low=2.5%、medium=10%、high=25%、extreme=50%，再乘周期和措施因子；项目可通过自定义风险类型表达其他概率。
- operationId 保证响应丢失重试返回首次抽取结果，不重新随机。

## 3. 八维有向关系

关系状态位于 `.nbook/rp/runtime/relations/state.json`，原因流水位于 `relation-ledger.jsonl`。

每条边独立保存 `source → target`：

```text
familiarity / trust / affection / attraction
respect / dependence / fear / hostility
```

- 每维为 0-100 整数强度；A→B 与 B→A 不能镜像覆盖或平均。
- 每次变化记录 turnId、Tick、delta、basis 和自然语言原因。
- 标签独立于数值，可多标签并存；只由 setting、interaction 或 player_declaration 增删，不从阈值自动生成。
- `basis=dice` 在服务端直接拒绝。骰子只能影响是否愿意交流、倾听或继续接触。
- 化身作为 source 时，系统推断不能改变 trust、affection、attraction；只有玩家明确表达，且 `sourceIsAvatar=true`、`playerDeclared=true`、`basis=player_declaration` 才能写入。

## 4. 三层认知

认知索引位于 `.nbook/rp/runtime/cognition/state.json`，变化流水位于 `cognition-ledger.jsonl`。

三层严格分离：

1. `facts`：世界客观事实索引，状态为 established/disputed/superseded。
2. `beliefs`：角色主观信念，可以相信、否认或不确定；内容可以与事实不同。
3. `oocKnowledge`：玩家 OOC 可见性，状态为 public/hidden/user_revealed。

约束：

- normal 事实默认 public；important/secret 默认 hidden。
- 玩家可通过 `rp_cognition set_visibility` 的真实审批解除或恢复隐藏。
- `user_revealed` 只改变 OOC 层，不创建化身 belief，也不能自动进入 Writer Brief。
- 角色认知只来自 observed/told/inferred；传闻使用 rumor channel，默认 belief=uncertain，并记录相关性原因。
- 玩家可以看到所有角色的状态入口，但重要条目仍由上述可见性标记过滤；具体 UI 在 P7 投影。
- 回滚后角色记忆截断、玩家 OOC 认知保留的分支行为由 P8 切片树统一实现，P4 只提供独立存储层。

## 5. 回合事务

`rp_turn commit` 的 `rules` 同时携带 time/resources/relations/cognition：

1. 服务端先完整预检所有账户、事实、关系 basis 和化身权限；
2. 预检通过后按 turnId 幂等写三个领域；
3. 任一步 I/O 中断可重试，已完成领域不会重复叠加；
4. 全部规则成功后才把 turn 标为 committed；
5. 详细变化只写文件化账本和后续状态窗口，不注入聊天上下文。
