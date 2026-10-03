# World Engine 提示词工程改造

> 状态：**写作模式 v1 提示词收口完成，历史草案保留** | 创建日期：2026-06-22

> 当前协议提示（2026-06 收口）：本任务早期调研与场景测试中保留了旧 API 名称，例如 `schema.yaml`、`create_world_subject`、`get_world_state`、`mutations`。现行写作模式以 `reference/world-engine/` 与 `assets/workspace/.nbook/agent/skills/` 为准：schema 使用 `world-engine/schema/index.ts`（Zod），Agent 工具使用 `execute_world_query` / `write_world_slice` / `delete_world_slice`，写入字段为 `patches`。

## 实施记录（Walkthrough）

### 2026-06-27：World Engine 写作流程与模板收口

本轮把普通 `leader.default` 能见的写作模式主链收束为：`灵感探索 → 项目/Lorebook → World Engine 初始化 → 08 剧情规划/状态推进 → 09 章节写作 → 写后回补/修订`。RP / simulation / director / 旧 Plot 资料保留为 legacy 或专用资料，不再作为普通写作入口、默认模板或 `ming-ding-zhi-shi-2` 的默认引导。

关键调整：

- `novel-workflow-08-plot-planning` 重写为 World Engine 剧情规划与状态推进手册：先判断意图、查询当前状态、按 LOD0-LOD3 判断记录粒度、确认剧情事实，再拆分事件写入 World Engine slice，最后处理 issues 并向用户回报人话摘要。未确认推演不是 canon，不写 World Engine。
- `novel-workflow-09-chapter-writing` 明确不重新设计剧情；默认本章剧情事实已由 `08` 确认并推进进 World Engine，再由 writer 基于简化 brief 与只读查询写正文。写后如有新事实，回到 `08` 确认并补切面。
- `novel-workflow-10-revision` 的状态变化回补从 emulation commit 改为 World Engine 回补；`05/06 emulation` 明确标为 legacy RP / simulation skill，不作为普通写作推荐路径。
- `leader.default.profile.tsx` 修正 Calendar 提示：只要求时间能被项目 `world-engine/calendar.ts` parse，Simple Calendar 配置 `cycleNames/monthName` 时允许月份名；LOD 指向 `reference/world-engine/workflow.md` 的写作模式 LOD。
- `reference/world-engine/` 补齐 `api-migration-zod.md`，说明 `schema.yaml`、`create_world_subject`、`get_world_state`、`mutations` 的当前替代：`world-engine/schema/index.ts` + `execute_world_query` / `write_world_slice` / `delete_world_slice` + `patches`。
- `reference/world-engine/schema-system.md` 降低旧 YAML 示例噪声，优先指向 Zod schema；`workflow.md` 同步写作模式 LOD0-LOD3 表。
- 默认 Project 模板的 `agents/` 目录只保留 `leader.default/` 与 `writer/` 上下文；`director`、`rp.leader`、`rp.writer`、`simulator.leader` 不再默认创建。
- `workspace/ming-ding-zhi-shi-2` 明确标注为 legacy RP / SillyTavern 导入项目，不作为普通写作模式 World Engine 验收样本；其 `leader.default` 项目级上下文不再自动读取或优先进入 `simulation/runs/current.md`。

静态验证：

- 默认模板 `agents/` 只剩 `leader.default` 与 `writer` 标准上下文。
- 普通写作主路径 `leader.default` / `world-engine-init` / `08` / `09` 不再推荐用 director、simulation、emulation 或旧 Plot 作为状态源。
- 旧 API 名称 `schema.yaml`、`create_world_subject`、`get_world_state`、`mutations` 仍只出现在历史草案、迁移速查、legacy 说明或“旧版差异”语境中，不作为当前协议。
- Calendar 提示不再禁止项目已支持的月份名。

### 2026-06-23：写作模式 v1 收口整理

本轮版本目标改为先优化 novel 写作模式：World Engine 作为动态世界状态与时间线真相源，旧 Plot / RAG subject 面板 / RP / simulation 模板从普通用户主路径隐藏。

- 前端顶栏隐藏 Plot Workbench 与 RAG Inspector；欢迎页移除 Plot / RAG / simulation 快捷入口；左侧侧栏移除 Outline / RAG，工具面板不再渲染 `NovelPlotPanel` / `NovelRagPanel`。
- Agent 新建菜单隐藏 `rp.leader` 与 `simulator.leader`；历史 session 的 profile 名称显示、图标映射和旧 profile 文件保留。
- 系统 Project 模板中的 `simulation/` 归档到 `assets/workspace/.nbook/templates/archived/project-directory-templates/simulation/`；新 Project 默认不再创建 `simulation/`。
- 用户 assets 同步会清理未手改的旧 `templates/project-directory-templates/simulation/**` 受管副本；真实 Project 里的既有 `simulation/` 数据不迁移、不删除。
- RP 模式当前隐藏但不删除资料；后续恢复时再重新设计入口与 profile routing。

