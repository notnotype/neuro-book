# Agent Prompt Engineering: Simulation And Director

## User Request

- 新建一个 active task，进入新目录规范后的提示词工程阶段。
- 新建 `simulator` profile。新架构中 simulator 是写作模式和 RP 模式都会使用的 agent。
- 先调节写作模式相关 profile 和 skills，使其适配最新目录规范与 simulation / subject / entity 口径。
- 新增 `director` profile，由它管理和设计剧情。
- 新增剧情系统 spec，教需要使用剧情系统的 agent 正确使用 Thread / Scene / Plot。
- 剧情系统 prompt 需要进一步讨论和设定。
- Thread 摘要必须更长、更重要，因为 Thread 摘要是其下 Scene 的总结。
- Scene 摘要也必须非常详细；Scene 下的 Plot 数量要增多，Plot 要细化到每一个行动，而不是每个 Scene 只有 5 个左右 Plot。
- 评估当前 Plot 工具是否需要优化，特别是 Plot 是否支持批量创建。

## Goal

建立新目录规范后的 Agent 提示词工程路线图，明确 simulator / director / writer / leader / skills / Plot System spec 的职责边界，并在后续实现中逐步更新 profile、skill、reference spec 和必要的 Plot 工具。

成功标准：

- 有清晰的 task walkthrough 记录本轮 prompt engineering 目标、现状、设计假设、风险和 TODO。
- 写作模式 profile / skill 的调整范围明确，不把 RP-only 逻辑误塞进普通 writer。
- `simulator` 与 `director` 的职责边界明确。
- 剧情系统 spec 的内容要求明确，尤其是 Thread / Scene / Plot 的摘要密度和 Plot 粒度。
- Plot 工具是否需要批量创建能力有明确评估结论。

## Current State

- 最新目录规范入口是 [reference/content/project-structure.md](../../../reference/content/project-structure.md)，simulation 细节读 [reference/content/simulation.md](../../../reference/content/simulation.md)。旧 `roleplay/` 口径已经迁移到 `simulation/`。
- 写作流程参考是 [reference/agent/novel-writing-workflow.md](../../../reference/agent/novel-writing-workflow.md)。
- Plot System 当前稳定参考是 [reference/plot/system.md](../../../reference/plot/system.md)。
- 普通 `writer` profile 当前是一章节一 agent，只写 `chapterPaths[0]` 对应章节，读取 Chapter Plot 和显式 `lorebookEntries`，不维护 `simulation/`。
- `leader.default` 当前通过 `reference/agent/leader-default.md`、`reference/agent/project-workspace-guide.md` 与独立 Plot reference 获得 Simulation / Writer / Plot 协作规则。
- RP 侧现有 profiles 是 `simulator.leader`、`simulator.actor`、`rp.writer`；它们已经使用 `simulation/subjects`、`simulation/entities`、`simulation/runs` 口径。旧 `leader.rp` 已删除。
- 已新增独立 `simulator.leader` profile；写作模式和 RP 模式都可以把世界运行态、状态裁决和 subject 调度交给它。
- 已新增独立 `director` profile；剧情结构、Thread / Scene / Plot 设计和 Plot System 落库交给它。
- 第一轮角色分工已冻结：`leader.default` 退回用户助理 / 监工 / 路由器，世界运行态交给 `simulator.leader`，剧情结构交给 `director`。
- 命名暂定优先使用 `simulator.leader` 与 `simulator.actor`，让后续 `simulator.entity`、`simulator.location`、`simulator.faction` 等子 simulator 可以自然扩展在同一命名空间下。
- 当前 agent Plot 工具包含读取、单条写入和同 Scene 批量 Plot 追加：
  - `create_story_thread`
  - `update_story_thread`
  - `create_story_scene`
  - `update_story_scene`
  - `create_story_plot`
  - `create_story_plots`
  - `update_story_plot`
- `create_story_plots` 第一版只支持同一 Scene 批量追加 Plot，不做跨 Scene 批量、全量替换或局部插入。

## Frozen Role Boundary V1

核心原则：

- `leader.default` 可以包干，但 prompt 和 workflow 不鼓励它长期包干；它主要代表用户拆任务、派发、验收和解释结果。
- `simulator.leader` 是 simulation 主管，负责按 `simulation/` 规则运行世界和裁决状态。
- `director` 是剧情导演，负责 Thread / Scene / Plot 的设计、推进和落库。
- `writer` 和 `rp.writer` 只做正文渲染，不反向吞掉剧情设计或状态裁决职责。
- `retrieval` 只提供候选上下文，不替调用方做剧情、状态或正文决策。

