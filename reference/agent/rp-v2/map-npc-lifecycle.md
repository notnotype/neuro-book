# RP v2 层级地图与 NPC 生命周期

本契约定义 P5 的两类运行目录：`rp_map` 维护地点层级、玩家可见性与路线索引；`rp_npc` 维护 NPC 从具名到主要角色的生命周期。两者都不是第二套 World Engine。

## 1. 真相源边界

| 内容 | 唯一负责者 |
| --- | --- |
| 地点在某一时刻的完整客观状态、角色位置、环境变化 | RP World Engine（`worldKey="rp"`） |
| 地点稳定 id、父子层级、玩家发现状态、路线是否可见 | `rp_map` |
| 候选/active 事件生命周期 | `rp_event` |
| NPC 具名、常驻、主要、长期离场层级 | `rp_npc` |
| 主要角色人设、主观认知和 Tick 记忆 | `rp/characters/{id}/` |
| 金钱、欲望、周期等精确资源 | `rp_mechanics` |

`rp_map` 节点的 `id` / `worldSubjectId` 必须与对应 World Engine subject id 相同：`level=world` 的世界根对应 `type=world`，其余层级对应 `type=location`。world 在接受地点提案前先保证同 ID subject 已写入且类型匹配，再登记地图节点；服务端也会在 materialize 前重复校验。地图目录只保存投影所需的稳定字段，不复制完整 attrs。

## 2. 层级地图

固定层级从大到小为：

```text
world -> region -> town -> district -> building -> sub_location
```

允许中间层暂缺，但父节点必须严格高于子节点。只有能持续承载以下至少一项内容的空间才建立节点：

- 世界结构；
- 正式事件；
- 可持续出现的 NPC；
- 资源或经营点；
- 特殊、秘密或跨层连接。

一次性走廊、临时背景、没有后续承载能力的房间不建节点，直接留在当 Tick 叙事与世界切片中。

### 地点状态

- `rumored`：化身只知道模糊名称、摘要和大致方向；玩家投影不能显示 canonicalName。
- `discovered`：已经确认存在并到访或可靠得知。
- `familiar`：玩家对地点有稳定经验，可显示更完整的玩家摘要。
- `unavailable`：暂时无法进入；节点和历史连接保留。
- `destroyed`：地点已毁坏；节点永久保留，普通运行流程不能直接恢复，恢复必须走世界修订。

首次成功抵达调用 `arrive`：rumored 至少变为 discovered，并记录 `solidifiedAtTick`。固化后的基础身份不靠普通运行更新改写。

### 路线

公开路线建立后进入玩家地图。秘密路线即使 GM 已知，也必须在 `discover_route` 前完全从玩家投影、actor packet 和 Writer Brief 中消失；不能以灰色线、问号或暗示名称提前泄露。路线 `unavailable` / `destroyed` 后保留索引与玩家已经获得的认知。

## 3. 地点提案与冲突

职责顺序固定：

```text
screenwriter / 玩家提出 -> world 核对 canon 与 World Engine
-> 无冲突：写/确认匹配层级的 subject -> rp_map materialize
-> 有冲突：记录 conflictReasons -> 玩家决定 -> world 再校验
```

- screenwriter 在常规运行只能提出 `origin=screenwriter`；唯一特例是服务端处于 `bootstrapping/map` 时可逐地点提出 `origin=bootstrap`。
- `propose` 每次只接受根字段中的一个地点；多个地点重复调用。`candidates` 只属于 `stage_import`，不能与 `propose` 混用。
- 相同 `requestedId` 若业务字段完全一致则幂等返回；若父节点、层级或其他定义不同，工具会明确列出差异并要求 `replace_proposal`。替换只允许 `proposed/pending_import/conflict`，保持 requestedId 与 origin 不变；旧提案标记 `superseded` 并保留审计链。已 materialize 地点不能通过此入口改写。
- 真正错误的 Bootstrap materialized 节点只能由 world 在 `bootstrapping/map` 使用 `discard_bootstrap_location` 撤销。服务端仅允许未抵达、无子节点、无路线的 bootstrap 叶节点，旧提案转为 `rejected` 并保留原因；随后 screenwriter 用新稳定 id 重新提案。active 运行期节点不可用此入口改写。
- 玩家直接要求地点时，leader 只能提出 `origin=player`。
- world 独占 `review`、抵达、状态和路线维护。
- leader 的 `approve_conflict` 会触发真实用户审批。批准只允许 world 再次校验，不代表 leader 自己完成落库。
- 玩家不批准时保留冲突记录或放弃提案，不静默改写任一侧设定。

