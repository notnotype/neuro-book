---
name: novel-writer-execution
description: Writer 执行手册：收到 brief 后的详细执行流程、决策点、常见陷阱。Writer profile 内部参考，不由 leader 直接调用。
when_to_use: Writer profile 内部参考文档，说明 writer 收到 invoke_agent 调用后的实际执行流程和决策逻辑。
---

# Writer 执行手册

本文档是 writer profile 的执行流程参考，说明 writer 收到 brief 后如何一步步完成写作任务。

## 执行流程

Writer 是 ReAct 子代理，完整流程为：「加载上下文 → 查证世界状态 → 叙事设计 → 信息隔离检查 → 写入正文 → 报告」

> 当前 writer 处于 **autonomous（自主全知）模式**：拥有 Plot 只读、World Engine 只读、lorebook 读能力，自己查证设定与状态。brief 只给框架与查询提示，不含可查询状态。

### 第一步：理解任务边界

收到 `invoke_agent` 调用后，首先检查：

1. **input.path**：本轮唯一写入目标，必须是当前Project Workspace相对路径，例如`manuscript/001-chapter/index.md`。
2. **input.chapterId**（可选）：本章 StoryChapter id。有它时用 `get_chapter_writer_brief({projectPath, chapterId})` 自取本章 brief（章节目标、信息控制、剧情点、查询提示、建议读取），作为写作依据。
3. **input.context.lorebookEntries**：调用方建议读取的内容节点路径清单（目录路径，结尾带 `/`）。
4. **message (brief)**：本章目标、关键剧情点、信息控制约束、World Engine 查询提示。缺 input.chapterId 时以 message 的 brief 为准。

如果 `input.path` 缺失，停止写入并通过 `report_result.result` 要求调用方补充。

---

### 第二步：加载必要上下文

1. **读取目标文件**：
   - 如果 `input.path` 指向的文件已存在，先用 `read` 读取原文（润色或续写时的基础）。
   - 如果文件不存在，准备新建。

2. **自取 / 消费 brief**：
   - 有 `input.chapterId` 时用 `get_chapter_writer_brief` 自取;需要场景与线索用 `get_story_chapter` / `get_story_scene_context`;brief 的「本章 Promise 任务」「未决决策警告」段需要核对详情（如某条线的 payoffExpectation、某条未决决策的候选方案）时用 `get_story_promise` / `get_story_decision`;剧情设计权仍在 leader，你**只读 Plot，不创建/修改任何 Plot 实体**（Thread / Scene / Chapter / Promise / Decision）。
   - 如果 brief status 不是 `ready`（例如 `needs_chapter_brief` 信息控制未填），在 `report_result.result` 里点明缺口，不要硬写。

3. **按需读取 lorebook**：
   - `input.context.lorebookEntries` 与 brief 的「建议读取」只是建议清单，不是任务正文，也不是必须全部读取的材料。
   - 按 brief 任务判断需要哪些设定，优先读取节点 `index.md`，必要时读取同级 `state.md`。
   - 不要机械读取全部清单——10 个节点不代表都要读。

4. **不读取其他 profile 的 context memory**：
   - 不要读取 `agents/leader.default/context.md`、`agents/simulator.leader/context.md` 等其他 profile 的上下文记忆。
   - 需要额外设定时，依赖调用方在 message 中给出的 writer-safe 信息或 `input.context.lorebookEntries`。

---

### 第三步：查证世界状态

**关键步骤**：按 brief 的查询提示，用 readonly `execute_world` 查相关 subject（角色 / 地点 / 势力）在本章时间点的真实状态（位置、HP、心理、持有物、关系等）。

操作要点：

1. **brief 按简化原则只给剧情框架**，不含可查询的状态细节（如 HP / 位置）；这些状态由你自己查证，不要当作 brief 遗漏。

2. **时间用项目日历字符串**，例如「公元2020年4月12日 18:00」。

3. **使用 CodeAct 沙盒查询**：
   - `world.subject.get(id)` 查单个 subject
   - `world.subject.list(type)` 列出某类型所有 subject（如 `"character"`）
   - `world.subject.gets(ids)` 批量查询
   - `world.slice.list(options)` 查询相关时间线切面
   - 示例见下方代码块

4. **记住查询边界**：
   - 这是上帝视角真值源。你能查到角色的真实状态，但在某个角色视角的叙述里**不能让该角色"知道"他不该知道的设定**（见信息控制原则）。
   - 查询服务于写作一致性，不等于授权角色越界知情。

示例：

```javascript
// 查询角色状态
const erina = await world.subject.get("erina");
const liya = await world.subject.get("liya");

// 或列出所有角色
const characters = await world.subject.list("character");
```

---

### 第四步：叙事设计

在脑内构思本章结构：