| Profile | 定位 | 主要职责 | 不负责 |
| --- | --- | --- | --- |
| `leader.default` | 用户助理 / 总协调者 / 监工 | 理解用户目标；拆分任务；选择 specialist；监督产物质量；把 specialist 的结果解释给用户；必要时请求用户确认关键取舍 | 不长期包干 `simulation/` 推演；不长期设计 Thread / Scene / Plot；不直接写正式章节正文 |
| `simulator.leader` | 世界模拟器主管 | 根据用户、director 或 leader 的指令模拟 `simulation/`；遵循 `AGENTS.md`、`agent-context/simulator.leader/context.md`、subject/entity state 和已确认 canon；裁决状态变化；调度 `simulator.actor` 等子 simulator；产出 state commit、writer-safe brief、director handoff | 不设计长期剧情结构；不写正式正文；不把隐藏信息直接暴露给 subject-facing 输出 |
| `simulator.actor` | 单个 subject 的模拟器 | 基于 subject-facing packet、sidecar 注入的 actor-safe context 与自身 `subject.md`、`events.jsonl`、`memory.jsonl`、`mind.md`、`state.md` 模拟角色反应；返回给 `simulator.leader` | 不读取 god-view lorebook；不裁决全局世界状态；不替其它 subject 做决定 |
| `director` | 剧情导演 | 管理和设计 Thread / Scene / Plot；控制剧情节奏、冲突、伏笔、回收和推进方向；把确认后的剧情设计写入 Plot System；向 writer 提供可写的剧情结构 | 不维护 `simulation/subjects` 或 `simulation/entities` 的运行态；不写正式正文；不绕过 simulator 做世界状态裁决 |
| `writer` | 普通章节正文 writer | 根据目标章节、Chapter Plot、director/leader 提供的上下文和显式 `lorebookEntries` 写正式章节正文 | 不设计 Plot；不维护 simulation；不自行检索或吞并 director/simulator 职责 |
| `rp.writer` | legacy RP 正文渲染器 | 根据 RP / simulation brief 渲染用户可见正文 | 第一阶段保留 legacy，不急于并入普通 `writer` |
| `retrieval` | 上下文检索员 | 根据 prompt 检索 lorebook / manuscript / plot / reference 候选；后续考虑提供 Plot 读取与文件读取能力，提升学习获取能力 | 不做剧情决策；不直接写 Plot、正文或 simulation state |

### Naming Decision

优先使用 `simulator.leader`，而不是 `leader.simulator`。

原因：

- `simulator.leader` 表达它是 simulator 家族的主管，和 `simulator.actor` 形成稳定命名空间。
- 后续如果需要模拟物品、地点、势力或组织，可以继续扩展为 `simulator.entity`、`simulator.location`、`simulator.faction`。
- `leader.simulator` 更像 `leader` 家族的特化版本，容易把它重新拉回“万能 leader”的心智。

### Collaboration Flow

写作模式第一版：

1. 用户提出创作、设计或推进请求。
2. `leader.default` 判断任务类型，并决定调用 `director`、`simulator.leader`、`retrieval` 或 `writer`。
3. 需要剧情结构时，交给 `director` 设计 Thread / Scene / Plot。
4. 需要世界因果、角色反应或状态裁决时，交给 `simulator.leader`。
5. `simulator.leader` 可调用 `simulator.actor` 等子 simulator，得到 subject-facing 反应后再裁决世界变化。
6. `director` 把确认后的剧情结构写入 Plot System。
7. `writer` 按 Plot 和上下文写正式章节正文。
8. `leader.default` 验收并向用户汇报。

RP 模式第一版：

1. 用户行动进入 RP 入口。
2. RP 入口调用 `simulator.leader` 裁决世界、信息边界和 subject 可感知内容。
3. `simulator.leader` 调用 `simulator.actor` 模拟相关 subject。
4. 需要维护长期剧情线、Scene / Plot 或节奏设计时，调用 `director`。
5. `rp.writer` 根据 simulator brief 渲染用户可见正文。
6. RP 入口把正文交给用户，并等待下一 Tick。

旧 `leader.rp` 不再作为 RP 用户入口和流程壳保留；RP / simulation 入口统一使用 `simulator.leader`，避免两个 simulator leader 口径长期并存。

## Simulator / Director Profile Draft

本阶段先讨论 `simulator.leader` 与 `director` 的 profile 设计。两者都建议做成 Project-scoped specialist：创建 agent 时固定 Project Workspace / simulation root，具体任务通过每轮 `invoke_agent.message` 传入。

### `simulator.leader`

定位：世界模拟主管。它根据 `simulation/` 规则、Plot 上下文、lorebook canon、subject/entity 当前状态推进世界，必要时调度 `simulator.actor`，最后产出状态裁决、writer-safe brief 和 director handoff。

建议 input schema：

```ts
{
    projectPath: string; // 例如 workspace/silver-dragon-hime
    simulationRoot?: string; // Agent cwd-relative，例如 silver-dragon-hime/simulation/
    mode?: "writing" | "rp" | "analysis";
}
```

每轮 invoke message 承载具体任务：

- 本次要模拟什么行动、事件、章节片段、剧情方案或 RP Tick。
- 是否允许写入 `simulation/subjects/**`、`simulation/entities/**`、`simulation/runs/**`。
- 是否需要调用 `simulator.actor`。
- 是否需要产出 writer-safe brief、director handoff、Plot handoff。

建议工具权限：

- 文件工具：`read`、`write`、`edit`、`apply_patch`。
- Agent 工具：`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`。
- Plot 读取工具：`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`。
- 结束工具：`report_result`。
- 第一版不开放 Plot 写入工具；simulation 结果交给 `director` 落 Plot System，避免 simulator 抢剧情结构职责。
- 第一版不开放 `request_user_input`；需要用户裁决时通过 `report_result.open_questions` 返回给 leader。
- 第一版不开放 `bash`，除非后续需要运行专门 simulation 脚本。

建议 output schema：

```ts
{
    summary: string;
    status: "completed" | "needs_user" | "blocked";
    world_state_report: string;
    committed_files: Array<{
        path: string;
        summary: string;
    }>;
    state_change_requests: Array<{
        path: string;
        summary: string;
        reason: string;
    }>;
    subject_results: Array<{
        subjectId: string;
        visibleAction: string;
        spokenDialogue: string;
        privateIntent: string;
        emotionalState: string;
    }>;
    writer_safe_brief: string;
    director_handoff: string;
    plot_handoff: string;
    open_questions: string[];
}
```