验证：

- `bunx vitest run app/utils/novel-writing-mode-entries.test.ts app/components/novel-ide/rag/NovelRagPanel.contract.test.ts` 通过（2 files / 7 tests）。
- `bunx vitest run server/workspace-files/workspace-files.test.ts` 通过（1 file / 76 tests，workspace-files suite timeout 调整为 60s 以容纳系统 assets 同步）。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts` 通过（1 file / 69 tests，测试 helper 已切到 `calendar.ts`）。
- `bun run typecheck` 仍失败于既有 `server/agent/tools/control-tools.test.ts` 类型漂移（`UserInputFormSpec | Promise<...>` 与 content union），非本轮新增。

2026-06-22 用 ultracode 多 agent 编排实施 Phase 1-3，已落地：

### Phase 1：Reference 文档（reference/world-engine/）
- 新建 `reference/world-engine/` 模块（与 reference/plot 平级），6 个文档：
  - `README.md`（书架入口 + 核心边界）
  - `workflow.md`（写作模式整体流程、各系统职责、技术透明、两种录入模式、Leader-Writer 协作、信息控制）
  - `recording-principles.md`（最少支持当前叙事：群体角色、切片数量、按需溯源、模糊时间段、临时角色）
  - `schema-system.md`（schema/kind/op/ref/default/校验/稳定key + 典型奇幻 schema 示例）
  - `subject-lifecycle.md`（subject 注册、init slice、reduce、状态演化、回退、issues、查询契约）
  - `calendar-system.md`（Instant、纪元锚点、Calendar、`calendar.ts` 契约、时间入参边界、simple / gregorian / custom 三类策略）
- 更新 `reference/README.md`（加 world-engine 模块）、`reference/content/simulation.md`（加与 World Engine 的边界说明）、仓库根 `AGENTS.md`（文档索引加 world-engine 指引）。

### Phase 2：核心 Profile（已编译 artifact）
- `leader.default.profile.tsx`：工具集追加 8 个 `builtin.world.*`；HistorySet 用 `reference/world-engine/workflow.md` + `recording-principles.md` 替换 `reference/plot/system.md` 的 import；系统提示词新增 `# World Engine` 段（脱离 plot/simulation/director，最少支持当前叙事，两种录入模式，Leader-Writer 协作，issues 人话解释）。
- `writer.profile.tsx`：工具集追加 `builtin.world.getState` / `listSlices`（只读）；新增 `<world_engine_tools>` 段说明只读查询边界与"查询不等于授权角色越界知情"。
- `reference/agent/leader-default.md`：Writer Collaboration 段加 World Engine 协作；新增 "Writing Mode World State (World Engine)" 段；Simulator/Director 与 Writing Emulation 段标注"仅 RP 模式 / 写作模式不用"。
- `world.engine.profile.tsx`：定位维持"专用测试与维护"，未改。
- 已 `bun scripts/build/profile.ts compile` 编译 leader.default 与 writer artifact，typecheck 我改的文件零错误（仅剩 Task 62 遗留的 control-tools.test.ts 无关错误）。

### Phase 3：Skills
- 新建 `novel-workflow-world-engine-init`（**用户决定：不带序号命名**，避免与现有 04-character-design 撞号）：五步初始化流程（calendar → schema → world 锚点+初始角色 → 开局状态 → 教用户使用），全程人话引导话术。
- 改造 `novel-workflow-08-plot-planning`：保留剧情讨论协作心法与多视角方法，"simulation 因果推导"改为"World Engine 状态推导"，落库目标从 Plot 改为 World Engine，加边界声明。
- 改造 `novel-workflow-09-chapter-writing`：重写为 World Engine + Leader-Writer 协作（写作前推进 WE → 简化 brief → writer 自查写正文 → 写后检查），含 brief 简化对照表、两种协作模式。
- 轻量改造 `novel-workflow-02-project-bootstrap` / `03-lorebook-bootstrap`：衔接从 emulation(05/06) 改为 world-engine-init，补 lorebook 与 World Engine 职责边界说明。
- 一致性已校验：无残留旧名引用，写作模式 skill 仅保留"不使用 plot/simulation"的边界声明。