1. **场景结构**：起始、节拍、转折、收束。
2. **信息披露**：哪些设定本次显现、哪些保留。
3. **剧情覆盖度**：检查是否漏了必须的剧情点。

---

### 第五步：信息控制三层隔离（核心步骤）

对每个出场角色明确：

- **角色视角**：该角色知道什么、不知道什么、误解什么。
- **读者视角**：哪些信息可以让读者知道但角色不知道（伏笔、暗示）。
- **作者视角**：你从设定中知道但不能写进正文的信息。

不要因为设定在 lorebook 里，就默认角色都知道。

---

### 第六步：角色表现设计

为每个主要角色设计具体表现方式：

- 用动作、互动、台词、环境选择表达情绪。
- 不用"很悲伤""很愤怒"等标签。

---

### 第七步：写入成稿

1. **用 `write` 写入 `input.path`**（保留 project-slug 前缀）。
2. **遵循约束**：
   - `<writing_style>`：文风要求
   - `<avoid_words>`：禁用词汇与句式
   - `<paragraph_rhythm>`：段落节奏
   - `<narrative_person>`：人称默认
3. **严格控制视角边界**：不让角色知道他们不该知道的信息。

---

### 第八步：报告落点

调用 `report_result`：

- **result**：已写入路径、润色情况、约 100 字剧情总结。
- **data**：默认不填；除非调用方明确需要结构化结果。
- **不输出**：写作分析、草稿过程或自查清单。

成功调用 `report_result` 后，对话会自动结束。

---

## 常见陷阱

### 陷阱 1：把 brief 当作完整状态源

❌ **错误**：brief 没说角色位置，就不写位置或凭想象写。
✓ **正确**：用 `execute_world` 查询角色当前位置。

**原因**：brief 按简化原则只给剧情框架，可查询的状态细节由你自己查证。

---

### 陷阱 2：让角色知道不该知道的信息

❌ **错误**：lorebook 里有设定（如"莉雅是被封印的神明"），就让场内所有角色都理解或反应出这个事实。
✓ **正确**：按 `frontmatter.knowledge[]` 控制每个角色的认知边界。薇洛丝不知道莉雅真实身份，那她的言行、心理描写都不能流露"知道对方是神明"的信息。

**原因**：lorebook 是全知视角（作者 / AI 说明书），不是角色共享情报。

---

### 陷阱 3：机械读取所有 lorebookEntries

❌ **错误**：`input.context.lorebookEntries` 传了 10 个节点，就全读。
✓ **正确**：按 brief 任务判断需要哪些，只读必要的。

**原因**：lorebookEntries 是建议清单，不是强制阅读材料；盲目全读浪费 token 且可能引入无关信息。

---

### 陷阱 4：忘记查询 World Engine

❌ **错误**：凭 brief 想象角色状态（"brief 没说，我猜角色应该在城门口"）。
✓ **正确**：先查 readonly `execute_world`，再写正文。

**原因**：写作前 leader 已经把世界状态推进好，你查到的永远是一致的真值。

---

### 陷阱 5：读取其他 profile 的 context memory

❌ **错误**：主动读取 `agents/leader.default/context.md` 或 `agents/simulator.leader/context.md`。
✓ **正确**：只读 `agents/writer/context.md` 和 `agents/writer/generated.md`，且只有任务明确要求整理或采纳这些推荐时才读取。

**原因**：不同 profile 的上下文记忆是隔离的；越界读取会引入不属于 writer 的职责范围的信息。

---

## 决策流程图

```
收到 brief
  ↓
input.path 存在？
  ├─ 是 → read 原文
  └─ 否 → 准备新建
  ↓
brief 有查询提示？
  ├─ 是 → execute_world 查状态
  └─ 否 → 判断是否需要主动查
  ↓
需要设定？
  ├─ 是 → 按需读 lorebookEntries
  └─ 否 → 直接写
  ↓
信息控制检查
  ↓
write 正文
  ↓
report_result
```

---

## 关于自由发挥

**默认情况下**：你按 brief 写作、不新增超出范围的关键设定（世界状态已由 leader 在写作前推进好）。

**只有当 brief 明确授权你自由发挥剧情细节时**，你才可以新增角色、改变受伤程度或使用未预设能力——但你是只读的，这些新增并不会进入 World Engine。

此时必须在 `report_result.result` 里明确点出"本轮新增 / 改动了哪些尚未登记到 World Engine 的角色或状态"，交给 leader 事后补回。

**不要**声称自己写入或推进了 World Engine——你没有写入权限。

---

## 完成标准

- 正文已写入 `input.path` 指定的文件。
- 剧情点全部覆盖。
- 角色视角与信息边界没有越界。
- 已通过 `report_result` 报告写入路径与剧情摘要。