职责边界：

- 可以读取 god-view lorebook / Plot / simulation state，但不能把隐藏信息直接发给 subject。
- 可以维护 `simulation/subjects/*/state.md`、`simulation/entities/**`、`simulation/runs/**`。
- 不直接维护 subject `events.jsonl`、`memory.jsonl`、`mind.md`；这类文件由 `simulator.actor` sidecar 或后续 subject memory 机制维护。
- 不写正式正文。
- 不设计长期 Thread / Scene / Plot；它只输出 director 可用的因果推演、状态后果和剧情机会。
- 不替用户决定核心行动；重大不可逆裁决进入 `open_questions`。

提示词结构建议：

1. Profile identity：你是 NeuroBook 的 `simulator.leader`，不是 writer、director 或用户代理。
2. Project/simulation path contract：说明 cwd、`projectPath`、`simulationRoot` 和内容节点路径规则。
3. Information boundary：GM/god-view 可读；subject-facing packet 必须过滤。
4. Simulation workflow：intake -> context read -> actor selection -> actor-facing packets -> resolve -> state commit -> handoff。
5. State write rules：什么能写 state/entity/run，什么不能写 subject events/memory/mind。
6. Output contract：必须 `report_result`，并返回 writer-safe brief / director handoff / plot handoff。

### `simulator.actor`

`simulator.actor` 是唯一 subject simulator profile。它保留 context-load / memory-save sidecar，并使用最新信息控制口径。

调整点：

- profile key 使用 `simulator.actor`；旧 actor legacy profile 已删除，不再保留 alias。
- input schema 使用 `SubjectSimulatorInputSchema`，命名上是 subject simulator，而不是 RP-only actor。
- 主 run 继续不主动读写文件；subject 文件通过 profile context 自动注入。
- context-load sidecar 负责读取和过滤 actor-safe context。
- memory-save sidecar 维护 `events.jsonl`、`memory.jsonl`、`mind.md`。
- 修正旧口径：subject-facing `memory.jsonl` 不应保留可直接展开的 lorebook Markdown link；source ref 应隐藏/internal，或由 `simulator.leader` / sidecar 过滤成 actor-safe 摘要。

### `director`

定位：剧情导演。它管理作者视角剧情结构，负责 Thread / Scene / Plot 的设计、推进、密度和落库。它可以读取 simulator 的裁决结果，但不直接维护 simulation state。

建议 input schema：

```ts
{
    projectPath: string; // 例如 workspace/silver-dragon-hime
    mode?: "writing" | "rp" | "analysis";
    defaultChapterPath?: string; // 可选，Agent cwd-relative 或 Project-relative 章节目录
}
```

每轮 invoke message 承载具体任务：

- 设计或调整哪条 Thread / Scene / Chapter。
- 是否根据 simulator handoff 更新 Plot。
- 是否创建新 Thread / Scene / Plot。
- 是否只提供方案，不落库。
- 是否需要为 writer 产出 chapter plan / writer handoff。

建议工具权限：

- 文件读取：`read`。
- Agent 工具：`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`。
- Plot 读取工具：`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`。
- Plot 写入工具：`create_story_thread`、`update_story_thread`、`create_story_scene`、`update_story_scene`、`create_story_plot`、`update_story_plot`。
- 如果第 4 步落地，加入 `create_story_plots`。
- 结束工具：`report_result`。
- 第一版不开放 `write` / `edit` / `apply_patch`，避免 director 绕过 Plot tools 写正文、lorebook 或 simulation。
- 第一版不开放 `bash`。
- 默认不直接调用 `writer`；它产出 writer handoff，由 `leader.default` 决定是否创建/调用 writer。需要世界裁决时可以调用 `simulator.leader`。

建议 output schema：

```ts
{
    summary: string;
    status: "completed" | "needs_user" | "blocked";
    plot_updates: Array<{
        kind: "thread" | "scene" | "plot";
        action: "created" | "updated" | "read" | "skipped";
        id?: string;
        title?: string;
        summary: string;
    }>;
    chapter_plan: string;
    writer_handoff: string;
    simulator_requests: string[];
    open_questions: string[];
}
```

职责边界：

- 负责剧情结构、节奏、伏笔、回收、章节承载和 Plot 密度。
- 可以写 Plot System，但不写正文。
- 可以读取 `simulation/` 的已裁决摘要或 `simulator.leader` handoff，但不直接写 `simulation/subjects/**`、`simulation/entities/**`。
- 如果剧情设计依赖尚未裁决的世界状态，先调用 `simulator.leader` 或返回 `simulator_requests`，不要自行决定隐藏状态。
- 不替用户拍板核心剧情方向；重大方向变化进入 `open_questions`。
- 不把 lorebook canon 改写成 Plot；稳定事实落定后由 leader 或专门流程同步 lorebook。

提示词结构建议：

1. Profile identity：你是 NeuroBook 的 `director`，不是 writer、simulator 或默认 leader。
2. Plot System contract：导入或内联 Thread / Scene / Plot 的 agent spec。
3. Plot density rules：Thread 摘要长、Scene 摘要细、Plot 行动级。
4. Collaboration boundary：需要状态裁决找 simulator，需要正文交给 writer/leader。
5. Tool workflow：read plot -> inspect context -> optionally ask simulator -> design -> write Plot tools -> update summaries -> report_result。
6. Output contract：返回 plot updates、chapter plan、writer handoff、open questions。