### 未完成 / 后续
- Phase 4（在 ming-ding-zhi-shi-2 端到端验证）：建议用户授权后做浏览器实跑。
- Phase 5（PROJECT-STATUS 更新、最佳实践文档）。
- Calendar 自定义月份增强：独立 Task 65。

---

## 目标

完成世界引擎系统的提示词工程改造，将写作工作流从旧 Plot 系统迁移到 World Engine 系统。优先支持"写作模式"，RP 模式稍后。

## 背景

World Engine (Task 56/59/61) 已完成后端、API、前端 Workbench 和独立 Preview 的开发，当前需要完成提示词层面的整合：

- 旧 Plot 系统（Thread/Scene/Plot）需要逐步废弃，转向 World Engine 的时间轴 + 切面 + subject 模型
- Agent profiles 需要更新以支持新的世界引擎工具
- Skill 需要适配新的工作流程
- 项目模板需要包含 world engine 配置
- 示范项目（命定之诗2）需要用作测试案例

## 范围

### 优先级 1：核心 Profile 更新

1. **leader.default.profile.tsx** - 主创 Agent
   - [ ] 添加 World Engine 工具（`builtin.world.*`）
   - [ ] 更新系统提示词，完全脱离 Plot/Simulation 系统
   - [ ] 添加"检查 world-engine 是否初始化"的提示
   - [ ] 设计协作模式：如何自然地引导用户使用 World Engine
   - [ ] 移除对 director 的依赖和提及

2. **writer.profile.tsx** - 正文写作 Agent  
   - [ ] **保持当前工具权限**（包括 bash 工具）
   - [ ] 更新系统提示词，说明状态信息来自 leader 的 brief
   - [ ] 说明可以通过 bash 调用 `workspace node` 等命令（如果需要）
   - [ ] 保持现有文风系统不变

3. **world.engine.profile.tsx** - 世界引擎维护
   - [ ] **定位明确**：专用测试和维护 profile
   - [ ] 用于验证 World Engine 功能、调试问题
   - [ ] 普通用户不直接接触，通过 leader 使用 World Engine

### 优先级 2：Skill 更新

所有 skill 位置：`assets/workspace/.nbook/agent/skills/`

**需要改造的 Skills（5个）**：

1. **novel-workflow-01-idea-exploration** （灵感探索）
   - [ ] ✅ 无需改动（探索阶段不涉及 World Engine）

2. **novel-workflow-02-project-bootstrap** （项目初始化）
   - [ ] 在流程末尾添加"可选初始化 World Engine"引导
   - [ ] 使用自然对话，强调"可选"和"后续可添加"
   - [ ] 提供 3-4 个时间格式模板（现代/奇幻/简单纪年/自定义）

3. **novel-workflow-03-lorebook-bootstrap** （世界书初始化）
   - [ ] 补充说明 lorebook 与 World Engine 的关系：
     - lorebook = 静态世界观、设定、规则
     - World Engine = 动态世界状态、时间线事件
   - [ ] 说明 lorebook 设定可映射到 World Engine schema

4. **novel-workflow-08-plot-planning** （剧情规划）
   - [ ] **核心改造**：将 Plot System 改为 World Engine 工作流
   - [ ] 更新为：讨论剧情 → 查询当前状态 → 设计变化 → 写入 slices
   - [ ] 保留"与用户协作"的核心理念
   - [ ] 移除对 director 和 simulation 的依赖

5. **novel-workflow-09-chapter-writing** （章节写作）
   - [ ] 状态查询改用 `get_world_state`（通过 leader）
   - [ ] 章节完成后用 `write_world_slice` 记录状态变化
   - [ ] Writer brief 结构：用自然语言描述状态，不暴露技术细节

**不改造的 Skills**：
- `novel-workflow-05-emulation-bootstrap` - 暂不改造
- `novel-workflow-06-emulation-tick` - 暂不改造
- RP 相关 skills - 暂不涉及

### 优先级 3：项目模板更新

位置：`assets/workspace/` 下的默认模板

1. **默认项目模板**
   - [ ] 已包含 `world-engine/schema.yaml` 和 `world-engine/calendar.ts`
   - [ ] 检查模板内容是否有足够的注释和示例
   - [ ] 添加 README 说明 World Engine 的使用

2. **命定之诗2 示范项目** (`workspace/ming-ding-zhi-shi-2/`)
   - [ ] 检查是否有完整的 World Engine 配置
   - [ ] 测试"写作模式"流程：
     - 初始化 World Engine
     - 创建角色 subjects
     - 设计剧情 → 写入 slices
     - 调用 writer 写正文
   - [ ] 记录测试 walkthrough

