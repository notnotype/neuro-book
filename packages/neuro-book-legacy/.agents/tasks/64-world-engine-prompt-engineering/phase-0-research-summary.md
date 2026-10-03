# Phase 0 调研总结

> 创建日期：2026-06-22

## 调研方法

派发 3 个并行 agent 从不同角度分析世界引擎提示词工程：

1. **Agent 1**：用户视角理想协作流程设计
2. **Agent 2**：现有 skills 和工作流适配需求分析  
3. **Agent 3**：World Engine 工具使用模式和技术实现

## 核心发现汇总

### 1. 用户体验设计（Agent 1）

**关键原则**：技术细节对用户透明

**推荐流程**：
```
灵感探索 → 项目初始化 → [可选: World Engine 设置] → 世界观扩展 
→ 剧情设计(状态查询辅助) → 正文写作(自动状态记录) → 后续章节(一致性保证)
```

**World Engine 初始化时机**：
- ✅ **应该**：项目完成基本定位（有简介、主角）且故事有明确时间线时
- ❌ **不应该**：纯灵感探索阶段、故事无时间概念时

**引导策略**：
- 用"我可以帮你记住角色状态"而非"初始化 World Engine"
- 提供 3-4 个时间格式模板（现代/奇幻/简单纪年/自定义）
- 从"开局出场角色"开始，强调"后续随时可以加"

**潜在卡点与解决方案**：
| 卡点 | 解决方案 |
|------|---------|
| 不理解为什么需要 | 等到用户实际遇到问题时再介绍 |
| 不知道如何设置时间 | 提供具体模板 + 推荐默认 |
| 不知道该记录哪些 subject | 从开局角色开始 + 给判断标准 |

**用户永远不需要知道的概念**：
- slice, mutation, reduce, instant, op (set/add/listAppend), schema, calendar parse/format

**典型对话示例**：见调研报告第 3 节

---

### 2. Skills 适配需求（Agent 2）

#### 需要修改的 Skills（已根据实施策略调整）

**核心写作流程（本次改造）**：

1. **novel-workflow-01-idea-exploration**
   - ✅ 无需改动（灵感探索阶段不涉及 World Engine）

2. **novel-workflow-02-project-bootstrap**
   - 改动：在流程末尾添加"可选初始化 World Engine"引导

3. **novel-workflow-03-lorebook-bootstrap**
   - 改动：补充 lorebook 与 World Engine 的关系说明

4. **novel-workflow-08-plot-planning**
   - 当前依赖：director, simulation 因果推导
   - **核心改造**：因果推导改用 World Engine 状态推导，移除 director 依赖

5. **novel-workflow-09-chapter-writing**
   - 当前依赖：Plot System, simulation 状态查询
   - 改动：状态查询改用 `get_world_state`，状态变更改用 `write_world_slice`

**不改造（明确暂缓）**：

- **novel-workflow-05-emulation-bootstrap** - 暂不改造
- **novel-workflow-06-emulation-tick** - 暂不改造
- RP 相关 skills - 暂不涉及

#### 需要检查的其他组件

**Profiles**：
- `simulator.leader` - 是否保留？如果保留，改为调用 World Engine 工具
- `director` - 只负责 Plot System，不负责状态管理
- `rp.leader` / `rp.writer` - RP 模式集成（后续任务）

**Reference 文档**：
- `reference/content/simulation.md` - 补充新职责边界
- `reference/plot/system.md` - 补充 Plot 与 World Engine 的关系
- **新增** `reference/world-engine/agent-tools.md`

**AGENTS.md**：
- 补充 World Engine 使用规则

#### 信息边界设计

