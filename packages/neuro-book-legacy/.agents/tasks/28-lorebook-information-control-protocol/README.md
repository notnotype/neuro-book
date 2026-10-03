# NeuroBook Directory Protocol Task

2026-06-06 update: 本任务中的早期 `simulation/simulator.md`、`simulation/cast.yaml` 说法已经被 profile context V2 取代。当前稳定合同见 `reference/content/simulation.md` 与 `reference/agent/profile-context-memory.md`：profile guidance 位于 Project root `agent-context/`，`simulation/` 只保存 `subjects/`、`entities/` 和 `runs/`。

## User Request

- 新建 `Lorebook Information Control Protocol` 任务。
- 第一步先设计内容类型层：基于当前 novel lorebook 模板、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` 的大型 worldbook 条目，找到一套通用、常用、不过度碎片化的 lorebook 类型划分。
- 协议目标是支持“信息分离控制”的 lorebook 条目，而不是像普通 lorebook 一样只写上帝视角全文。
- 协议正文应写给 AI 和作者使用，不长期留在 task walkthrough 里。
- 后续扩展为 NeuroBook 目录规范：不仅规范 `lorebook/`，也规范 `.nbook`、`simulation/`、subject 信息控制和 entity 状态实例。
- `roleplay/` 之前版本更接近“世界模拟”功能；当前目标目录名硬切为 `simulation/`，不保留 `roleplay/` 模板兼容。
- `gm.md` 目标改名为 `simulator.md`。
- 角色不放进泛化 `entities/`，而是作为信息控制主体放入 `simulation/subjects/`；`entities/` 用于物品、地点、机关、事件进程等有状态实例。

## Outcome

协议正文已迁出 task walkthrough，进入稳定内容规范：

- [../../../reference/content/directory-protocol.md](../../../reference/content/directory-protocol.md)
- [../../../reference/content/information-control.md](../../../reference/content/information-control.md)

流程压力测试和 RP 示例记录在：

- [roleplay-flow-examples.md](roleplay-flow-examples.md)

本 task 只保留需求、决策摘要、变更记录和后续 TODO。

## Decisions

- 文档从 `Lorebook Information Control Protocol` 扩展为 `NeuroBook Directory Protocol`。
- `lorebook/` 定位为无状态 canonical / god-view 的作品说明书，保存类型、原型、规则和全知 canon。
- 新增目标 `simulation/` 世界模拟层，用于写作和 RP 共用的模拟、状态和信息控制。
- `simulation/simulator.md` 取代旧 `roleplay/gm.md`，表示 simulator leader 的运行协议。
- `simulation/subjects/` 用于信息控制主体，例如角色、玩家、可拟人化势力。
- `simulation/entities/` 用于有状态实例，例如物品、地点、机关、事件进程。
- `simulation/runs/` 用于运行过程和 Tick 产物。
- `roleplay/` 不再作为目标目录；旧 Project Workspace 需要手动迁移或后续迁移工具。
- 基础建模模式采用 `Prototype / Instance + Event Sourcing + Subject-facing View`：lorebook 记录原型和规则，entity 只在需要状态追踪时实例化，events 记录来源流水，knowledge / subject-facing state 控制主体可见信息。
- 引用路径不是可见性授权；subject state 可以引用 lorebook prototype 或 entity，但 subject 能知道什么只由 `events.jsonl`、`memory.jsonl`、subject-facing `state.md` 和 simulator 过滤输入决定。
- 普通、无差异、无隐藏状态的物品不实例化；出现独立状态、隐藏真相、唯一性、持有人差异、进度、损坏或剧情重要性时才建立 entity。
- `.nbook/` 定位为系统、运行时、模板和配置资产，不保存作品正文设定。
- 第一版只收敛目录层、内容类型层、subject 信息控制层和 entity 状态层；信息控制 frontmatter、正文分区和 GraphRAG 边后续再设计。
- 默认顶层目录为 `world / character / location / faction / item / event / system`，外加 `lorebook/index.md`。
- 支持扩展类型 `species / creature / organization / instruction`，但不默认生成顶层目录。
- 不再把 `relationship`、`rule`、`note`、`formatting`、`dynamic-mvu`、`dynamic-prompt` 作为稳定 lorebook 协议类型。
- 当前兼容 `reference/content/state.md` 的 lorebook 同级 `state.md`；但 subject 主观状态和 entity 当前状态不再新增到 lorebook，后续逐步减少并迁出 lorebook 下的动态状态。
- 现有 `roleplay/actors/{actor-id}/` 旧目录应迁移到 `simulation/subjects/{subject-id}/`，由 `simulation/cast.yaml` 引用。
- `instruction` 作为作品级 AI 使用说明继续保留，并细分为 `style / narration / boundary / disclosure / retrieval / formatting / continuity` 等推荐 subtype。
- 信息控制模型暂不展开 schema，只保留后续设计入口。

## Follow-ups

- 设计 lorebook information control frontmatter schema。
- 设计正文分区规范，例如 `Public Canon`、`Subject Safe Summary`、`Simulator Secrets`、`Writer Notes`。
- 更新 workspace-files lorebook type 校验，支持默认类型和受支持扩展类型，移除 `rule` / `note` 作为正式协议类型的长期目标。
- 已被当前 lorebook template cleanup 取代：默认模板保留 `lorebook/index.md`、`note/story-concept/`、`note/project-profile/`、`note/opening-seed/` 和 `instruction/creation-boundaries/`，不再生成 `rule/`、`synopsis/`、`project-positioning/`、`theme/`、`initial-plot-seed/`、`writing-style/`。
- 继续增强 `simulation/` 模板和 `simulation/simulator.md`，补齐 subject / entity 协议细节。
- 评估是否需要旧 `roleplay/actors/{actor-id}/` 到 `simulation/subjects/{subject-id}/` 的迁移工具。
- 新增 `simulation/entities/{entity-id}/` 模板，用于有状态物品、地点、机关和事件进程。
- 更新 `project-directory-templates`，继续让 `cast.yaml` 引用 `simulation/subjects/{subject-id}/...` 和 `simulation/entities/{entity-id}/...`。
- 继续复核 `rp.leader`、`simulator.leader`、`simulator.actor`、`rp.writer` 和相关 skill 文档中的 simulation / subject / entity 路径合同；旧文档里的 `leader.rp` 只作为历史名称理解。
- 更新 SillyTavern 导入映射：`event -> lorebook/event`，`system -> lorebook/system`，世界规则进入 `world/rule`，种族/组织/生物按项目目录策略进入默认子目录或提升目录。
- 后续逐步迁出 lorebook 同级 `state.md`，并复核 writer 读取同级 `state.md` 的合同。
- 设计 prototype / subject / entity / event relation 的最小 schema。
- 为 subject context-load sidecar 设计基于 knowledge declaration 的过滤策略。
- 为 GraphRAG 设计 `who knows what` 的边类型和知识层级。

## Files Changed

- `docs/tasks/28-lorebook-information-control-protocol/README.md`
- `reference/content/directory-protocol.md`
- `reference/content/information-control.md`
- `reference/README.md`
- `PROJECT-STATUS.md`
- `docs/tasks/28-lorebook-information-control-protocol/roleplay-flow-examples.md`

## Verification

- 已阅读当前 novel lorebook template、workspace-files lorebook type 校验、SillyTavern 导入分类，以及 `命定之诗与黄昏之歌` worldbook 条目样本。
- 本次只更新设计文档，未运行代码测试。