### 优先级 4：文档更新

1. **reference/agent/leader-default.md**
   - [ ] 更新为 World Engine 工作流
   - [ ] 添加 World Engine 工具使用说明

2. **新增：reference/agent/world-engine-workflow.md**
   - [ ] 写作模式完整流程
   - [ ] 常见模式和最佳实践
   - [ ] 与旧 Plot 系统的对比

3. **更新：reference/plot/system.md**
   - [ ] 标注为"逐步过渡中"
   - [ ] 说明 Plot 系统的新定位（如果保留）

## 不在范围内（明确暂缓）

基于实施策略，以下内容**明确不在本次任务范围**：

1. **RP 模式**：
   - rp.leader, rp.writer, rp.actor 等 profiles 不改动
   - RP 相关 skills 不改动
   - RP Tick 流程不改动

2. **Emulation/Simulation 系统**：
   - `novel-workflow-05-emulation-bootstrap` 不改动
   - `novel-workflow-06-emulation-tick` 不改动
   - `simulation/subjects/` 六文件结构保持现状
   - `state.md` 继续手动维护
   - simulator.leader profile 不改动

3. **旧系统移除**：
   - Plot System 保留代码，但提示词层面脱离
   - Director profile 保留代码，但当做不存在
   - 不做任何代码删除工作

4. **其他**：
   - World Engine 后端功能不增强
   - 复杂的 schema 编辑器不开发
   - UI 层面不做改进

## 关键设计决策（已确认）

### 1. Director / Plot / Simulation 系统处理

**决策**：
- **保留但不使用**：director、plot 系统、simulation 系统暂时保留代码，但在提示词层面完全脱离
- **不删除代码**：避免破坏现有项目，但新的工作流不再依赖这些系统
- **提示词策略**：在 profile 和 skill 中，当做这些系统不存在
- **未来规划**：后续评估是否需要这些系统的新定位

### 2. World Engine 完全独立

**策略**：
- World Engine 作为唯一的世界状态管理系统
- 不与旧 plot/simulation 系统产生依赖
- 所有剧情推进、状态变化都通过 World Engine slices 记录

### 3. Writer Brief 结构

**当前**：writer brief 主要包含 lorebook 引用和剧情摘要

**改进**：
- 添加 World Engine 状态引用：`<world_state at="复兴纪元488年">`
- writer 可以在写作时查询 `get_world_state` 获取实时状态
- 保持 brief 简洁，避免过度预加载

## 实施计划

### Phase 0：调研与设计
1. [x] **多角度调研**：派发 3 个 agent 从不同角度分析写作模式协作
   - ✅ 调研 1：分析现有 skills 和工作流，找出需要适配的地方
   - ✅ 调研 2：设计用户视角的理想协作流程
   - ✅ 调研 3：技术实现细节和工具使用模式
2. [x] **设计决策**：基于调研结果确定具体实施方案
3. [x] **需求补充**：补充 Calendar 增强和 Schema 引导需求

### Phase 1：Reference 文档（预计 1-2 天）
1. [ ] 创建 `reference/world-engine/calendar-system.md`
2. [ ] 创建 `reference/world-engine/schema-system.md`
3. [ ] 创建 `reference/world-engine/subject-lifecycle.md`
4. [ ] 创建 `reference/world-engine/workflow.md`
5. [ ] 更新 `reference/content/simulation.md` - 明确新职责边界
6. [ ] 更新 `AGENTS.md` - 补充 World Engine 使用规则

### Phase 2：核心 Profile 更新（预计 2-3 天）
1. 更新 leader.default.profile.tsx
2. 更新 writer.profile.tsx  
3. 评估 world.engine.profile.tsx 的定位
4. 测试基础工作流

### Phase 3：Skill 更新（预计 3-4 天）

#### 新增 Skill
1. [ ] **novel-workflow-world-engine-init**（世界引擎初始化）
   - 引导用户选择 calendar 模板
   - 从 lorebook 分析并建议 schema 调整
   - 创建 world subject（纪元锚点）
   - 创建初始角色和状态
   - 教会用户如何使用 World Engine

#### 调整现有 Skills
2. [ ] **novel-workflow-02-project-bootstrap**
   - 完成基础定位后，提示"是否初始化世界引擎"
   - 引导切换到 novel-workflow-world-engine-init

3. [ ] **novel-workflow-03-lorebook-bootstrap**
   - 补充 lorebook 与 World Engine 的关系说明