## Plot System Prompt Direction

剧情系统 spec 需要教 agent：

- Thread 是长期因果线、冲突线、成长线或承诺线。
- Thread `summary` 必须详细总结其下 Scene 的整体进展、阶段变化、关键伏笔、回收、状态变化和当前未决问题。
- Scene 是可写的一场戏或连续叙事单元。
- Scene `summary` 必须足够详细，能让未参与前文的 writer 理解这场戏发生什么、为什么发生、角色知道什么、读者知道什么、结束时状态如何变化。
- Plot 是 Scene 内部的最小行动 / 节奏点。
- Plot 不应只有 5 个左右的大纲点。对于正式写章，Plot 应细化到行动级：观察、选择、移动、对话交换、冲突升级、信息揭露、误解形成、状态变化、转折、后果。
- Plot `summary` 写具体动作和可写内容，不写空泛功能词。
- Plot `effect` 写该行动造成的因果、关系、信息、状态或节奏后果。
- Plot `writingTip` 写给 writer 的正文落实提示，不重复 summary。

### Plot System Agent Spec Draft

本阶段先写 agent-facing spec 草案，目标是让 `director`、`leader.default`、`simulator.leader` 和 `writer` 对 Thread / Scene / Plot 的职责、粒度和字段写法形成同一套心智。

#### Core Contract

- Plot System 是作者视角剧情结构系统，不是 lorebook、正文、subject knowledge 或 simulation state。
- Thread 记录长期因果线、冲突线、成长线、承诺线、伏笔线和回收线。
- Scene 记录一场可写的戏，或一个连续叙事单元。
- Plot 记录 Scene 内部的最小行动 / 节奏点，应该细到 writer 可以逐点展开正文。
- Agent 不能用空泛词代替具体行动，例如“推进关系”“制造冲突”“埋下伏笔”不能单独成为 Plot summary。

#### Thread Summary Standard

Thread `summary` 是其下 Scene 的滚动总摘要，是跨章节、跨 agent 传递长期剧情记忆的核心字段。

推荐密度：

- 新建草案 Thread：至少写清目标、当前矛盾、参与方、已知信息、未决问题。
- 已包含多个 Scene 的 Thread：应更新为长摘要，优先覆盖所有关键 Scene 的阶段变化、冲突升级、伏笔投放、伏笔回收、角色关系变化、信息差变化和当前悬而未决的问题。
- 对主线 Thread，`summary` 可以很长；不要为了短而丢掉 Scene 级因果。

Thread `summary` 应包含：

- 这条线在讲什么，以及它为什么重要。
- 当前阶段处于哪里，之前发生了哪些关键 Scene。
- 每个关键 Scene 对这条线造成了什么改变。
- 读者知道什么，关键角色知道什么，不知道什么。
- 已投放的伏笔、已回收的伏笔、仍未回收的伏笔。
- 当前状态、下一步压力、可能的剧情方向。

Thread `writingTip` 只写长期写作注意事项，例如主题气质、节奏边界、冲突呈现方式、回收时机，不重复 `summary`。

#### Scene Summary Standard

Scene `summary` 是给未参与前文的 writer / director / leader 看的详细场景记录。

推荐密度：

- Scene `summary` 不能只是“三人发生争执并埋下伏笔”。
- 它应详细到另一个 agent 只读 Scene + Plot，就能知道这场戏发生什么、为什么发生、谁做了什么、谁知道什么、读者知道什么、结尾状态如何变化。
- 对关键 Scene，摘要应该明显长于普通大纲段落，允许记录完整因果链。

Scene `summary` 应包含：

- 场景开始时的前置状态：地点、时间、参与角色、目标、压力、隐藏条件。
- 场景内部主要行动链：角色观察、移动、选择、对话、试探、冲突、揭露、误解、转折。
- 信息状态：哪些信息被角色获得，哪些只被读者知道，哪些仍是作者视角隐藏信息。
- simulation 结果：角色状态、物品状态、位置、关系、承诺、危险、倒计时等变化。
- 场景结尾：谁处于什么状态，下一场戏自然接什么压力或机会。

Scene `purpose` 写这场戏在剧情结构中的功能，例如“让主角第一次主动违抗学院命令，并把女主的信任推进到可冒险合作”。

Scene `writingTip` 写正文落实建议，例如 POV、情绪曲线、节奏、对白密度、动作描写重点、哪些信息要明说或压住，不重复 `summary`。

#### Plot Granularity Standard

Plot 是行动级节拍，不是五段式大纲。

建议数量：

- 普通 Scene：8 到 16 个 Plot。
- 关键 Scene：16 到 30 个 Plot。
- 高密度对话、战斗、推理、误会、情感爆发、RP Tick 转正文时，可以更多。
- 如果一个 Scene 只有 5 个左右 Plot，通常说明粒度太粗，除非这场戏极短。

建议把数量作为 prompt-level recommendation / warning threshold，而不是第一版数据库硬校验。原因是短过渡 Scene、章节收束 Scene 和作者临时草案可能合理少于推荐值；真正需要强约束的是“不能用空泛功能词伪装 Plot”。

