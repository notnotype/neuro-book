# World Engine 快速参考

> 一页纸快速参考，给 Leader 在剧情推进时快速查阅。完整指南见 [workflow.md](workflow.md) 和 [focus-level-guide.md](focus-level-guide.md)。

## 关注度等级速查表

| 星级 | 等级名 | backstory 数量 | 当前剧情切片密度 | 典型角色 |
|------|--------|---------------|-----------------|----------|
| ★★★★★ | 绝对主角 | 5-10 条 | 每个场景转换 | 第一人称主角、双主角 |
| ★★★★☆ | 核心主角 | 5-8 条 | 重要场景 | 核心队友、主要视角角色 |
| ★★★☆☆ | 重要配角 | 2-4 条 | 关键行动 | 重要反派、关键 NPC |
| ★★☆☆☆ | 次要配角 | 1-2 条 | 直接参与剧情时 | 城主、短期任务委托人 |
| ★☆☆☆☆ | 临时 NPC | 0 条 | 不建 subject | 路人、店员、一次性敌人 |

**Lorebook 标题格式**：`# 艾莉娜·晨曦（Erina）[★★★★☆ 主角]`

## 切片粒度速查表

### 按场景类型

| 场景类型 | 推荐粒度 | 示例 |
|---------|---------|------|
| **战斗** | 极细（每回合或关键动作） | 挥剑 → 格挡 → 受伤 → 支援（4 条切片） |
| **重要对话** | 细（每个话题转换） | 自我介绍 → 坦诚困境 → 建立信任（3 条切片） |
| **探索/移动** | 中（每个地点转换） | 离开祭坛 → 前往客房 → 到达客房（3 条切片） |
| **日常/休息** | 粗（整个时间段） | 用餐、睡觉、赶路（1 条切片） |
| **backstory** | 粗（一个人生阶段） | "478-487年：继承爵位，领地衰败"（1 条切片） |

### 按信息维度

| 维度 | 细粒度（更多切片） | 粗粒度（更少切片） |
|------|-------------------|-------------------|
| **空间** | 主角当前场景，视角附近 | 视角之外的远处事件 |
| **时间** | 新发生的事件 | 旧事件（backstory） |
| **重要性** | 关键转折、战斗、对话 | 赶路、日常、过渡 |
| **信息密度** | 多个角色同时行动、状态频繁变化 | 单一角色的单调行为 |

## LOD 边界（✅ / ❌）

**职责**：描述环境、氛围、群体动向，**不引入有名字的个体**。

| 场景 | ❌ 错误（引入个体） | ✅ 正确（只描述环境） |
|------|-------------------|---------------------|
| 大厅 | "女仆莉丝端着茶盘走进客房" | "一名女仆端着茶盘走进客房" |
| 训练场 | "卫兵队长格里芬正在训练新兵" | "卫兵队长正在训练新兵" |
| 市集 | "商人艾德温在大厅等候觐见" | "一位商人在大厅等候觐见" |

**何时提升为 subject**：当 LOD 里的个体需要**与主角直接对话、做出独立决策、追踪状态变化**时，立刻为其建立 subject（通常是 ★★☆☆☆ 或 ★★★☆☆）。

## 初始化检查清单

### Phase 0：用户准备
- [ ] 剧情大纲（至少第一卷/第一章的框架）
- [ ] 主要角色列表（至少 2-3 个核心角色）
- [ ] 世界观要点（纪年、地理、力量体系概要）
- [ ] 故事"现在"是哪个时间点

### Phase 1：Era 切片
- [ ] 创建 world subject（如"阿斯塔利亚"）
- [ ] 写入第一个切片（纪年第 1 年第 1 月第 1 日）
- [ ] `world.subject.list("world")` 返回 1 个 world subject
- [ ] `world.time.now()` 能返回正确的当前时间

### Phase 2：初始化核心 subject
- [ ] 为每个核心角色（★★★★★ 或 ★★★★☆）建立 subject
- [ ] 为主要势力建立 faction subject
- [ ] 为主要地点建立 location subject
- [ ] 每个 subject 都有 `name` 和基础字段

### Phase 3：Backstory 溯源
- [ ] ★★★★★ 角色：补 5-10 条 backstory 切片
- [ ] ★★★★☆ 角色：补 5-8 条 backstory 切片
- [ ] ★★★☆☆ 角色：补 2-4 条 backstory 切片
- [ ] ★★☆☆☆ 角色：补 1-2 条 backstory 切片
- [ ] 每个角色的 backstory 切片时间早于故事"现在"

### Phase 4：确认故事起点
- [ ] 写入故事"现在"时间点的切片
- [ ] 所有核心角色都有明确的当前位置
- [ ] 故事起点的切片是时间线上最新的一条
- [ ] `world.slice.list()` 返回的切片列表符合预期

## 剧情推进检查清单

### Phase 1：剧情设计
- [ ] 读取当前世界状态（`execute_world`）
- [ ] 向用户提出 2-4 个候选方向
- [ ] 确认本轮剧情的目标、范围、关键事件、预期结局
- [ ] 明确信息控制要求（谁知道什么、谁不知道什么）

### Phase 2：写入切片
- [ ] 把剧情框架拆分为若干场景或关键状态变化
- [ ] 为每个场景确定时间点（精确到小时或分钟）
- [ ] 为每个场景写入切片（`execute_world` 中调用 `world.slice.write`）
- [ ] 更新角色 `location`、`hp`、`events`、`relationships`、`knowledge`
- [ ] 验证：每个切片的时间点符合剧情顺序
- [ ] 验证：所有角色的状态变化都已记录