4. [ ] **novel-workflow-08-plot-planning**
   - 检查 World Engine 是否已初始化
   - 使用 `get_world_state` 查询当前状态
   - 使用 `write_world_slice` 记录状态变化

5. [ ] **novel-workflow-09-chapter-writing**
   - 章节写作前查询角色状态
   - 章节完成后记录状态变化

### Phase 4：验证测试（预计 1-2 天）
1. [ ] 在 `ming-ding-zhi-shi-2` 上测试完整流程
2. [ ] 测试场景：
   - 新用户从零开始创建项目
   - 导入 lorebook
   - 初始化 World Engine（使用新的引导流程）
   - 推进剧情并记录状态
   - 查询历史状态
3. [ ] 记录问题和改进点
4. [ ] 迭代优化

### Phase 5：文档补全（预计 1 天）
1. [ ] 编写 World Engine 最佳实践文档
2. [ ] 更新 PROJECT-STATUS.md
3. [ ] 记录 Walkthrough

## 验证标准

### 写作模式验证清单

- [ ] 用户创建新项目后，leader 会提示初始化 World Engine
- [ ] 用户可以通过 leader 设置 schema 和 calendar
- [ ] 用户可以创建角色 subjects
- [ ] 用户可以设计剧情并写入 World Engine slices
- [ ] Writer 可以读取 World Engine 状态并写正文
- [ ] 整个流程自然流畅，无需用户理解底层实现

### 技术验证清单

- [ ] 所有 profile 编译通过
- [ ] Profile catalog 测试通过
- [ ] 在 ming-ding-zhi-shi-2 上完成端到端测试
- [ ] 文档完整且准确

## 相关任务

- Task 56: World Engine 核心实现
- Task 59: Workbench Redesign  
- Task 61: Real API Integration
- Task 62: Multi pendingApprovals support

## 本次任务目标与边界

### 目标

**核心目标**：完成"写作模式"下 World Engine 的提示词工程，使用户能够自然流畅地使用 World Engine 进行小说创作。

**具体达成标准**：
1. 用户创建新项目后，能被自然引导初始化 World Engine
2. 用户能通过与 leader 对话完成剧情设计和推进
3. World Engine 的技术细节对用户透明，用户不需要理解 slice/mutation 等概念
4. Writer 能自然获取 World Engine 状态并写出符合设定的正文
5. 整个流程自然流畅，无明显断点或需要用户手动干预的技术细节

### 不在本次范围

1. RP 模式支持（后续任务）
2. Director/Plot/Simulation 系统的重构或删除
3. World Engine 后端功能增强
4. 复杂的 schema 编辑器或 UI 改进

### 验收标准

- [ ] 在 `ming-ding-zhi-shi-2` 上完成端到端测试
- [ ] 从零开始创建一个新项目，完成"灵感→世界观→剧情→正文"的完整流程
- [ ] 用户反馈流程自然，无需查阅技术文档
- [ ] 所有 profile 编译通过，catalog 测试通过

## 后续任务

- Task 65: World Engine Calendar Enhancement（自定义月份、纪元锚点）
- Task 66: RP 模式提示词工程（如果需要）
- Task 67: Simulation 系统与 World Engine 深度整合（如果需要）
- Task 68: 旧 Plot System 完全退场（如果需要）

## 相关文档

### 核心设计文档
- [phase-0-research-summary.md](phase-0-research-summary.md)：Phase 0 调研总结（3个agent调研成果）
- [world-engine-initialization-requirements.md](world-engine-initialization-requirements.md)：World Engine 初始化需求与设计（Calendar、Schema引导）
- [recording-principles.md](recording-principles.md)：World Engine 记录原则 - 最少支持当前叙事原则
- [user-scenario-tests.md](user-scenario-tests.md)：用户场景测试（场景0-4：初始化、人物设计、剧情推进、溯源）
- [user-scenario-tests-part2.md](user-scenario-tests-part2.md)：Writer协作场景测试（场景5：Writer工作流程、两种模式对比）

### 相关任务
- [docs/tasks/56-world-engine/README.md](../56-world-engine/README.md)：World Engine 后端与 API（已完成）
- [docs/tasks/59-world-engine-workbench-redesign/README.md](../59-world-engine-workbench-redesign/README.md)：Workbench UI/UX设计（已完成）
- [docs/tasks/61-world-engine-workbench-real-api/README.md](../61-world-engine-workbench-real-api/README.md)：Workbench真实API接入（已完成）
- [docs/tasks/65-world-engine-calendar-enhancement/README.md](../65-world-engine-calendar-enhancement/README.md)：Calendar 增强（新任务，不阻塞当前）
