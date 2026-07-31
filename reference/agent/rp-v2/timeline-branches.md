# RP v2 世界切片树与时间线恢复

本文定义 RP 模式的可恢复时间线分支。它是 World Engine 单线事件溯源之上的 RP 运行层能力，不改变写作模式 `worldKey="main"`，也不改变 `world.slice.*` 的原有语义。

## 1. 两种“切片”不是同一个对象

- **World Engine `WorldSlice`**：一个 instant 上的一组增量 patch；同 instant 唯一，参与 reduce。删除是不可恢复的物理删除。
- **RP 世界切片树节点**：一个可恢复检查点，覆盖 RP 世界数据库及相关运行文件。它可以有父子分支，不直接参与 World Engine reduce。

因此，回滚或分支不能通过批量调用 `world.slice.delete()` 实现。删掉后续 WorldSlice 既不能恢复 RP 事件、资源、关系、认知、正文与骰子，也会破坏可审计历史。

## 2. 持久化位置与恢复范围

时间线索引和恢复材料位于 Project Workspace：

```text
.nbook/rp/branches/
├── tree.json
├── ledger.jsonl
└── nodes/{nodeId}/
    ├── manifest.json
    └── payload/...
```

每个节点覆盖：

- `.nbook/world-rp.sqlite` 中的 `WorldSubject`、`WorldSlice`、`WorldPatch`、`WorldOperation`；以结构化导出保存并在单 SQLite 事务中恢复。
- `.nbook/rp/runtime/`：turn、pipeline、事件、地图、NPC、资源、关系、认知、关注度、错误与更新记录。
- `rp/ticks/`：正式正文与终裁报告。
- `rp/dice/`：该分支上的骰子记录。
- `rp/characters/`：角色档案与分层记忆。

不随分支恢复：

- `rp/manual/`、`rp/lorebook/`、`rp/world-engine/` 配置，它们是分支共享的基础设定与 schema/calendar。
- `.nbook/rp/intake/`，开团确认不因时间回滚失效。
- `.nbook/rp/branches/` 自身，避免恢复材料递归包含自己。

## 3. 树与分支上限

- 首次启用时建立一个完整根节点；根节点永久锁定。
- 每个 committed Tick 在树已启用时自动建立一个子节点。
- 玩家也可以手工建立命名检查点。
- 一个节点最多有 **4 个未归档直接子分支**；后代总数不限。
- 创建第五条直接分支前，玩家必须显式选择一个替换对象。根节点、active 节点、锁定节点不能替换。
- 替换采用归档：从普通树移除该子树，但节点材料仍保存在项目中，不执行不可恢复删除。
- 当前 active 节点已有 4 个子分支时，`rp_turn begin_commit` 在 world 写回前阻断，不能先提交世界再补做分支选择。

## 4. 完整与差量混合存储

- 根节点、安全节点、分支点和每 10 层节点保存完整材料。
- 其他中间节点只保存相对父节点新增或变化的文件，以及删除路径集合。
- 每个 manifest 保存目标节点的完整文件哈希索引、变化路径、删除路径与清单哈希。
- 预览或恢复时从最近完整节点开始重放差量，并校验每个载荷和最终文件索引；校验失败必须停止，不能静默拼凑状态。

该方案让恢复结果等价于每节点全量快照，同时避免每个 Tick 重复保存未变化的正文、角色档案和运行账本。

## 5. 只读预览与影响范围

点击节点只执行只读 materialize，不改变 active 时间线。预览必须展示：

- 文件材料完整性；
- 正式回合、事件、地图节点、NPC、资源账户、关系、角色认知、骰子记录和 World Engine 切面数量；
- 相对 active 节点的目标数量与变化量；
- 不同逻辑文件数量。

预览不会读取或展示事件幕后安排、NPC persona、actor 内心提案等玩家不可见内容。

## 6. 恢复流程

恢复只允许在 active 冒险且不存在 draft/running/awaiting_player/committing 回合时进行：

1. 玩家选择旧节点并查看只读影响范围。
2. UI 询问是否先建立安全切片，默认开启。
3. 若安全切片将成为第五条直接分支，玩家先选择可替换对象。
4. 服务端先运行 standard 审计，并校验、materialize 目标节点。
5. 目标材料通过后才建立可选安全切片。
6. 精确替换 RP runtime、ticks、dice、characters 文件范围。
7. 在单 SQLite 事务中重建 RP World Engine 表。
8. 恢复目标分支角色 belief，并合并玩家跨分支 OOC 认知。
9. 将目标节点设为 active，追加恢复审计，再运行一次 standard 审计。
10. 前端新建 `rp.leader` 会话；新的 cast/actor 子会话链从恢复后的档案与认知重新建立。

恢复材料失败时不能移动 activeNodeId，也不能先建立安全切片。服务端会沿祖先链寻找最近可验证节点，并将问题写入 `.nbook/rp/branches/problems/{reportId}.json`；UI 只允许玩家查看候选祖先，不能自动回退。详细阶梯见 [consistency-recovery.md](consistency-recovery.md)。

## 7. 认知和随机记录

- 当前分支客观事实与角色 belief 随节点恢复。
- 玩家 OOC 已知事实保存独立副本，跨分支继续可见；它不会自动进入当前分支客观事实，也不会自动成为化身或 NPC 的 belief。
- active 骰子日志随分支恢复。旧分支骰子仍保存在对应节点材料中，因此不会因回滚被物理抹除。
- 完全重复行动是否沿用原骰、条件变化是否重掷，仍由行动判定合同决定；时间线恢复本身不偷偷生成新骰值。

## 8. Agent 权限边界

- 玩家通过 RP 状态页的“切片树”窗口初始化、锁定、归档、建立检查点和恢复。
- Agent 没有直接恢复工具，不能替玩家确认安全切片或选择替换对象。
- 玩家提出回滚时，`rp.leader` 应说明影响并引导打开切片树；不得调用 `world.slice.delete()`、写 `gm_override` 或改文件来模拟回滚。
- `rp_turn begin_commit` 报告四分支容量不足时，leader 停止提交并让玩家在 UI 选择替换对象；不能绕过门禁。

## 9. HTTP 投影

- `GET /api/projects/rp/timeline`：读取树；未启用返回 `null`。
- `POST /api/projects/rp/timeline`：`initialize / checkpoint / lock / archive_branch`。
- `GET /api/projects/rp/timeline-preview`：校验并预览节点。
- `GET /api/projects/rp/timeline-diagnosis`：预览失败后生成问题报告并寻找最近可验证祖先，不改变 active。
- `POST /api/projects/rp/timeline-restore`：必须携带 `confirmed: true`，并声明是否建立安全切片及替换对象。

所有入口复用 Project Workspace open gate。树 GET 不产生隐式初始化写入。