| Scene 类型 | 推荐 Plot 数 | 粒度标准 |
| --- | --- | --- |
| 短过渡 Scene | 4 到 8 | 只承载移动、时间跳转、简单交接或短反应；即使短，也要写清可见行动和后果。 |
| 普通 Scene | 8 到 16 | 每个 Plot 对应一个可写行动、反应、选择、信息交换、状态变化或小转折。 |
| 关键 Scene | 16 到 30 | 冲突、情绪、信息揭露、误解形成、关系变化、伏笔投放/回收应拆成多个节拍。 |
| 高密度对话 Scene | 16 到 30+ | 不按每句台词拆，而按“试探、回避、追问、承认、反击、沉默、误解、让步”等对话功能变化拆。 |
| 战斗 / 追逐 Scene | 16 到 30+ | 按攻防选择、位置变化、资源消耗、伤势、战术误判、逆转、代价拆，不写成“双方激烈战斗”。 |
| 推理 / 调查 Scene | 16 到 30+ | 按观察、假设、排除、证据发现、误导、验证、结论变化拆。 |
| RP Tick 转正文 | 8 到 24+ | 按用户行动、simulation 裁决、subject 反应、信息注入、状态变化、writer 展现节拍拆。 |

合格 Plot 应满足：

- 一条 Plot 只承载一个主要行动、发现、选择、交换、反应、转折或结果。
- Plot `summary` 写可见动作和可写内容，最好能直接变成 1 到数个正文段落。
- Plot `effect` 写该节拍造成的后果：因果推进、信息变化、关系变化、状态变化、节奏变化、伏笔投放或回收。
- Plot `writingTip` 写给 writer 的落地提示：视角、语气、节奏、动作/对白比例、感官重点、潜台词、需要避免的明说。

不合格 Plot 示例：

- “推进男女主关系。”
- “发生冲突。”
- “揭露真相。”
- “埋伏笔。”

合格 Plot 示例：

- `summary`：女主接过五彩石后没有立刻收下，而是先用袖口隔着触碰，确认石头会随她的呼吸产生微弱共鸣。
- `effect`：女主意识到这不是普通宝石，但仍不知道它是世界之心碎片；她对主角的警惕从怀疑转为谨慎求证。
- `writingTip`：用细小动作写警惕，不要让女主直接说破神器身份；对白保持试探感。

拆分规则：

- 如果一个 Plot 同时包含“角色行动 + 他人反应 + 新信息揭露 + 状态改变”，通常应拆成 2 到 4 个 Plot。
- 如果两个 Plot 的 `effect` 完全相同，且正文只能写成同一小段，可以合并。
- 如果一个 Plot 只能写成一句功能性说明，通常太抽象，应继续下钻到可见行动。
- 如果一个 Plot 会导致关系、位置、物品、知识、危险、承诺或节奏发生变化，应在 `effect` 中明确写出变化。

字段判定：

| 字段 | 应写什么 | 不应写什么 |
| --- | --- | --- |
| `summary` | 具体发生的可见行动、对话交换、发现、选择或转折 | “推进剧情”“制造冲突”“铺垫后文”等功能性概括 |
| `effect` | 这一步造成的因果、关系、信息、状态、节奏、伏笔变化 | 重复 `summary`，或只写“气氛紧张” |
| `writingTip` | 给正文 writer 的表现建议：视角、节奏、潜台词、感官、对白/动作比例 | 继续补剧情设计，或复制 `summary/effect` |

#### Update Discipline

- 创建或重写 Scene Plot 后，应同步更新 Scene `summary`，否则 Scene 摘要会落后于 Plot。
- Scene 有新增、删除、重排或关键状态变化后，应同步更新所属 Thread `summary`。
- `director` 落库前应先确认 Plot 细度，不要把功能性大纲直接写入 Plot System。
- 第一版暂不加入“writer 遇到 Plot 太粗时必须退回 leader / director”的硬提醒；只在角色边界中保留 writer 不主动接管 Plot 设计的原则。

## Plot Tool Assessment

初步观察：

- `server/agent/tools/plot-tools.ts` 目前只有单个 `create_story_plot`。
- `server/plot/services/plot.service.ts` 有批量重排情节点能力，但不是批量创建。
- `server/plot/services/plot.service.ts` 的 `createStoryPlot` 已经会锁定同一 Scene 的 Plot 排序桶，并自动追加下一个 `sortOrder`。
- `server/plot/facade/plot.facade.ts` 的单条 `createStoryPlot` 已经在事务内执行，并处理 `summary` / `effect` / `writingTip` / `note` 文本字段。
- 当前 `reorderStoryPlots` 是全量覆盖式重排，不适合作为“新建一批细 Plot”的 agent 入口。
- 如果 director 要把一个 Scene 拆成 12 到 30 个 action-level Plot，逐个调用 `create_story_plot` 会很慢、容易中断，也增加排序错误风险。

候选优化：

- 新增 `create_story_plots`：一次为同一 `sceneId` 创建多个 Plot。
- 输入包含 `projectPath`、可选 `sceneId`、`plots[]`。
- 每个 plot 包含 `kind`、`summary`、可选 `effect`、`writingTip`、`note`。
- 工具按数组顺序追加到当前 Scene 末尾。
- 返回创建后的 plot 列表，并刷新 `plot.selection` 到最后创建的 plot 或所属 scene。
- 第一版建议只支持同一 `sceneId` 批量创建，降低跨 Scene 排序和错误回滚复杂度。
- `create_story_plot` 当前允许 `summary` 为空；第一版 `create_story_plots` 建议把 `summary` 设为必填非空。单条 `create_story_plot` 是否同步改成必填，后续实现时再决定。

后续待讨论：