| 系统 | 职责 | 存储 |
|------|------|------|
| **World Engine** | 动态状态、时间线、事件演化 | Project SQLite |
| **simulation/subjects/** | 主体 discovery + RAG 记忆层 | 六文件（subject.md, events.jsonl, memory.jsonl, mind.md, state.md, soul.md） |
| **Lorebook** | 静态设定、世界观、知识库 | Markdown |
| **Plot System** | 作者视角剧情结构 | Project SQLite Thread/Scene/Plot |

---

### 3. 技术实现细节（Agent 3）

#### 工具使用模式

**初始化一个奇幻世界**：
```
1. get_world_schema (查看 schema)
2. create_world_subject(id="world", time="复兴纪元1年") (纪元锚点)
3. create_world_subject(id="erina", type="character") (角色)
4. create_world_subject(id="capital", type="location") (地点)
```

**查询状态**：
```typescript
// 当前状态
get_world_state({
  projectPath: "...",
  subjectIds: ["erina"],
  attrs: ["hp", "location", "mind"]  // 可选投影
})

// 历史状态
get_world_state({
  projectPath: "...",
  subjectIds: ["erina"],
  at: "复兴纪元488年 3月1日"  // 倒叙
})
```

**记录战斗**：
```typescript
write_world_slice({
  projectPath: "...",
  time: "复兴纪元488年 风信之月 15日 14:00",
  title: "城北遭遇战",
  mutations: [
    {subjectId: "erina", attr: "location", op: "set", value: "subject://northgate"},
    {subjectId: "erina", attr: "hp", op: "add", value: -30},
    {subjectId: "erina", attr: "events", op: "listAppend", value: "..."}
  ]
})
```

**补充历史**：
```typescript
write_world_slice({
  projectPath: "...",
  time: "复兴纪元200年 1月1日",  // 更早的时间
  title: "凤凰王国立国",
  mutations: [...]
})
```

#### Profile 工具权限推荐（已根据实施策略调整）

| Profile | 拥有的工具 | 职责 |
|---------|----------|------|
| **leader.default** | 全部 8 个 World Engine 工具 | 统筹协调、世界状态维护 |
| **world.engine** | 全部 8 个 World Engine 工具 | 专用测试和维护，普通用户不直接接触 |
| **writer** | **保持当前权限（包括 bash）** | 正文写作，状态通过 leader 的 brief 传递 |

**只读查询工具**（安全）：
- `get_world_schema`, `list_world_subjects`, `get_world_state`, `list_world_slices`

**写入修改工具**（需权限）：
- `create_world_subject`, `write_world_slice`, `edit_world_slice`, `delete_world_slice`

#### Issues 处理策略

**E issues（错误，必须修复）**：
- `broken-relative`: 相对 op 缺少基准 → 补充初始值
- `dangling-ref`: 引用不存在 → 创建目标 subject

**A issues（建议，确认语义）**：
- `base-shifted`: 编辑过去改变下游基准 → 确认是否符合预期
- `masked`: 本次修改被下游覆盖 → 确认是否冗余

**向用户解释**：
- ❌ 不要："broken-relative"
- ✅ 应该："缺少初始值，需要补充"

#### 与其他系统配合

**Writer 如何使用**：
- Writer 不应直接写 World Engine（职责分离）
- Writer brief 用自然语言描述状态，不暴露技术细节
- 状态变更由 Leader 调用工具记录

**与 Lorebook 的关系**：
- Lorebook：静态设定（"艾莉娜是凤凰骑士团成员"）
- World Engine：动态事件（"艾莉娜 488 年加入骑士团"）

**与 Manuscript 的关系**：
```
World Engine (状态源) 
  ↓ 查询状态
Director/Leader (剧情设计)
  ↓ Writer brief
Writer (正文写作)
  ↓ 生成内容
Manuscript (章节正文)
```

---

## 实施建议

### 短期（第一版 MVP）

基于调研结果，推荐实施优先级：

#### 1. 核心 Profile 更新
- **leader.default**：
  - 添加全部 World Engine 工具
  - 更新系统提示词，引导使用 World Engine
  - 完全脱离 director/plot/simulation 的提及
  
- **writer**：
  - 不添加 World Engine 工具（职责分离）
  - 说明状态信息来自 leader 的 brief
  
- **world.engine**：
  - 评估是否需要用户直接接触
  - 如果不需要，考虑隐藏为后台工具

#### 2. 关键 Skill 改造
- **novel-workflow-08-plot-planning**（核心）：
  - 移除 director 依赖
  - 使用 World Engine 查询和记录状态
  
- **novel-workflow-09-chapter-writing**：
  - 状态查询改用 `get_world_state`
  - 章节写作后用 `write_world_slice` 记录变化

#### 3. 初始化流程
- **novel-workflow-02-project-bootstrap** 末尾增加可选 World Engine 初始化
- 使用自然对话引导，强调"可选"

### 中期（优化迭代）

1. 增强 Leader 的主动建议能力
2. 提供状态可视化功能
3. 智能状态推导

**不在本次范围**：
- 不创建专门的 `world-engine-initialization` skill（通过现有 skills 引导即可）
- 不补全 emulation 相关 skills（明确暂缓）

### 长期（高级功能）

1. 多视角状态管理
2. 状态冲突检测
3. RP 模式集成

---

## 已确认的设计决策

基于调研和讨论，以下决策已明确：

1. **world.engine profile 定位**：
   - ✅ **专用测试和维护 profile**
   - 用于验证 World Engine 功能、调试问题
   - 普通用户通过 leader 使用 World Engine，不直接接触此 profile

2. **writer 工具权限**：
   - ✅ **保持当前权限配置**
   - writer 拥有 `bash` 工具（与现在一样）
   - writer 可以通过 bash 调用 `workspace node` 等命令
   - 状态信息主要通过 leader 的 brief 传递

3. **emulation/simulation 改造策略**：
   - ✅ **不改造，专注 novel 写作模式**
   - `novel-workflow-05-emulation-bootstrap` - 暂不改造
   - `novel-workflow-06-emulation-tick` - 暂不改造
   - `simulation/subjects/` 六文件 - 保持现状，不动
   - `state.md` - 继续手动维护，不从 World Engine 自动生成

4. **改造范围收窄**：
   - 只改造核心 novel 写作流程（01, 02, 03, 08, 09）
   - RP 模式、Emulation 模式暂不涉及
   - 保持系统其他部分稳定

---

## 下一步行动

根据调研结果，建议的实施顺序：

### Phase 1：文档与规范（1-2 天）
1. 更新 `reference/content/simulation.md` - 明确新职责边界
2. 新增 `reference/world-engine/workflow.md` - 写作模式工作流
3. 更新 `AGENTS.md` - 补充 World Engine 使用规则

### Phase 2：核心 Profile（2-3 天）
1. 更新 `leader.default.profile.tsx`
2. 更新 `writer.profile.tsx`（保持当前工具权限，更新提示词说明）
3. `world.engine.profile.tsx` 定位已明确：专用测试和维护

### Phase 3：关键 Skill（2-3 天）
1. 更新 `novel-workflow-02-project-bootstrap`（添加初始化引导）
2. 更新 `novel-workflow-03-lorebook-bootstrap`（补充关系说明）
3. 改造 `novel-workflow-08-plot-planning`（核心改造）
4. 改造 `novel-workflow-09-chapter-writing`（状态查询改造）

### Phase 4：验证测试（1-2 天）
1. 在 `ming-ding-zhi-shi-2` 上完成端到端测试
2. 记录问题和改进点
3. 迭代优化

---

## 附录：完整调研报告

详细内容见各 agent 的完整输出。

**相关 Agent Session IDs**：
- Agent 1 (用户体验)：a276edcffb15dae32
- Agent 2 (Skills 适配)：a8ff572b029a7cfc0
- Agent 3 (技术实现)：ab8e2ac92dadfe9b4
