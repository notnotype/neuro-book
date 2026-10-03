# 文件树 IDE 化重构总览

## 目标

将当前 chapter / lorebook 的数据库主存储、VFS 抽象、专用 CRUD agent tools，重构为以文件系统为主存储的 IDE 工作流。

第一版只制定基础设施与迁移路径，不要求一次性完成全部删除。实现时应按阶段推进，每个阶段都能独立 typecheck，并避免一次性超大补丁。

## 核心决策

- 文件系统是 chapter / lorebook 内容的 source of truth。
- `workspace/.nbook/` 是工作区私有配置与数据目录，第一版支持 `.nbook/icons.json` 配置文件树默认图标。
- 不再为 chapter / lorebook 保留专用创建、更新、移动、删除 agent tools。
- AI 通过 `execute_shell`、`read_file`、`write_file`、`edit_file`、`apply_patch` 操作真实文件。
- 新增脚本作为基础设施：浏览、脚手架创建、校验、可选重命名。
- 前端更像 IDE：左侧展示 `workspace/` 文件树，中间编辑文本文件，底部 detail 面板展示当前文件详情。
- `workspace/` 整体保持 VS Code 风格资源管理器；只有 `manuscript/`、`lorebook/` 下启用内容目录节点语义。
- 文件树遵守工作区根目录内的 `.gitignore`；点开头文件和目录默认可见，例如 `.agent/`、`.nbook/`。
- 如果内容目录节点内存在 `index.md`，点击目录时自动打开该 `index.md`；普通目录里的 `index.md` 只是普通文件。
- 内容根内非 `index.md` 文件都是普通文件；即使 frontmatter 存在业务 `type`，也不升级为 lorebook/chapter 节点。
- 内容节点的默认图标可由 `workspace/.nbook/icons.json` 配置；单个内容节点可用 `frontmatter.icon` 覆盖。
- 引用采用 Markdown 相对路径，不采用稳定数据库 id 或旧 URI 协议。
- 中央编辑器按文件类型分发：Markdown 使用 TipTap Markdown 适配，代码、JSON、纯文本等使用 Monaco。
- 中央工作区采用 VS Code 风格标签页，第一版只实现单编辑组，为后续分屏保留 `editor group` 扩展点。
- 编辑器工具栏必须可扩展，至少包含保存、撤销、重做、更多 `...`、Markdown 模式切换、内容节点 frontmatter 编辑入口。
- Markdown 扩展语法以语义无损为目标：引用使用 `[label](scheme://target)`；评论使用 `<comment id="..." body="...">text</comment>`；对齐块使用 `<align value="center">...</align>`。

## 不在第一版处理

- 不迁移 agent thread、checkpoint、模型设置等运行时状态。
- 不实现二进制文件编辑。
- 不实现全项目通用的复杂 frontmatter 可视化表单；只为内容节点和 lorebook 节点提供必要字段编辑。
- 不要求 plot / character 系统一次性改成文件系统。
- 不删除所有旧 spec，只处理与 chapter / lorebook / VFS 新模型冲突的规范。
- 第一版不实现真正多编辑组分屏；标签页和工具栏先按单编辑组落地。

## 阶段拆分

1. 制定文件树规范：见 `01-file-tree-spec.md`。
2. 实现脚本基础设施：见 `02-scripts-spec.md`。
3. 前端改为文件树 IDE：见 `03-frontend-refactor.md`。
4. 移除旧后端与 agent tools：见 `04-backend-tooling-removal.md`。
5. 数据迁移与验证：见 `05-migration-checklist.md`。
6. 稳定编辑器工作台：见 `06-editor-workbench.md`，负责 TipTap/Monaco/标签页/frontmatter 的组件边界与验证规则。

## 阶段 1 验收状态

阶段 1 的产物只有规范文档，不创建脚本、不改前端、不删除旧代码、不修改 `reference/` 目录。

后续阶段实现 chapter / lorebook 文件树能力时，以 `plan/01-file-tree-spec.md` 为唯一文件树规范来源。旧 lorebook / chapter / VFS 相关 reference 只能作为历史背景，不能作为新实现依据。

阶段 1 完成后，后续实现者应能直接回答：

- 如何判断目录 `index.md` 是否代表内容节点，以及非 `index.md` 文件为何只按普通文件处理。
- 点击目录时应该打开什么。
- 文件树如何排序。
- frontmatter 应如何使用。
- Markdown 相对引用如何解析。
- 第一版明确不做哪些能力。

## 成功标准

- 用户和 AI 都能通过真实文件树理解、创建、编辑 chapter / lorebook 内容。
- `workspace-ls` 能直观展示文件类型、状态、摘要和引用。
- `workspace.ts new` 能创建符合规范的文件或目录 `index.md`。
- `workspace.ts validate` 能发现断链引用和结构冲突。
- 前端能打开 `.md` 与纯文本文件；内容根目录内有 `index.md` 的目录点击后自动打开，普通目录不自动打开 `index.md`。
- 删除 chapter 面板后，中间编辑器仍可正常工作。