- 是否需要支持 `replace_scene_plots`，用于把某个 Scene 的 Plot 全量重写；不进入第一版。
- 批量创建是否要允许跨多个 Scene；不进入第一版。
- 是否需要新增 `update_story_plots` 或 `replace_story_scene_plots`，用于 director 一次性重排和精修整场 Scene。
- 是否需要让批量工具返回 Scene detail，方便 agent 立刻看到创建后的完整 Plot 顺序。

### Create Story Plots V1 Candidate

建议第一版新增 agent-facing 工具 `create_story_plots`。

目标：

- 让 `director` 能一次为同一 Scene 创建 8 到 30 个行动级 Plot。
- 降低连续调用 `create_story_plot` 的 token 成本、排序风险和中途失败风险。
- 保持工具范围窄，不做跨 Scene 批量、不做全量替换、不做删除。

输入草案：

```ts
{
    projectPath: string;
    sceneId?: string; // 省略时使用 plot.selection selected scene
    plots: Array<{
        kind: "setup" | "action" | "conflict" | "despair" | "relief" | "reward" | "mystery" | "reveal" | "twist" | "payoff" | "result";
        summary: string; // V1 建议必填非空
        effect?: string | null;
        writingTip?: string | null;
        note?: string | null;
    }>;
}
```

行为草案：

- 只允许同一 `sceneId`；每个 plot item 不允许单独指定 `sceneId`。
- `plots` 按数组顺序追加到当前 Scene 末尾。
- 第一版不支持显式 `sortOrder`，避免 agent 误以为可以局部插入或覆盖现有顺序；需要重排时另走 reorder 工具或后续批量更新工具。
- 建议 `plots` 限制 `minItems: 1`，`maxItems` 可先设为 50，覆盖高密度 Scene，同时防止误创建超大批次。
- 整批创建应在一个 transaction 内完成；任意一条校验失败则整批失败，不留下部分 Plot。
- 工具返回创建后的 `plots` 列表；更推荐返回最新 Scene detail 或 `{scene, createdPlots}`，方便 agent 立刻看到完整顺序。
- `plot.selection` 更新为所属 Scene；当前 selection 没有 plotId 字段，暂不引入 selected plot。

实现草案：

- 在 `server/agent/tools/plot-tools.ts` 增加 `CreateStoryPlotsSchema` 和 `create_story_plots` tool。
- 在 `server/plot/facade/plot.facade.ts` 增加 `createStoryPlots(projectPath, input)`，复用现有 `runInTransaction`。
- 在 `server/plot/services/plot.service.ts` 可新增 `createStoryPlots`，内部锁定 Scene 排序桶后按顺序创建，避免每条重复锁；也可以第一版先在 facade 事务中循环调用现有 `plotService.createStoryPlot`，但专用 service 方法更清晰。
- 在 DTO / parser 层补 `CreateStoryPlotsRequestDto` 和解析函数。

暂不做：

- 跨 Scene 批量创建。
- `replace_scene_plots` / `replace_story_scene_plots`。
- 批量删除。
- 批量跨 Scene 移动。
- 局部插入到指定 `sortOrder`。

验证建议：

- 单元测试：同一 Scene 批量创建后 `sortOrder` 连续追加。
- 单元测试：中间输入非法时事务不留下部分 Plot。
- Agent tool 测试：`sceneId` 省略时能使用 `plot.selection`，返回结果能看到创建顺序。
- Schema 测试：`summary` 为空时拒绝，`plots` 为空时拒绝。

## Prompt Engineering Scope