### Phase 3：写正文
- [ ] 准备简化 brief（只传框架，不传可查询的细节）
- [ ] 调用 writer（`invoke_agent`）
- [ ] 传递 brief + lorebook 路径 + World Engine 查询提示
- [ ] 等待 writer 完成
- [ ] 检查正文是否符合 brief 要求

### Phase 4：回顾与调整
- [ ] 读取 writer 写出的正文
- [ ] 检查是否有"偏离 brief 的状态变化"
- [ ] 如果有偏离：向用户确认是否接受
- [ ] 如果接受：补写切片（创建新角色 subject、更新状态）
- [ ] 如果不接受：让 writer 重写或回退切片
- [ ] 向用户展示"本轮剧情摘要 + 当前世界状态"

## 常用工具

### execute_world（读写合一 CodeAct）

```javascript
// 时间转换：写入用 instant，展示给人看时再格式化
const time = world.time.parse("公元2020年4月12日 18:00");

// 查询单个 subject
const veiluosi = await world.subject.get("veiluosi");
// 返回 attrs 本体，直接访问属性；不是 veiluosi.attrs.age
const age = veiluosi?.age;

// 查询多个 subject
const heroes = await world.subject.gets(["veiluosi", "yuelian", "gelushi", "erina"]);

// 列出某类型所有 subject
const allCharacters = await world.subject.list("character");

// 反向查找引用
const whoReferencesVeiluosi = await world.subject.findRefs("veiluosi");

// 向量搜索
const results = await world.search.text("岩石魔法");

// 查询时间轴切面
const slices = await world.slice.list({limit: 10, withPatches: true});

// 查询某 subject 相关切面；world.slice.get 只接受 sliceId，不接受 subjectId
const veiluosiSlices = await world.slice.list({subjectIds: ["veiluosi"], withPatches: true});

// 获取当前时间
const now = world.time.now();

// 首次写入新 subject（自动创建）
const created = await world.slice.write({
    time,
    title: "薇洛丝转生",
    patches: [
        {
            subjectId: "veiluosi",
            type: "character",  // 仅首次写入时需要
            name: "薇洛丝",      // 仅首次写入时需要
            path: "/age",
            op: "replace",
            value: 19,
        },
    ],
});

// 同一 instant 只能有一个 slice；同刻多个变更必须合并到同一个 patches 数组
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 18:01"),
    title: "开局初始化",
    patches: [
        {subjectId: "castle-brauer", type: "location", name: "布劳尔城堡", path: "/description", op: "replace", value: "召唤仪式发生地"},
        {subjectId: "veiluosi", path: "/location", op: "replace", value: "subject://castle-brauer"},
        {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "公元2020年4月12日 18:01，薇洛丝在布劳尔城堡苏醒"}},
    ],
});

// 如果目标 instant 已有 slice，先读取再合并已登记 subject 的补充 patch
const existing = await world.slice.list({from: time, to: time, withPatches: true});
if (existing[0]) {
    await world.slice.editPatches(existing[0].id, [
        {add: {subjectId: "veiluosi", path: "/events", op: "append", value: {text: "补充同刻事件"}}},
    ]);
}

// 后续写入（不需要 type 和 name）
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 18:05"),
    title: "初次对话",
    patches: [
        {subjectId: "veiluosi", path: "/location", op: "replace", value: "subject://castle-brauer"},
        {
            subjectId: "veiluosi",
            path: "/events",
            op: "append",
            value: {text: "公元2020年4月12日 18:05，听到维克托解释召唤目的"},
            summary: "薇洛丝听到召唤者的解释",
        },
    ],
});

// 精确修正已有 patch：先拿 patchId，再 editPatches
const slice = await world.slice.get(created.sliceId);
const agePatch = slice.patches.find((patch) => patch.path === "/age");
await world.slice.editPatches(created.sliceId, [
    {patchId: agePatch.patchId, set: {path: "/realAge", summary: "年龄字段修正"}},
]);

// 整条切面作废时才物理删除
await world.slice.delete(created.sliceId);

return "已完成 World Engine 更新";
```

**注意**：删除是物理删除，不可恢复。修正单条 patch 时优先使用 `world.slice.editPatches`，不要整片删除重写。`editPatches({add})` 不负责首写创建 subject；同一 instant 里如果包含新 subject，必须在第一次 `world.slice.write` 中把这些新 subject 的 `type/name` patch 一起合并进去。

## 4-op 语义速查

| op | 用途 | 示例 |
|----|------|------|
| `replace` | 设置绝对值 | `{path: "/hp", op: "replace", value: 80}` |
| `increment` | 数值增减 | `{path: "/hp", op: "increment", value: -20}` |
| `remove` | 移除路径 | `{path: "/skills/0", op: "remove"}` |
| `append` | 数组追加 | `{path: "/events", op: "append", value: {...}}` |

**collection 可按值删除**：`{path: "/skills", op: "remove", value: {name: "岩石魔法"}}`  
**list 不支持按值删除**：只能用索引 `{path: "/skills/0", op: "remove"}`

## Issues 速查

完整 code 表、`WorldIssue` 字段和处理方式见 [issues.md](issues.md)。

处理口诀：

- **E issues**：持久数据错误，必须修。
- **A issues**：一次性提醒，确认语义即可。
- 向用户解释时使用后端返回的 `title` / `message` / `explanation`，不要直接抛 code。

## 相关文档

- [workflow.md](workflow.md)：完整写作模式工作流
- [focus-level-guide.md](focus-level-guide.md)：关注度等级详细指南
- [recording-principles.md](recording-principles.md)：最少支持当前叙事原则
- [schema-system.md](schema-system.md)：schema 与 4-op 语义
- [subject-lifecycle.md](subject-lifecycle.md)：subject 生命周期与 reduce
- [issues.md](issues.md)：issue taxonomy、catalog 与展示规则
- [calendar-system.md](calendar-system.md)：时间系统