## 4. 小说地点导入

小说改编只在开团路线 A 获得一次性授权后执行。盘点范围必须覆盖 Lorebook、Plot、World Engine 和正文中出现过的所有地点；每项保留 `sourceRefs`。

1. 完成全量盘点后用 `stage_import` 建立 `pending_import` 候选。
2. 用 `confirm_import` 一次覆盖全部待确认项。工具会暂停并等待玩家确认；缺少任何候选都会拒绝。
3. 纳入项进入 world 校验队列，排除项保留 `rejected` 审计。
4. 不完整信息标为 `partial` 或 `vague`。玩家可以补充、授权主持补全、保持模糊或排除。
5. 与 canon 冲突的候选必须标 `conflict`，主持不能静默选边。

后台可以保留完整 god-view 地点事实，但玩家地图仍按化身认知从 rumored 逐步显示。

## 5. NPC 生命周期

```text
未具名群演（不落 roster） -> named -> resident -> major -> major_inactive
```

- 群演在叙事中说出姓名后，world 立即 `register_named`。只建立最低 roster，不代表擢升，也不提前创建 actor session。
- Bootstrap characters 阶段允许 world 登记企划中已经确认具名的初始 NPC。未具名群演不得用描述性占位词伪造成姓名；没有具名初始 NPC 时 roster 可以为空。
- 玩家主动提供角色人设时由 leader `register_player`，同样先是 named。
- named 升 resident、named/resident 升 major 都必须调用 `promote` 并通过真实玩家审批。
- screenwriter 只能 `suggest`，建议显示在角色侧栏、不阻塞当前叙事；不得按好感阈值自动升级。
- 敌人、宿敌、竞争者和盟友具有相同擢升资格。依据是持续互动、重要事件、关系结构和角色自身人设。
- major 总数无硬上限；活跃 major 软上限默认 8。超过只给整理提示，不拒绝玩家决定。
- major 长期离场由 world 转为 `major_inactive`；档案、关系与记忆都不删除。实际回归时恢复 major。
- actor session 始终在角色实际出场时由 cast 惰性创建，不因 roster 擢升提前占用会话。

## 6. 擢升补建与资源

升 major 时，服务端先确保 `rp/characters/{id}/` 存在，再允许用 `memoryBackfill` 从历史 Tick、正式事件和互动摘要补建该角色视角的记忆。每条补建必须带 `sourceRef`；不能直接复制全知报告或其他角色不可见内容。

named NPC 只保存 `household` 这类粗粒度经济身份。resident / major 擢升后 `resourceStatus=pending`：world 按身份通过 `rp_mechanics` 建立合理的精确初始账户，完成后调用 `resources_ready`。随机金额或规则结果仍必须由服务端机制产生，不由模型伪造。

## 7. 工具权限摘要

| 操作 | leader | screenwriter | world |
| --- | --- | --- | --- |
| 地图/NPC 玩家视图 | 读 | 读 | 读 |
| 地点提案 | 仅玩家原案 | 自己的提案；Bootstrap map 可用 bootstrap 来源 | 否 |
| 小说地点盘点确认/冲突审批 | 玩家审批 | 否 | 否 |
| 地点校验、抵达、状态、路线 | 否 | 否 | 是 |
| 群演具名登记、出场状态 | 否 | 报告所需字段 | 是 |
| 玩家自带 NPC 登记 | 是 | 否 | 否 |
| 擢升建议 | 否 | 是 | 否 |
| 实际擢升 | 玩家审批 | 否 | 否 |
| resident/major 资源完成标记 | 否 | 否 | 是 |

所有玩家审批都必须来自工具 `userInputRequest` 的真实 resolution；普通对话中的推测性同意不能伪造批准。