第一批需要复核或修改：

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx`
- `assets/workspace/.nbook/agent/skills/novel-workflow-05-emulation-bootstrap/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-06-emulation-tick/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-08-plot-planning/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md`
- `reference/agent/leader-default.md`
- `reference/agent/project-workspace-guide.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/plot/system.md`

Resolved mismatch:

- `simulator.actor` prompt 已修正：subject memory 不应新增可直接展开的 lorebook Markdown link；需要来源时使用经过 GM / sidecar 过滤的 subject-facing 摘要，内部 source ref 交给 simulator leader / sidecar 管理。

## Implementation V1

本轮已从设计推进到第一版落地：

- 稳定 Plot agent 规范已迁移到 [reference/plot/agent-spec.md](../../../reference/plot/agent-spec.md)，并由 [reference/plot/system.md](../../../reference/plot/system.md) 链接。
- `create_story_plots` 已进入 DTO、parser、service、facade 和 agent tool 层，支持同一 Scene 批量追加 1 到 50 个 Plot。
- `leader.default` 的工具白名单已包含 `create_story_plots`，并通过 reference 文档学习 simulator / director 协作边界。
- 新增 `simulator.leader` builtin profile：负责 simulation 裁决、subject 调度、state commit 建议、writer-safe brief、director handoff 和 plot handoff；第一版不开放 Plot 写入工具。
- 新增 `director` builtin profile：负责 Thread / Scene / Plot 设计和落库，允许 Plot 读写工具和 `create_story_plots`，不开放 `write` / `edit` / `apply_patch` / `bash`。
- subject simulator 实现已 inline 回 `simulator.actor.profile.tsx`，`simulator.actor` 是唯一运行 profile；旧 actor legacy profile 已删除。
- 写作 workflow skills `05` / `06` / `08` / `09` 已更新到 `simulator.leader` / `director` / `simulation/` 口径。
- `reference/agent/leader-default.md`、`reference/agent/project-workspace-guide.md`、`reference/agent/novel-writing-workflow.md` 已同步新职责边界。
- system builtin profiles 已全量重新编译，并重新生成 `.system-profile-metadata.json`。

## Implementation V2: Simulator Entry Convergence

本轮按新的 simulator profile 口径继续收敛：

- 删除 `leader.rp` builtin profile、compiled artifact 和 `LeaderRp*` contracts；RP / simulation 入口统一使用 `simulator.leader`。
- `simulator.leader` input schema 删除 `mode`；写作、RP、全自动或半自动模式由每轮 prompt 指定。
- `simulator.leader` prompt 强化读取顺序：先遵守 `AGENTS.md` 与 `agent-context/simulator.leader/context.md`，冲突时以 `AGENTS.md` 为准；再按需读取最近 tick、相关 lorebook、Plot 和 state。
- `simulator.leader` 负责持有和调度 emulator；为需要模拟的 subject 创建或复用 `simulator.actor`，并逐个发送 actor-facing packet。
- 新建 subject / entity 默认先通过 `open_questions` 或 `state_change_requests` 报告，获批后再创建；明确全自动下一 tick 时可以直接推进但必须报告提交内容。
- `simulator.actor` 主 run 不再直接读取 `subject.md`、`events.jsonl`、`memory.jsonl`、`mind.md`、`state.md` 原文；这些文件只由 context-load / memory-save sidecar 使用。
- `simulator.actor` 主 run 只消费 actor binding 元数据、`<actor_sidecar_context>` 和 GM 当前消息，并新增角色视角标签协议。
- user-assets 覆盖层中的旧 `workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx` 与 sync state 残留已删除，避免 catalog 继续暴露旧 RP 入口。

## Open Issues / Risks

- `simulator.leader` 第一版需要 `write` / `edit` / `apply_patch` 维护 simulation state，但当前工具没有 profile 内路径 scope；只能先靠提示词边界限制写入 `simulation/subjects/*/state.md`、`simulation/entities/**`、`simulation/runs/**`。后续如果 Harness 支持工具路径 scope，应把它变成 runtime 级约束。
- `director` 第一版不直接调用 `writer`，避免职责扩大；如果后续要做全自动章节生产链，需要重新讨论 director -> writer 的直接调用边界。
- `simulator.actor` 已作为唯一 subject simulator profile 落地，`leader.rp` 与 `simulator.leader` 均调度该 profile。
- `simulator.actor` 已禁止在 subject memory 中新增可直接展开的 lorebook Markdown link；后续如果需要保留 source ref，需要设计内部 source ref 的稳定格式。
- `create_story_plots` V1 只支持同一 Scene 追加；如果 director 后续需要整场重写、局部插入或批量精修，还需要讨论 `replace_scene_plots` / `update_story_plots`。
- Plot System Agent Spec 已迁移到 `reference/plot/agent-spec.md`；后续风险是实际写作时摘要密度和 Plot 数量可能需要继续调参。
- 写作 workflow skill 文件名仍保留 `novel-workflow-05-emulation-bootstrap` / `06-emulation-tick` 旧名；正文口径已统一到 `simulation` / `simulator`，是否改文件名留到后续迁移。

## Decisions

- 新规范入口使用 `reference/content/project-structure.md`，simulation 细节使用 `reference/content/simulation.md`。
- 不新建 `emulation/` 目录；写作模式中的世界运行态仍落在 `simulation/`。
- 普通 `writer` 继续不维护 `simulation/`。
- `director` 负责剧情结构和 Plot System，`simulator` 负责世界状态与因果推演，两者需要分工。
- `leader.default` 是用户助理、监工和路由器，避免继续承担长期 simulation、Plot 设计和正式正文写作。
- 新 simulator profile 命名优先采用 `simulator.leader`，subject simulator 使用 `simulator.actor`。
- `rp.writer` 第一阶段保留 legacy 名称和职责，暂不并入普通 `writer`。
- `retrieval` 继续保持上下文检索员定位，后续评估增强 Plot 读取与文件读取能力。
- Plot 粒度标准第一版按 Scene 类型给出推荐数量和 warning threshold，不做数据库硬校验；重点约束 Plot 必须是可写行动 / 信息交换 / 转折 / 后果。
- Plot 工具改造第一版建议新增 `create_story_plots`，限定为同一 Scene 批量追加多个 Plot；暂不做跨 Scene 批量、全量替换和局部插入。
- `simulator.leader` 第一版负责 world simulation、state 裁决、actor 调度和 handoff，不写 Plot System。
- `director` 第一版负责 Thread / Scene / Plot 设计和落库，不写 simulation state，也不直接调用 writer。

## Files Changed

- `docs/tasks/36-agent-prompt-engineering-simulation-director/README.md`
- `reference/plot/agent-spec.md`
- `reference/plot/README.md`
- `reference/plot/system.md`
- `reference/agent/leader-default.md`
- `reference/agent/project-workspace-guide.md`
- `reference/agent/novel-writing-workflow.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-05-emulation-bootstrap/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-06-emulation-tick/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-08-plot-planning/SKILL.md`
- `assets/workspace/.nbook/agent/skills/novel-workflow-09-chapter-writing/SKILL.md`
- `shared/dto/plot.dto.ts`
- `server/plot/core/types.ts`
- `server/plot/http/plot-input.parser.ts`
- `server/plot/services/plot.service.ts`
- `server/plot/facade/plot.facade.ts`
- `server/agent/tools/plot-tools.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/simulator.leader.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/*`
- `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
- `server/plot/services/plot.service.test.ts`
- `server/agent/tools/plot-tools.test.ts`
- `server/agent/profiles/rp-profiles.test.ts`
- `server/agent/profiles/simulation-director-profiles.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `PROJECT-STATUS.md`

## Verification

- 已阅读 `reference/content/project-structure.md` 和 `reference/content/simulation.md`。
- 已阅读 `reference/agent/novel-writing-workflow.md`。
- 已阅读 `reference/plot/system.md`。
- 已检查 `leader.default`、`leader.rp`、`simulator.actor`、`rp.writer`、`writer` profile 的当前提示词入口。
- 实现前已检查 `server/agent/tools/plot-tools.ts`，确认 agent-facing Plot 工具缺少批量创建能力；本轮随后补齐 `create_story_plots`。
- 已在 `PROJECT-STATUS.md` Recent Tasks 中登记本 task。
- 已冻结第一版角色分工：`leader.default` / `simulator.leader` / `simulator.actor` / `director` / `writer` / `rp.writer` / `retrieval`。
- 已起草 Plot System Agent Spec 讨论稿，明确 Thread 摘要、Scene 摘要、Plot 行动级粒度与字段写法。
- 已补充 Plot 粒度标准讨论稿，包含 Scene 类型、推荐 Plot 数、拆分/合并规则和字段判定表。
- 已评估 Plot 工具改造，建议第一版新增同一 Scene 的 `create_story_plots` agent-facing 工具。
- 已起草 `simulator.leader` 与 `director` profile 设计，包含 input schema、工具权限、输出合同和提示词结构。
- 已实现 `create_story_plots`，并用 service / agent tool 测试覆盖批量追加、summary 非空校验和 project-scoped `plot.selection`。
- 已新增并编译 `simulator.leader`、`director`、`simulator.actor`。
- 已运行 `bun scripts/build/profile.ts check builtin/simulator.leader.profile.tsx --system`。
- 已运行 `bun scripts/build/profile.ts check builtin/director.profile.tsx --system`。
- 已运行 `bun scripts/build/profile.ts check builtin/simulator.actor.profile.tsx --system`。
- 已运行 `bun scripts/build/profile.ts compile builtin/simulator.leader.profile.tsx --system --all`，成功生成 12 个 system profile artifact。
- 已运行 `bun run profile:metadata`，成功准备 12 个 system profile metadata。
- 已运行 `bunx vitest run server/plot/services/plot.service.test.ts server/agent/tools/plot-tools.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts`，5 个测试文件、26 个用例通过。

### V2 Verification

- 已运行 `bun scripts/build/profile.ts check builtin/simulator.leader.profile.tsx --system`，通过。
- 已运行 `bun scripts/build/profile.ts check builtin/simulator.actor.profile.tsx --system`，通过。
- 已运行 `bun scripts/build/profile.ts check builtin/rp.writer.profile.tsx --system`，通过。
- 已运行 `bun scripts/build/profile.ts compile builtin/simulator.leader.profile.tsx --system --all`，成功生成 10 个 system profile artifact，列表不含 `leader.rp`。
- 已运行 `bun run profile:metadata`，成功准备 10 个 system profile，compiled stale 为 0。
- 已运行 `bun scripts/build/profile.ts compile --all`，成功重建 user-assets profile compiled manifest，列表不含 `leader.rp`。
- 已运行 `bunx vitest run server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/rp-profiles.test.ts server/workspace-files/workspace-files.test.ts`，3 个测试文件、77 个用例通过。
- 已运行 active source / template / user-assets 搜索审计：`leader.rp` 只剩 `PROJECT-STATUS.md` 当前状态说明、`reference/content/simulation.md` removed legacy 说明、`rp-profiles.test.ts` 负断言。
- 未通过：`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`。该文件当前卡在既有 harness 异步测试超时（单跑 `parallel 工具会并发执行...` 仍在 10 秒超时）；本轮未继续用扩大 timeout 方式处理，留作独立 Harness 测试稳定性问题。

### Final Completion Audit

- 角色分工：已由 `Frozen Role Boundary V1`、`reference/agent/leader-default.md`、`reference/agent/project-workspace-guide.md` 和 `reference/agent/novel-writing-workflow.md` 覆盖。
- Plot System Agent Spec：已迁移到 `reference/plot/agent-spec.md`，并由 `reference/plot/system.md` 链接；Thread 长摘要、Scene 详细摘要、Plot 行动级粒度、`summary/effect/writingTip` 写法和批量创建规则均已写入稳定参考。
- `create_story_plots`：已进入 DTO、parser、service、facade、agent tool 和 `leader.default` tool catalog 测试；V1 范围限定为同一 Scene 批量追加。
- `simulator.leader` / `director` / `simulator.actor`：source profile、compiled artifact、system metadata 和 profile tests 均已覆盖。
- 写作 workflow skills：`05` / `06` / `08` / `09` 已同步新口径；旧文件名保留为后续迁移事项，不阻塞 V1。
- 本 task 的当前实现范围已完成；TODO / Follow-ups 记录的是 V1 之后的 spike、迁移和第二版工具讨论，不作为本轮完成阻塞。

## TODO / Follow-ups

- 用真实写作任务 spike `leader.default -> simulator.leader -> director -> writer` 链路，观察 handoff 字段是否足够。
- 继续讨论 `replace_scene_plots` / `update_story_plots` 是否需要进入第二版工具。
- 后续 Harness 如果支持 profile 工具路径 scope，应把 `simulator.leader` 的 simulation 写入边界从提示词约束升级为 runtime 约束。
- 评估 `retrieval` 是否需要读取 Plot / 文件工具，以支持更强的剧情上下文检索。