## Leader 提示词规划

本轮提示词工程规划 `leader.default` 中的 Shell commands、Skill、Multi-Agent、Anatomy Lorebook、Anatomy Plot System 五节。依据 GPT-5.5 提示词指南，提示词应更偏结果导向：定义目标、边界、验证与停止条件，避免把可由模型判断的过程写成冗长固定流程。

成功标准：

- 五节都能回答“何时使用、如何使用、何时停止”。
- Shell commands 明确介绍 scripts 中的工作区脚本，尤其是 `workspace-ls` 与 `workspace.ts validate`。
- Skill 与 Multi-Agent 只负责调度，不重复完整工具说明。
- Lorebook 与 Plot System 明确分工：稳定设定进入 Lorebook，剧情推进进入 Thread / Scene / Plot。
- 提示词保持短而可执行，不新增与当前工具不匹配的能力。

### Shell commands

目标：让 Leader 知道何时通过 `execute_shell` 调用仓库脚本，而不是把文件树浏览、创建和校验硬塞进专用 agent tools。

规则：

- 普通读写文件仍优先使用 `read_file`、`write_file`、`edit_file`、`apply_patch`；需要工作区级扫描、创建脚手架或结构校验时，才用 `execute_shell` 调用 scripts。
- `bun scripts/workspace-ls.ts` 用于浏览 `workspace/` 文件树，输出 mode、type、status、words、refs、path；常用于动手前了解 chapter / lorebook 结构。
- `bun scripts/workspace-ls.ts --json` 适合需要结构化读取时使用；`--type`、`--depth`、`--refs` 用于缩小扫描范围或展示引用。
- `bun scripts/workspace.ts new <target>` 用于创建符合规范的 Markdown 文件或目录 `index.md`；创建 lorebook / manuscript 内容节点时优先用它生成 frontmatter 模板。
- `bun scripts/workspace.ts validate` 用于校验 frontmatter、内容节点冲突、排序号、相对引用和图标配置；迁移、批量编辑、引用调整后应运行它。
- `workspace.ts validate` 返回 P1/P2 时视为需要处理的结构问题；如果暂时不修，最终回复必须说明原因和风险。

### Skill

目标：让 Leader 看到 skill catalog 后，只在任务确实匹配时读取或激活 skill，避免把 skill 当成默认流程。

规则：

- 用户显式输入 `$skill-name` 时，视为请求该 skill；系统已预加载的 skill 不要重复读取。
- 用户没有显式提及时，只有当任务明显匹配 catalog 描述，才读取对应 `SKILL.md`。
- skill 是可复用工作法，不是长期记忆；稳定设定仍写入 Lorebook，任务计划仍写入当前回复或 Plot System。
- skill 与用户要求冲突时，先遵守用户目标；如果冲突会影响结果或安全性，提出最小澄清问题。

### Multi-Agent

目标：让 Leader 把 subagent 当成并行执行资源，而不是把所有任务都拆给 subagent。

规则：

- 只有任务可并行、边界清晰、结果可合并时才创建 subagent。
- `subagent.writer` 负责正文草稿、改写、局部写作产出；`subagent.retrieval` 负责召回相关内容节点路径。
- Leader 必须保留最终判断权：整合 subagent 输出，检查是否符合用户目标、Lorebook 事实和 Plot System 状态。
- 如果下一步被某个信息阻塞，Leader 应优先自己用可用工具读取，不为了形式拆分。

### Anatomy Lorebook

目标：把 Lorebook 定义成小说稳定事实与创作约束的真相源，避免混入临时剧情安排。

规则：

- 写入对象包括地点、角色、规则、物品、作品定位、文风禁忌和待定问题。
- 剧情事件、场景顺序、冲突推进和伏笔回收不写入 Lorebook，除非它们已经成为后续反复引用的世界事实。
- 新增条目前先检索现有条目，避免重复路径或同义条目。
- 不确定内容使用 pending 或 note.pending-questions 表示，不把推测伪装成既定事实。

### Anatomy Plot System

目标：把 Plot System 定义成剧情推进的操作系统，用 Thread / Scene / Plot 表达从宏观线索到具体情节点的层级。

规则：

- Thread 表达长期剧情线和目标张力；Scene 表达一次可写作的场景单元；Plot 表达场景内按顺序发生的情节点。
- 前期规划优先从 Thread 开始，不为了完整性过早创建 Phase。
- 修改剧情前先读取相关树或上下文；只更新本轮任务涉及的最小对象。
- 需要正文写作时，把 Plot 转成写作约束交给 writer，而不是让 Plot 承载正文。

