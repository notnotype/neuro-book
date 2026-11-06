# 各家 code agent 的 Agent 模式与权限设计（2026-11-06）

- 问题：omp、OpenAI Codex CLI、Claude Code 怎样设计“Agent 模式（plan、讨论）”和“权限（审批、沙箱、工具规则）”；供 [t28](../tasks/t28-conversation-ui-followups/plan.md) 批 6 和 [t06 决定 1 到 3](../tasks/t06-approval/README.md) 对照。
- 做法：主调研代理读本机 omp 源码、Codex 官方仓库浅克隆、Claude Code 官方文档与 changelog。只用一手来源，不预设哪种设计对。
- 证据等级：**源码**为读过原文（给文件与行号）；**文档**为官方文档页面原文；**二进制字符串**为本机 Claude Code 2.1.318 的 `strings` 输出（Claude Code 不开源，只能旁证提示词原文，不能证明逻辑）；**issue/changelog**为官方仓库条目；**推断**为从代码得出、没在真实运行时复现；**未查到**为没找到。
- 来源缩写：
  - `OMP/` = `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`（包版本 18.14.1，本机可执行文件 18.15.0，两者差一个小版本，行号以包内源码为准）。
  - `CODEX/` = 官方仓库 `openai/codex` 的 `codex-rs/`，浅克隆提交 `2f02d8461`（2026-11-06 拉取）。
  - Claude Code 文档在 2026-11-06 抓取。`developers.openai.com/codex/*` 已 308 跳转到 `learn.chatgpt.com/docs/*`，下文写跳转后的地址。

## 1. 总表

| 产品 | 维度数 | plan 的限制方式 | 全部放行下 plan 的行为 | 退出批准 | shell 规则 |
|---|---|---|---|---|---|
| omp | 2 个独立维度：plan 开关（另有 goal、vibe 等互斥模式）；审批模式 4 档（默认 `yolo`）加按工具的 allow/prompt/deny 与 `bash.patterns`。无 OS 沙箱 | **写文件硬拦截 + 提示词**：`write`/`edit` 在工具内部拒绝工作区写入，只放行 `local://`；**bash 不拦**，只靠提示词（推断）。子代理在 plan 下工具集收窄为只读四件 | 不影响 plan 的写拦截（拦截在工具内部、在审批之前）；bash 在 `yolo` 下不弹窗，所以 plan 里的 shell 实际没有限制（推断） | 模型**不能**自己进入；退出只能向 `xd://propose` 写 slug，用户在评审界面选：执行（清上下文）、压缩后执行、保留上下文执行、保存退出、继续改；另有执行模型滑块。**不选审批模式** | 有序通配符规则 `bash.patterns`（allow/prompt/deny）；allow 只对不含 shell 控制符的整条命令生效，deny/prompt 按分段匹配；无只读命令清单；“本会话都批准”按工具加档位，不按命令 |
| Codex | 4 个独立维度：协作模式（Default/Plan）、审批策略、沙箱模式（或权限配置）、审批者（用户/自动评审）。`/permissions` 的只读沙箱是官方推荐的“聊天或规划不改东西”的办法 | **只有提示词**，加两处工具层约束：Plan 下 `update_plan` 调用报错；`request_user_input` 工具说明写“只在 Plan 可用”（Default 下调用报错，除非开 feature）。没有拦截写文件或 shell 的代码，issue 里有“Plan 下改了文件”的报告 | 无交互：plan 与审批、沙箱互不感知，plan 下的 shell 与写文件按普通模式的审批和沙箱走 | 模型不能进入或退出；用户 Shift+Tab 或 `/plan` 切换。模型在回复里输出 `<proposed_plan>` 块，TUI 弹“Implement this plan?”：直接实现（切 Default，发“Implement the plan.”）、清上下文后实现（新线程，把计划正文放进首条消息）、留在 Plan。**不选审批和沙箱** | 前缀规则 `.rules`（Starlark，allow/prompt/forbidden，最严者胜）；`bash -lc` 用 tree-sitter 拆开纯单词的 `&&` `\|\|` `;` `\|` 链，逐段判；其余当整条；没有只读命令清单，没匹配时看“审批策略加沙箱”；`allow` 规则的命令在沙箱外跑 |
| Claude Code | 1 个“权限模式”维度承载全部（default/acceptEdits/plan/auto/dontAsk/bypassPermissions），另有与之正交的规则（allow/ask/deny）和 OS 沙箱 | **硬拦截为主 + 提示词**：plan 下编辑被拦到批准；shell 超出内置只读集要审批（或交分类器）；计划文件豁免。同时注入提示词要求只读。**例外**：交互终端且启用了 bypass 时不执行拦截，只靠提示词 | bypass 可用的交互终端里 plan 的拦截**不生效**（文档明说，只剩“被指示不要编辑”）；`-p`、Agent SDK、VS Code 聊天面板里仍拦；deny 规则始终生效 | 模型**可以**调 `EnterPlanMode`（无需批准）；退出用 `ExitPlanMode`（要用户批准，从计划文件读正文）；批准时选后续权限模式：auto/自动接受编辑/BYPASS、手动批准编辑、继续规划，另有可选的“清上下文” | 规则 `Bash(前缀 *)` 通配；识别 `&& \|\| ; \| \|& &` 和换行，每段都要允许；剥掉固定包装命令；有内置只读命令清单；“不再询问”写整条或前缀规则到 `.claude/settings.local.json`；文档明说规则不是安全边界 |

## 2. omp

### 2.1 有几个维度、怎样切换

- **模式**：plan 是一个布尔状态 `PlanModeState{enabled, planFilePath, workflow, reentry}`（`OMP/plan-mode/state.ts:1-6`）。plan、goal、vibe 互斥，进一个要先退另一个（`OMP/modes/interactive-mode.ts:5751-5758`）。vibe 的斜杠命令说明写“read-only toolset”（`OMP/slash-commands/builtin-modes.ts:319`），其语义本次未读。
- **权限**：是另一组设置，不属于模式。
  - 审批模式 `tools.approvalMode`：`always-ask`（只自动放行读档）、`always-ask-cached`（读写文件也问，可按文件或目录记住）、`write`（放行读与写档，执行档弹窗）、`yolo`（全放行），**默认 `yolo`**（`OMP/tools/approval.ts:43`、`OMP/tools/settings.ts:313-318`）。
  - 按工具的 `tools.approval.<工具名>: allow|prompt|deny`（`OMP/tools/settings.ts:294-305`）；`tools.restrictedFolders`（列出的目录里每次操作都弹窗，任何模式都不豁免，`OMP/tools/settings.ts:354-372`）。
  - 每个工具自己声明档位 `read|write|exec`，可按参数动态声明（`OMP/tools/approval.ts:131-136`，`OMP/tools/bash.ts:517`）。
- **切换入口**：
  - plan：`/plan [提示]` 斜杠命令（`OMP/slash-commands/builtin-modes.ts:277-304`）；快捷键 `app.plan.toggle`，默认 Alt+Shift+P（`pi-tui/src/app-keybindings.ts:261-263`，issue #16721 报告该和弦在部分终端不可达）；设置 `plan.enabled`、`plan.defaultOnStartup`、`plan.autosave`、`plan.autosaveDir`（`OMP/plan-mode/settings.ts`）；启动参数 `--plan-yolo`（强制 plan，模型第一次提交时自动批准并切到实现模型，`OMP/commands/launch-help.ts:36-40`）。
  - 审批模式：设置项与启动参数 `--approval-mode`（`OMP/commands/launch-help.ts:133-136`）、`--auto-approve`；**会话内切换的斜杠命令：未查到**（`slash-commands/` 下 grep `approval`、`yolo`、`perm` 零命中）。
- **会话级还是全局**：plan 状态是会话内状态，写入会话日志 `appendModeChange("plan", …)`（`OMP/modes/interactive-mode.ts:5828`），恢复会话时会按日志重进（`OMP/modes/interactive-mode.ts:5722` 附近的 `#enterPlanMode({planFilePath, preserveRestoredModel})`）。审批模式来自全局或项目设置加命令行覆盖。

### 2.2 plan 怎样限制

- **写文件：硬拦截在工具里。** `enforcePlanModeWrite` 在 plan 开启时：禁止改名（`Plan mode: renaming files is not allowed.`）、禁止删除，写目标不在 `local://` 沙箱根下就抛 `ToolError`，提示写 `local://<slug>-plan.md`（`OMP/tools/plan-mode-guard.ts:129-151`）。`write` 工具在多个分支里调用它（`OMP/tools/write.ts:994,1030,1064,1081`）；`edit` 通过 `planActive`、`planWritableRoots` 传给编辑器（`OMP/edit/index.ts:667-669`）。判定用真实路径解析（含符号链接、`/tmp` 与 `/private/tmp` 之类），只认 `local://` 这类声明了 `sandbox` 范围的协议的根（`OMP/tools/plan-mode-guard.ts:80-106`；`OMP/internal-urls/router.ts:371-377`）。
- **计划文件和临时目录**：计划文件是 `local://<slug>-plan.md`。`local://` 的根是会话产物目录下的 `local/`，没有产物目录时退回 `os.tmpdir()/omp-local/<会话>`（`OMP/internal-urls/local-protocol.ts:240-251`）。对 `local://` 的写在审批里按 `read` 档，不弹窗（`OMP/internal-urls/local-protocol.ts:464-473`）。任意的系统临时目录（如 `/tmp/x`）不在沙箱根里，`write` 会被拒；bash 可以写（见下）。
- **shell：不硬拦。** plan 开启时 `bash` 仍在工具集里（`#enterPlanMode` 保留进入前的全部工具并补上 `write`，`OMP/modes/interactive-mode.ts:5764-5784`）；`tools/bash.ts`、`tools/approval.ts` 里没有读 plan 状态（grep `getPlanModeState` 在 `tools/` 下只出现在 `ask.ts`、`plan-mode-guard.ts`、`acp-bridge.ts`、`index.ts`）。限制只在提示词：“NEVER run state-changing commands (`git commit`, `npm install`, migrations)”（`OMP/prompts/system/plan-mode-active.md:3`）。**只读 shell 的判定：没有**。（推断：未在真实运行时复现。）`ast_edit` 是否经过同一守卫：未查到调用点（`enforcePlanModeWrite` 只在 `tools/write.ts` 与守卫文件里出现）。
- **子代理**：plan 下派生的子代理被换成固定只读工具集 `read, grep, glob, web_search`（加原本有的 `ast_grep`），系统提示词前缀是 `plan-mode-subagent.md`；禁止 eval 自定义工具、隔离与合并控制（`OMP/task/structured-subagent.ts:227,259-268,270-285`；`OMP/prompts/system/plan-mode-subagent.md`）。
- **其它副作用**：plan 下 `ask` 工具取消超时（`OMP/tools/ask.ts:755-758`）；todo 跟踪、autolearn、prewalk 自动模式在 plan 下停用（`OMP/session/todo-tracker.ts:167,205,235,333`，`OMP/autolearn/controller.ts:117-118`，`OMP/session/prewalk.ts:246`）；进入 plan 时可切换到 `plan` 角色的模型，退出恢复（`OMP/plan-mode/model-transition.ts`）。

### 2.3 模式与权限怎样叠加

- plan 的写拦截在 `write`/`edit` 执行体内，与审批解析无关，所以 **`yolo` 不能让 plan 下的 `write` 写进工作区**。
- 反过来，`yolo` 是默认值，bash 档位是 `exec`，`yolo` 下直接放行（`OMP/tools/approval.ts:437-453`）；所以默认配置下 plan 里的 shell 只受提示词约束（推断）。
- 审批模式不被 plan 改写；进入时保存工具展示、退出时还原（`OMP/modes/interactive-mode.ts:5775-5780,6560-6570`）。

### 2.4 进出 plan 与计划怎样带到实现

- **进入**：只有用户（斜杠命令、快捷键、设置、启动参数）。模型没有进入工具（`enter_plan`、`EnterPlan` 在 `src/` 下 grep 零命中）。
- **退出，模型一侧**：没有 `exit_plan_mode` 工具。提示词要求“approval ONLY via `xd://propose` write”：用 `write` 工具把 slug 当纯文本写到 `xd://propose`，slug 要与 `local://<slug>-plan.md` 对应；禁止用文字或 `ask` 请求批准（`OMP/prompts/system/plan-mode-active.md:3-10`；`OMP/tools/resolve.ts:16,42-60,275-300`）。这个“propose”设备由 plan 模式安装处理器，否则报 `No plan is awaiting approval`（`OMP/tools/resolve.ts:285-290`）。`docs/research/agent-runtime-references.md` 第 104 行列的 `exit_plan_mode` 是旧形状，当前源码已无。
- **收敛压力**：一轮结束既没调 `ask` 也没写 `xd://propose`、也没有其它工具调用时，系统追加一条 developer 消息并把下一次 `tool_choice` 设为 `required`，最多 3 次（`OMP/session/agent-session.ts:601,12188-12240`；`OMP/prompts/system/plan-mode-tool-decision-reminder.md`）。
- **用户批准**：评审界面选项（`OMP/modes/interactive-mode.ts:7483-7500,7636`）：
  - “Approve and execute”：清空上下文，新开会话，复制 `local://` 产物并把计划写进新会话（`OMP/modes/interactive-mode.ts:6540-6548`）；
  - “Approve and compact context”：用 `plan-mode-compact-instructions.md` 压缩后在原会话执行；
  - “Approve and keep context”：保留历史执行；
  - “Save and quit”：存到所选路径并结束；
  - “Refine plan”：附反馈继续规划；
  - 另有执行模型“滑块”（按角色档选执行用的模型，`OMP/modes/interactive-mode.ts:7650-7676`）；评审界面里可内联编辑计划、做批注。
  - **没有“批准后选审批模式”这一项**：批准后恢复进入前的工具展示，审批模式不变。
- **退出后的模式**：`setPlanModeState(undefined)`，回到普通模式。用户再按 `/plan` 且草稿非空会先确认；“paused”状态下再按一次才真正关闭（`OMP/modes/interactive-mode.ts:6733-6760`）。
- **计划内容怎样带到实现**：同时用两路。
  - 一条合成用户消息（`plan-mode-approved.md`），正文**内联**整份计划，同时给出 `local://` 的持久路径，并要求“NEVER re-read … while the inline plan is intact”（`OMP/prompts/system/plan-mode-approved.md`；`OMP/modes/interactive-mode.ts:6640-6700`）。
  - 之后历史被改写（新会话、压缩、编辑）时，`#buildPlanReferenceMessage` 重新读取计划文件，作为 `plan-mode-reference` 消息再注入（`OMP/session/agent-session.ts:7846-7870`，`OMP/prompts/system/plan-mode-reference.md`）；压缩时保护对计划文件的 `read` 结果（`OMP/plan-mode/plan-protection.ts`）；子代理派生时也把计划带过去（`OMP/plan-mode/plan-handoff.ts`）。

### 2.5 给模型的提示词怎样变

- plan 提示词是一条 `customType: "plan-mode-context"` 的自定义消息（`display:false`），**不在系统提示词里**（`OMP/session/agent-session.ts:7872-7907`）。
- 在**每次 `prompt()` 调用**时都重新构造并放进消息数组：计划参考消息、plan 消息、goal 消息、vibe 消息，依次排在用户消息之前（`OMP/session/agent-session.ts:8855-8870`）。也就是每个用户回合都带一份完整的 plan 提示词（含工作流、计划内容规范，约 120 行）。若进入 plan 时会话正在流式输出，用 `steer` 方式即时送入（`OMP/modes/interactive-mode.ts:5815-5817`）。
- **工具集**：进入时若 `write` 不是顶层工具，会被补进来（它是 `xd://propose` 的传输通道）；工具集变化会触发系统提示词重建（`OMP/session/session-tools.ts:1385-1440`）。源码注释写明“plan mode changes the system prompt, which predictably invalidates the cache”（`OMP/modes/interactive-mode.ts` 进入 plan 处）。退出时恢复原工具展示，同样可能重建。
- 切换通知：进入靠上面的 plan 消息；退出靠合成的“Plan approved”消息；用户直接 `/plan` 关闭（不批准）时本次未查到发给模型的通知。

### 2.6 讨论、问答类只读模式

- 没有专门的“讨论”模式。vibe 声明“read-only toolset”（语义本次未读）；`/btw` 是“Ask a side question”（`OMP/slash-commands/builtin-lifecycle.ts:476-488`）。
- plan 本身被当讨论用：提示词要求 plan 里用 `ask` 做访谈（`plan-mode-active.md` 的 Workflow 两节）。
- 官方仓库有 issue #2195 “/read-only slash command for discussion/exploration sessions”（open），说明当前没有。

### 2.7 已知问题和改过的设计

- 扩展提供的同名 `write` 工具会让 plan 提交死循环（issue #14030、#16574）：18.11.2 起 plan 下把扩展的 `write` 从工具集里去掉并警告（`CHANGELOG.md` 18.11.2；`OMP/modes/interactive-mode.ts:5779-5785`）。
- `plan.defaultOnStartup` 被 `/new` 忽略（#15627，18.11.0 修）；启动即进 plan 的会话里扩展工具消失（#17085，18.13.2 修）。
- 允许“没有 `write` 的 Agent 也能写 `local://`（plan 外），工作区写入仍拦”（18.8.7，`CHANGELOG.md`）。
- 开放中的 issue：#17800（agent 写完计划但从不提交，评审界面不出现；2026-11-02，18.15.0）；#9736（希望“提交评审”不要只限 plan 模式）；#15239（评审里改计划不要回到聊天）；#10484（批准后用当前模型）；#15060（风险上限式自治档位与审批模式并列）；#6995 “Plan mode is broken”（本次未读正文）。

## 3. Codex

### 3.1 有几个维度、怎样切换

- **协作模式**：`ModeKind{Plan, Default}`，TUI 可见的只有这两个（`CODEX/protocol/src/config_types.rs:674-695`）。协作模式带 `{model, reasoning_effort, developer_instructions}`（`config_types.rs:707-712,785-805`）；内置预设里 Plan 把推理强度设为 Medium，Default 不设（`CODEX/models-manager/src/collaboration_mode_presets.rs:6-25`）；配置项 `plan_mode_reasoning_effort` 可覆盖（`CODEX/tui/src/chatwidget/settings.rs:731-736`）。
- **审批策略** `AskForApproval`：`untrusted`（内部：规则外的命令都问）、`on-request`（默认，模型自己决定何时问）、`granular{…}`（分类开关：沙箱升级、规则、skill、`request_permissions`、MCP 征询）、`never`（`CODEX/protocol/src/protocol.rs:1163-1203`）。官方文档说 `untrusted` 已不再支持（`learn.chatgpt.com/docs/agent-approvals-security`）。
- **沙箱模式** `SandboxMode`：`read-only`、`workspace-write`、`danger-full-access`（`config_types.rs:104-114`）；另有命名权限配置 `default_permissions`（`CODEX/config/src/config_toml.rs:241`）。
- **审批者** `ApprovalsReviewer`：`user`、`auto_review`（子代理先评审，`config_types.rs:178-190`）。
- 官方预设：`Auto` = `--sandbox workspace-write --ask-for-approval on-request`；完全访问 = `--sandbox danger-full-access` 或 `--dangerously-bypass-approvals-and-sandbox`（`--yolo`）（官方文档 agent-approvals-security）。
- **切换入口**：协作模式用 Shift+Tab 循环（`CODEX/tui/src/chatwidget/interaction.rs:350-362`，键位表 `CODEX/tui/src/keymap.rs:2821-2824`）与 `/plan`（`slash_command.rs:141`，官方文档“Toggle plan mode for multi-step planning”，`learn.chatgpt.com/docs/reference/slash-commands`）；审批与沙箱用 `/permissions`、启动参数 `--sandbox`、`--ask-for-approval`、`config.toml` 的 `approval_policy`、`sandbox_mode`。
- **会话级还是全局**：协作模式是线程设置，随每回合的 `override_turn_context` 提交（`CODEX/tui/src/chatwidget/settings.rs:772-790`），可随线程恢复（app-server 有 `thread_resume` 测试，`persisted_resume_settings_tests.rs`）；审批与沙箱有配置文件层，也可在会话中改。

### 3.2 plan 怎样限制

- **提示词为主。** Plan 模板规定“You must not perform mutating actions”，列出允许（读、搜索、静态分析、会写缓存或构建产物但不改仓库跟踪文件的测试与构建）与不允许（编辑文件、会改写文件的格式化、打补丁、迁移、带副作用的命令），并写“When in doubt: if the action would reasonably be described as 'doing the work' … do not do it”（`CODEX/collaboration-mode-templates/templates/plan.md:13-31`）。
- **工具层只有两处与 Plan 相关的硬条件**（`ModeKind::Plan` 在非测试代码里的全部使用点，grep 核实，其余是 UI 与分析统计）：
  1. `update_plan`（清单工具）在 Plan 下调用即返回错误“not allowed in Plan mode”（`CODEX/core/src/tools/handlers/plan.rs:87-91`）。
  2. `request_user_input`：`allows_request_user_input` 只对 Plan 为真（`config_types.rs:698-700`）；工具说明写“only available in Plan mode”，在 Default 调用返回 “unavailable in Default mode”，除非打开 feature `default_mode_request_user_input`（默认关，`CODEX/core/src/tools/handlers/request_user_input_spec.rs:91-103,176-181`；`CODEX/features/src/lib.rs:2065-2070`）；Plan 下问题是阻塞式的（`is_blocking`，`request_user_input.rs:80-84`）。
  3. 自动触发的回合（`TurnStartKind::Automatic`）不能进入或离开 Plan（`CODEX/core/src/session/turn_input.rs:78-98`）；goal 扩展在 Plan 下不计时（`CODEX/ext/goal/src/accounting.rs:108`）。
- **没有**拦截 shell 或 `apply_patch` 的 Plan 分支：执行器、`safety.rs`、`exec_policy.rs` 都不读协作模式。结果是 Plan 下的写文件、shell 只受普通的审批与沙箱约束。官方仓库 issue #32594 “Agent violated plan mode restrictions and made changes to files”（open，0.144.1，评论里有人说 0.145.0 仍在改文件，并建议“Plan 应是执行层的权限，不是要模型自觉遵守的指令”）。
- **只读 shell 判定**：没有为 Plan 做的判定。要硬只读，官方文档的办法是切到只读沙箱：“If you want to chat or plan without making changes, switch to `read-only` mode with the `/permissions` command.”（`learn.chatgpt.com/docs/agent-approvals-security`）。
- **计划文件**：没有。计划是回复里的 `<proposed_plan>…</proposed_plan>` 块（`plan.md:73-92`），由流式解析成 plan 项（协议事件 `PlanDelta`，`CODEX/docs/protocol_v1.md:78`）。因此“放行写计划文件”“临时目录能不能写”这两问在 Codex 里不存在对应物；临时目录能否写取决于沙箱配置，Plan 不改它。

### 3.3 模式与权限怎样叠加

- 两者互不感知（上面核实的使用点里没有交叉）。Plan 下开 `danger-full-access` 加 `never`，模型被提示词要求只读，但没有任何机制阻止它改文件。反过来 Plan 下用只读沙箱，写会被沙箱拒绝，与是否在 Plan 无关。
- hooks 的 `permission_mode` 字段在 Plan 回合里报的是审批策略而不是 `plan`（issue #42881，open，0.153.2）：说明 Plan 在 hook 层没有对应的权限模式值。

### 3.4 进出 plan

- 模型不能进入或退出，没有对应工具；模板明说“Your active mode changes only when new developer instructions with a different `<collaboration_mode>` change it; user requests or tool descriptions do not change mode by themselves”（`CODEX/collaboration-mode-templates/templates/default.md:5`），Plan 模板：“Plan Mode is not changed by user intent, tone, or imperative language. If a user asks for execution while still in Plan Mode, treat it as a request to plan the execution”（`plan.md:7-9`）。
- 用户批准：模型输出 `<proposed_plan>` 后，TUI 弹“Implement this plan?”（`CODEX/tui/src/chatwidget/plan_implementation.rs:9-13,73-110`，触发点 `turn_runtime.rs:224`）：
  - “Yes, implement this plan”：切到 Default 预设并发用户消息“Implement the plan.”（计划留在原上下文里）；
  - “Yes, clear context and implement”：清掉界面与上下文，新线程首条消息是固定前缀加计划 Markdown 全文；
  - “No, stay in Plan mode”。
  - 没有“批准同时选审批模式或沙箱”的选项。
- 退出后回到 Default（预设）；issue #10185（Plan 切回 Default 后模型仍自称在 Plan）、#40049（空输入框按 Backspace、取消实现弹窗按 Esc 会意外切到 Default）、#23341（点实现后卡在 Plan，open）。
- 计划内容进实现：靠对话历史（选“直接实现”）或把正文放进首条消息（选“清上下文”）；没有计划文件、没有压缩路径。

### 3.5 给模型的提示词怎样变

- 协作模式指令是 `developer` 角色的一段，用 `<collaboration_mode>` 标签包住，作为“世界状态”的一节追加到历史里，**不在系统提示词里**（`CODEX/core/src/context/world_state/collaboration_mode.rs:14-60,141-170`；标签常量 `COLLABORATION_MODE_OPEN_TAG`）。
- **只在变化时发**：每回合比较快照（模式、模型、指令哈希），相同则不发（`render_diff`，`collaboration_mode.rs:107-139`）。所以是“进入时一次、切换时一次”，不是每轮提醒；Default 也有一段文字，开头写“Any previous instructions for other modes (e.g. Plan mode) are no longer active.”（`default.md:3`），用来在切回时覆盖 Plan 指令。
- **工具集**：`request_user_input` 的注册由 feature 决定，不随模式增减（`CODEX/core/src/tools/spec_plan.rs:1351`、`CODEX/tools/src/tool_config.rs:6`）；`update_plan` 一直在，只是 Plan 下调用报错。所以切换不改变工具定义（推断），前缀缓存不因此失效。目录下有 `core/tests/suite/prompt_caching.rs` 与 `model_visible_layout.rs` 覆盖相关布局，本次未读。

### 3.6 讨论、问答类只读模式

- 没有“讨论”协作模式（只有 Default、Plan）。官方做法是用权限维度：`/permissions` 切 `read-only`（见上）。
- Default 的提示词偏向“少问多做”：“strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions”（`default.md:11`）；Plan 则要求“Bias toward questions over guessing”（`plan.md:35`）。差别只在提示词。

### 3.7 已知问题和改过的设计

- 上面已列：#32594（Plan 下改了文件）、#42881（hook 看不到 plan）、#10185、#40049、#23341、#50493（侧聊保持了父线程的 Plan，open）。
- 功能请求：#19343、#13206（Plan 专用模型配置）、#20596（实现前换模型）。
- 设计变化（从代码与文档看出，未查到发布说明）：`approval_policy = "untrusted"` 文档已写不再支持，代码里仍保留为内部策略（`protocol.rs:1163-1169` 的注释）；`ModeKind` 里 `code`、`pair_programming`、`execute`、`custom` 都折叠成 `Default`（`config_types.rs:678-683`），说明早期有更多模式。

## 4. Claude Code

### 4.1 有几个维度、怎样切换

- **权限模式**是唯一一个“模式”维度，plan 是其中一个值（`default`（界面叫 Manual）、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`），官方表格列出每个值“不问就能做什么”（`https://code.claude.com/docs/en/permission-modes`）。
- 与之**正交**的有：权限规则 `allow`/`ask`/`deny`（`permissions` 设置，`/permissions` 查看管理）和 OS 沙箱（`sandboxing`，见 4.8e）。auto 模式另有分类器（独立模型审动作）。
- **切换入口**：Shift+Tab 循环（从 auto 起循环为 default→acceptEdits→plan；`bypassPermissions` 只在启动时启用才出现；`dontAsk` 不在循环里）；`/plan [提示]` 只对一条提示进入 plan；启动参数 `--permission-mode plan`；设置 `permissions.defaultMode`（放在 `.claude/settings.json` 或 `.claude/settings.local.json` 的 `auto`、`bypassPermissions` 不生效）；VS Code、Desktop、Web 各有选择器（同上文档）。
- **会话级还是全局**：会话内切换是会话级；`defaultMode` 是设置，有用户、项目、本地、托管四层（`permissions` 文档“Settings precedence”）。changelog 里多次修“恢复会话时没有恢复 plan”（2.1.x，见 4.7），说明 plan 是需要持久化的会话状态。

### 4.2 plan 怎样限制

- **文档原文**：“Plan mode tells Claude to research and propose changes without making them. Claude reads files, runs shell commands to explore, and writes a plan, but does not edit your source. Except in interactive terminal sessions with bypass permissions available, edits stay blocked until you approve the plan.”（`permission-modes`）。**所以是硬拦截（编辑被阻止）加提示词（被指示只读）两者都有。**
- **shell 在 plan 下**（文档按顺序，第一个匹配的生效）：
  1. 交互终端且 bypass 可用：不过分类器也不弹窗；
  2. auto 模式可用且 `useAutoModeDuringPlan` 开（默认开）：分类器审 shell（关键路径删除除外），通过的运行，驳回的拦截；
  3. 否则：超出内置只读集的命令弹窗，“including when the sandbox's auto-allow mode is enabled”。
- **只读 shell 判定**：用内置只读命令集（4.8c），无法完整解析的命令按需要审批处理。
- **计划文件**：存在 `~/.claude/plans/` 或设置 `plansDirectory` 指定的目录；“session 的 plan 文件”是 `.claude` 受保护目录的豁免项（`permission-modes` 的“Protected paths”：“`.claude` (with exceptions such as `.claude/worktrees/` and the session's plan files)”）。提示词说明计划文件是 plan 模式下**唯一**允许编辑的文件（二进制字符串：`this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions`）。
- **临时目录能不能写**：文档没写。
- **hook 与 mod 的批准在 plan 下无效**：“in plan mode, apart from `ExitPlanMode`, your `PreToolUse` hook's `"allow"` has no effect on a file edit or another call that isn't read-only”；mod 的 `tool.check` 同样不能批准非只读调用，但可以拦（`https://code.claude.com/docs/en/permissions` 的“Hook approvals in plan mode”）。
- **子代理**：fork 子代理继承父的权限模式，且不能退出 plan（changelog 2.1.285）。

### 4.3 模式与权限怎样叠加

- **规则优先级与模式无关**：deny→ask→allow 先到先得，deny 在所有模式（含 `bypassPermissions`）都生效，allow 在 `bypassPermissions` 下无效（`permission-modes`，`permissions`）。
- **plan + bypass**：文档明说，交互终端里 bypass 可用时“Claude Code doesn't enforce plan mode's blocks. Claude is still instructed not to edit, but edits and shell commands run without prompting. Explicit `ask` rules and critical-path removals still prompt. Plan mode keeps its blocks in `-p` runs, Agent SDK sessions, and VS Code chat-panel conversations.” changelog 2.1.299 为此加了一次性提示“plan mode won't ask before most edits or commands because bypass permissions is available”。
- **plan + auto**：shell 交分类器；changelog 2.1.218 把“静态分析证明不了只读的 Bash 在 plan+auto 下不再弹窗，交分类器”；2.1.119 修“auto 的‘Execute immediately’指令盖过 plan”。
- **plan + 沙箱自动放行**：plan 下跳过“沙箱代替整个 Bash 询问”的替代（`permissions` 的“How permissions interact with sandboxing”）。

### 4.4 进出 plan

- **模型进入**：有 `EnterPlanMode` 工具，工具表里“需要权限：否”（`https://code.claude.com/docs/en/tools-reference`）；changelog 2.1.0 “Removed permission prompt when entering plan mode”。工具说明（二进制字符串）要求“Prefer using EnterPlanMode for implementation tasks unless they're simple”，列了新功能、多种做法、架构决策、多文件等适用情形。permission-modes 页本身只写用户侧入口，没提 `EnterPlanMode`。
- **模型退出**：`ExitPlanMode`，工具表里“需要权限：是”，它只接受裸工具名做规则（tools-reference）。工具说明（二进制字符串）：“This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote”，只在“需要写代码的实现规划”时用，研究类任务不用。
- **批准选项**（`permission-modes` 的“Review and approve a plan”）：
  - “Yes, and use auto mode”（auto 不可用时写“Yes, auto-accept edits”；启动时启用了 bypass 则写“Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session”）；
  - “Yes, manually approve edits”；
  - “No, keep planning”（可附反馈）；
  - 设置 `showClearContextOnPlanAccept` 打开时多一个首选项“批准并清空规划上下文”（changelog 2.1.81 起默认隐藏）。
  - Ctrl+G 在编辑器里改计划后再继续；批准同时给会话生成标题。
- **退出后的模式**：由所选项决定（auto、acceptEdits 或 bypass、manual）；“Approving a plan exits plan mode and switches the session to the permission mode each approve option describes”。用户也可再按 Shift+Tab 不批准就离开。
- **计划内容带到实现**：计划文件在磁盘；批准的工具结果里带“Approved Plan”正文（二进制字符串：`User has approved your plan. You can now start coding…`、`Your plan has been saved to: … You can refer back to it if needed during implementation.`）；清上下文选项则丢弃规划对话（二进制字符串里压缩的原因枚举有 `plan_mode_exit`）。退出时还会发一条“## Exited Plan Mode / You have exited plan mode. You can now make edits…”的提醒（二进制字符串）。

### 4.5 给模型的提示词怎样变

- **文档**：“Plan mode and skill loading append their instructions as conversation messages, so the cached prefix stays intact.” 切换权限模式“does not change the system prompt or tool definitions, so mode changes are cache-safe”，例外是 `opusplan` 设置（plan 用 Opus、执行用 Sonnet，每次切换是一次模型切换，缓存重建）（`https://code.claude.com/docs/en/prompt-caching`）。
- **注入形式**（二进制字符串，文档没写）：plan 开启时作为元消息（`isMeta`）注入；有“完整”和“精简”两种：完整版含五阶段工作流（探索、设计、审查、最终计划、调用 `ExitPlanMode`），精简版只有一句 “Plan mode still active (see full instructions earlier in conversation). Read-only except plan file (…). Follow 5-phase workflow.”；完整版与精简版的轮换节奏文档没写，也没从字符串里读出。子代理有单独的短版。退出时注入 “Exited Plan Mode”。
- **工具集**：模式切换不改（文档）。但 deny 整个工具会移除其定义，缓存是否失效取决于工具检索是否开启（prompt-caching 的“Denying an entire tool”）。

### 4.6 讨论、问答类只读模式

- 没有专门的“讨论”模式。能接近的有：`plan`（可以聊也可以只问不规划，但提示词要求最终出计划）、`dontAsk`（弹窗一律拒绝，面向 CI）。只读的 Explore、Plan 子代理存在（权限文档里 `Agent(Explore)`、`Agent(Plan)` 规则；changelog “Plan mode: introduced new Plan subagent”），子代理文档本次未读。
- 与此相关：`AskUserQuestion` 是任何模式都不自动批准的动作（`permission-modes`：“Actions no mode auto-approves”）。

### 4.7 已知问题和改过的设计（changelog `anthropics/claude-code/CHANGELOG.md`，行号见版本标题）

- 2.1.0：去掉进入 plan 的权限弹窗；加 `/plan` 快捷命令。
- 2.1.47：修“压缩后丢了 plan 模式，模型从规划变成实现”（issue #26061）。
- 2.1.81：默认隐藏“清上下文”选项。
- 2.1.136：修“已有匹配的 `Edit(...)` allow 规则时 plan 不拦写文件”。
- 2.1.212：修“plan 下 `touch`、`rm` 等改文件的 Bash 不经确认或 SDK 回调就自动运行”。
- 2.1.218：plan+auto 下静态分析证明不了只读的 Bash 改交分类器。
- 2.1.285：fork 子代理继承 plan/dontAsk 且不能退出 plan。
- 2.1.299：修“plan 下 `PreToolUse` hook 或 mod 的 allow 让写操作直接运行”；加 bypass 可用时的一次性提示。
- 多个版本修“恢复会话没有恢复 plan”“云会话容器重启后丢计划”（2.1.x，例如 `--continue`、`/resume`）。
- 以上说明 plan 的硬拦截是后来逐步补全的，历史上出现过多个绕过路径。

### 4.8 工具权限规则（问题 8）

#### a. 规则写法、位置、优先级

- 语法 `Tool` 或 `Tool(specifier)`，括号内字面，不转义；裸工具名匹配该工具全部调用（`https://code.claude.com/docs/en/permissions` “Permission rule syntax”）。
- 存放：用户 `~/.claude/settings.json`、项目 `.claude/settings.json`、本地 `.claude/settings.local.json`、托管设置；另有 `--allowedTools`、`--disallowedTools`。托管最高，“if a tool is denied at any level, no other level can allow it”。项目里的 `allow` 要在接受工作区信任后才生效，`deny`/`ask` 不受影响（同页“Project allow rules and workspace trust”）。会话级：对话框里选“本会话”的批准只存会话（4.8d）。
- 优先级：“deny, then ask, then allow. The first match in that order determines the outcome, and rule specificity doesn't change the order.” 窄 allow 不能从宽 deny 里开口子（同页“Manage permissions”）。
- 非 shell 工具：
  - `Read`/`Edit` 规则用 gitignore 语法，四种锚点：`//绝对路径`、`~/家目录`、`/相对设置来源`、`相对当前目录`；`Edit` 管所有编辑类内置工具，`Read` 的 deny 对 Grep、Glob 等尽力生效；`Write(path)`、`Glob(path)`、`Grep(path)` 的带路径规则被接受但**不匹配**，要写成 `Edit`/`Read`（同页“Read and Edit”）。
  - `WebFetch(domain:example.com)`；MCP 用 `mcp__<server>__<tool>` 或 `mcp__<server>__*`，带括号的 MCP 规则在设置文件里被跳过；`Agent(名字)` 管子代理。
  - 任意内置工具可按顶层标量参数写 deny/ask 规则，如 `Agent(model:opus)`、`Bash(run_in_background:true)`；allow 不支持；不能用此法匹配主内容字段（如 `Bash(command:…)` 被忽略并警告）。

#### b. shell 怎样匹配

- 通配符：`*` 匹配任意文本含空格，可在任意位置；末尾“空格加 `*`”也匹配无参数的裸命令；`Bash(ls *)` 不匹配 `lsof`，`Bash(ls*)` 匹配；`:*` 是等价的末尾写法。官方警告把 `*` 放在子命令之后，`Bash(git * main)` 会匹配 `git -c core.fsmonitor=<script> diff main`，启动时给警告。
- 复合命令：认 `&&`、`||`、`;`、`|`、`|&`、`&` 和换行；allow 要**每个**子命令都被允许（匹配规则或属于只读命令）；deny/ask 只要**任一**子命令匹配（含子 shell、命令替换、`for` 循环体里嵌套的命令）就生效。`npm test &&` 这种以操作符结尾的视为解析不了，不拆分，allow 规则不批准它。
- 包装命令：先剥固定的一组再匹配：`timeout`、`time`、`nice`、`nohup`、`stdbuf`、shell 内建 `command`、`builtin`、zsh 的 `noglob`；裸 `xargs`（无选项）也剥；`xargs -n1 grep` 不剥。已知安全的环境变量前缀会剥，其它变量前缀使 allow 不匹配，deny/ask 则无论什么前缀都匹配。`direnv exec`、`devbox run`、`mise exec`、`npx`、`docker exec` 不在名单里，`Bash(devbox run *)` 会放行其后的任何命令。
- `watch`、`setsid`、`ionice`、`flock` 这类 exec 包装，以及带 `-exec`、`-delete`、`-rm`、`-fprint`、`-files0-from` 的 `find`，前缀规则不能自动批准，要弹窗；确切命令可用不含 `*` 的整条规则批准。
- 重定向：写重定向（`>`、`>>`、`2>`）的目标按 `Edit` 规则、受保护路径、工作目录检查；读重定向（`<`）按 `Read` 规则；`/dev/null`、`2>&1`、here-doc 不查；`tee` 的目标也查（v2.1.269 起）。
- 解析方式：文档没写用什么解析器；写明“Commands the analysis can't parse: … it asks for approval instead of treating the command as read-only. Commands longer than 10,000 characters always prompt”。即**解析不了默认询问**。
- `bash -c`、绝对路径、不同写法：规则**不覆盖**。文档表格：`Bash(rm *)` 拦 `rm -rf build/`，不拦 `/bin/rm -rf build/`、`bash -c 'rm -rf build/'`；`Bash(git push *)` 不拦 `git -C . push`、`git -c push.default=current push`、`git 'push'`。

#### c. 只读命令怎样判定

- 内置清单，**不可配置**：包含 `ls`、`cat`、`echo`、`pwd`、`head`、`tail`、`grep`、`find`、`wc`、`which`、`diff`、`stat`、`du`、`cd` 以及“read-only forms of `git`”；任何模式都不问（`permissions` 的“Read-only commands”）。要让其中一条也问，加 ask 或 deny 规则。
- 覆盖到参数与子命令：是。未加引号的通配符对带写能力或执行能力选项的命令（`find`、`sort`、`sed`、`git`）要弹窗，因为通配符可能展开成 `-delete`；`docker` 带 `-H`、`--context` 指向别的守护进程要弹窗；`file -m/-f`、`ps` 带 `e` 选项（`ps auxe`、`ps aux -e`，v2.1.290 起）要弹窗；设置 `PATH`、`IFS` 等特殊变量要弹窗；`cd` 到别的目录再 `git` 要弹窗（钩子风险）。`find` 带 `-exec`、`-delete`、`-fprint` 等不算只读（上一条）。`git log` 算读、`git push` 不算的具体清单：文档只说“read-only forms of git”，**具体子命令表未查到**。`sed -i`、`git branch -D` 的单独说明：未查到（只在上面“带写能力选项”的类别里间接涉及）。
- `acceptEdits` 另外自动放行工作目录内的 `mkdir`、`touch`、`rm`、`rmdir`、`mv`、`cp`、`sed`（`permission-modes`）。

#### d. “不再询问”生成什么规则、谁建议

- 文档表：Bash 命令“Permanently per repository and command”；文件修改“Until session end”；WebFetch“按仓库和域名永久”（`permissions` 开头表）。永久规则写到 git 仓库根的 `.claude/settings.local.json`（经 worktree 解析到主检出）。
- 形态：对话框在选“命令前缀”时写**空格加 `*` 的前缀形式**（如 `Bash(npm test *)`）；复合命令按子命令分别存一条，最多 5 条，例如批准 `git status && npm test` 只存 `npm test`；`cd` 到工作目录外会生成该路径的 Read 规则。
- 谁建议：权限对话框（Claude Code 自己），不是模型。Codex 的前缀由模型建议，见 5.d。
- 另有：回答权限提示时可按 Tab 附一段评论，随批准或拒绝回传给模型。

#### e. 沙箱和规则的关系

- 互补两层：“Permissions control which tools Claude Code can use and which files or domains it can access … Sandboxing provides OS-level enforcement that restricts shell commands' filesystem and network access.” 沙箱对 Bash、PowerShell、Monitor 及其子进程生效；沙箱设置和权限规则里的路径与域名**合并**进最终沙箱配置（`permissions` 的“How permissions interact with sandboxing”）。
- 开沙箱且 `autoAllowBashIfSandboxed` 取默认 `true` 时，沙箱内的 Bash 不问，连整工具的 `Bash` ask 规则也被替代；但带内容的 ask 规则（`Bash(git push *)`）仍问，plan 模式下不做这个替代。
- 官方明确建议：要让文件和网络限制不依赖命令文本，用沙箱；规则只是“覆盖 Claude 通常产生的写法”。

#### f. 官方承认的局限

- “a deny or ask rule covers the invocation Claude usually produces and isn't a security boundary around the program”（`permissions` 的“What a Bash rule doesn't match”）。
- “Bash permission patterns that try to constrain command arguments are fragile”，以 `curl http://github.com/ *` 为例列四种绕法（选项在前、换协议、重定向、变量）。
- `Read`/`Edit` 的 deny 规则不覆盖“读文件但不点名的命令”（如在该目录下 `grep -r pattern .`）和“间接读写文件的任意子进程”（Python/Node 脚本）。
- 关键路径检查（防 `rm` 删根目录等）“A command the check misses gets no special handling”，不能替代操作系统级沙箱。
- 已修的绕过：见 4.7 的 2.1.136、2.1.212、2.1.299。

## 5. Codex 的工具权限规则（问题 8）

#### a. 规则写法、位置、优先级

- 规则文件 `*.rules`，Starlark，放在每个活动配置层的 `rules/` 目录里：用户层 `~/.codex/rules/default.rules`，项目层 `<repo>/.codex/rules/`（仅当项目 `.codex/` 层被信任时加载），托管层 `requirements.toml`（官方文档 `learn.chatgpt.com/docs/agent-configuration/rules`；加载顺序按层从低到高，高层覆盖：`CODEX/core/src/exec_policy.rs:709-733`，叠加托管层 `:735-768`）。官方文档标注“Rules are experimental and may change.”
- 语法 `prefix_rule(pattern=[…], decision=…, justification=…, match=…, not_match=…)`；`pattern` 元素是字面串或备选列表；`decision` 为 `allow`（默认）、`prompt`、`forbidden`；`match`/`not_match` 是加载时校验的示例（`CODEX/execpolicy/README.md`）。另有 `host_executable(name, paths)` 限制绝对路径的基名回退匹配；`canonical_matching=True` 做 Unicode 规范化不区分大小写。
- 优先级：多条匹配取最严：`forbidden > prompt > allow`（README；文档：“Codex applies the most restrictive decision”）。**没有“先到先得”也没有按具体程度排序**。
- 非 shell 工具：
  - 文件写（`apply_patch`）不走规则，走沙箱写权限：补丁里所有路径都在可写根内、且沙箱可用（或沙箱是 Disabled/External）就自动批准，否则问或拒（`CODEX/core/src/safety.rs:67-125`）。读限制靠权限配置里的 deny-read 路径与通配符（`CODEX/protocol/src/permissions/deny_read_validator.rs`，细节本次未读）。受保护路径：可写根下的 `.git`、`.agents`、`.codex`、`.aws` 保持只读（`CODEX/protocol/src/permissions.rs:44-50`，官方文档 agent-approvals-security）。
  - MCP 工具：每个服务器或工具可配 `approval_mode`：`auto`、`prompt`、`writes`、`approve`（`CODEX/config/src/mcp_types.rs:27-35,87`）。
  - 网络默认关闭（官方文档：“By default, the agent runs with network access turned off.”）；`network_rules` 与规则同文件管理（`CODEX/execpolicy/src/amend.rs`）。

#### b. shell 怎样匹配

- 前缀匹配，对象是 **argv 数组**，不是命令字符串；先精确匹配首个 token，可选按基名回退（`execpolicy/README.md` 的 Matching semantics；执行路径用 `resolve_host_executables: true`，`exec_policy.rs:376-378`）。
- 是否解析命令：是，用 tree-sitter-bash。仅当命令正好是 `[shell, "-c"/"-lc", 脚本]` 且 shell 是 bash、zsh、sh（`CODEX/shell-command/src/bash.rs:107-119`）才解析。脚本只含“纯单词命令”并仅用 `&&`、`||`、`;`、`|` 连接时，拆成多条逐条判，取最严（`bash.rs:20-95`；官方文档：“Codex won't automatically allow `git add . && rm -rf /` because it evaluates `rm -rf /` separately.”）。
- 以下情形**整条脚本当一次调用**（`["bash","-lc","<整段脚本>"]`）去匹配规则：括号、重定向、命令替换、控制流、环境变量赋值、通配符（`bash.rs` 的白名单拒绝其余节点；文档：“Scripts using redirection, substitutions, environment variables, wildcards, or control flow are evaluated as one … invocation”）。子 shell `$(...)` 同属此类。
- 包装命令：执行策略匹配**不剥包装**，`timeout 30 npm test` 的首 token 是 `timeout`。`xargs`、`find -exec` 的处理：**未查到**。危险命令启发式会穿过 `sudo`、`env`（跳过变量赋值与选项）、`trap` 里的 shell 脚本，嵌套最深 8 层，超过按危险处理（`CODEX/shell-command/src/command_safety/is_dangerous_command.rs:35-205`）。
- 解析不了时：整条 argv 当一个命令，没有规则匹配就走“未匹配命令”的兜底（c 小节）：**不是默认放行也不是默认询问，取决于审批策略和沙箱**。

#### c. 只读命令怎样判定

- **审批路径里没有只读命令清单。** 仓库里 `ParsedCommand{Read, ListFiles, Search, Unknown}` 的分类用于界面展示（`CODEX/protocol/src/parse_command.rs`；调用点 `core/src/tools/events.rs:230`、`core/src/session/mod.rs:3361`），不参与批准；`grep` 全仓库没有 `is_known_safe_command`（只有测试名里出现 “known_safe”）。
- 未匹配命令的兜底 `render_decision_for_unmatched_command`（`exec_policy.rs:817-912`），先看危险启发式（`rm` 带 `-f`、`sudo` 里的危险命令等，`DangerousCommandMatch::ForcedRm/Other`）：命中则 `never`→禁止，其它→询问。没命中时：
  - `never`：放行，靠沙箱；
  - `untrusted`：询问；
  - `on-request`/`granular`：**沙箱受限（restricted）时放行**（由沙箱执行，写不了就失败再升级），沙箱不受限或外部沙箱时放行；模型申请越过沙箱（`sandbox_permissions` 为 `RequireEscalated` 或 `WithAdditionalPermissions`）则询问。
- 所以 Codex 的“读/写”判定靠沙箱，不靠命令名；`git log` 与 `git push` 的区别在规则里写，或由沙箱（只读时 push 写 `.git` 被拒；网络默认关闭）挡住。`find -delete`、`sed -i`、`git branch -D`：不单独处理（沙箱内会因写入被拒绝而失败）。

#### d. “本会话都批准”或“以后都允许”

- 弹窗给出的是前缀规则修订 `ExecPolicyAmendment`。来源有两路：（1）**模型**在调用里带 `prefix_rule` 参数，建议一个可复用前缀（`derive_requested_execpolicy_amendment_from_prefix_rule`，`exec_policy.rs:1028-1067`）；（2）规则里已有 `prompt` 规则时，推导出“被问的那条规则”的前缀（`try_derive_execpolicy_amendment_for_prompt_rules`，`:986`）。
- 过滤：太宽的前缀被禁止建议，名单 `BANNED_PREFIX_SUGGESTIONS` 包括解释器与 shell（`bash`、`bash -c`、`python`、`python -c`、`node -e`、`git`、`env`、`sudo`、`rm`、`npm run`、`yarn run`、`pnpm run` 等，`exec_policy.rs:59-146`）；已有规则命中时不建议；建议的前缀必须能使所有分段都通过才提出（`prefix_rule_would_approve_all_commands`，`:1069`）。危险命令的弹窗不附带规则建议（`:420-425`）。
- 落盘：允许后追加到 `~/.codex/rules/default.rules`（官方文档：“Adding a command to the allow list in the TUI writes to `~/.codex/rules/default.rules`.”；`CODEX/execpolicy/src/amend.rs`，加文件锁）。官方文档提醒审阅建议的前缀。对某些模型（代码里叫 cyber model）会整体忽略所有 `allow` 前缀规则，也不产生建议（`AllowPrefixRules::IgnoreForCyberModel`，`CODEX/core/src/exec_policy/model_policy.rs:7-60`；为什么这样做：未查到）。
- “本会话”粒度（不落盘）的批准存在与否：本次未查到单独机制。

#### e. 沙箱和规则的关系

- **规则里的 `allow` 意味着在沙箱外运行**：文档“`allow`: runs outside the sandbox without prompting”；代码里只有每一段命令都被**规则**显式允许时才 `bypass_sandbox: true`（`exec_policy.rs:468-487`，启发式放行不算）。
- 沙箱负责兜底：没规则时靠沙箱限制副作用（c 小节）；规则 `forbidden` 直接拒绝，`prompt` 每次问。
- 所以在 Codex 里“放宽规则”等于“放宽沙箱”，规则不是纯粹的审批层（这是与 Claude Code 的差异：Claude Code 的 allow 规则不解除沙箱，沙箱设置另算）。

#### f. 官方承认的局限

- 规则实验性，随时可变（文档开头）。
- 规则只匹配 argv 前缀；复杂 shell 脚本整体当一个命令，所以对 `bash -lc` 内含重定向或变量的脚本，前缀规则很难写准；`BANNED_PREFIX_SUGGESTIONS` 说明团队自己认为 `bash -c`、`python -c`、`git` 之类前缀放行等于放行任意命令。
- 官方安全文档：提示注入可诱使 agent 取回并遵循不可信指令；网络代理“does not filter web search, app or connector tool calls, MCP server connections”；容器“do not prevent every attack”（`agent-approvals-security`）。
- 已修绕过类 issue：本次未系统检索。

## 6. omp 的工具权限规则（问题 8）

#### a. 规则写法、位置、优先级

- 按工具：`tools.approval.<工具名>: allow|prompt|deny`（record 设置，`OMP/tools/settings.ts:294-305`）；按 bash 命令：`bash.patterns`，有序数组，每项 `{match, approval}`，`approval` 为 `allow|deny|prompt`，`match` 只支持 `*` 通配（`OMP/exec/settings.ts:156-167`，`OMP/tools/bash.ts:247-264`）；`bash.allowCompoundCommands`（默认关，`OMP/exec/settings.ts:117-128`）；`tools.restrictedFolders`（项目层不可设，防项目文件替用户提权，`OMP/config/settings-ui.ts:40-42`）。位置：全局 `config.yml`、项目层、命令行覆盖（`OMP/config/settings.ts`）；项目设置还会经能力层读入 `.claude/settings.json`（`settings.ts:340-347` 的注释提到它与别的工具共用）。
- 优先级由 `resolveApproval`（`OMP/tools/approval.ts:344-387,389-500`）：
  1. 工具自己的 `approval(args)` 声明若是 `policy:"deny"` → 拒；
  2. 用户按工具的 `deny` → 拒；
  3. `yolo`：工具声明的 allow/prompt 优先，否则用户策略，否则放行（**`yolo` 下工具的“覆盖性提示”被忽略**，用户的 `tools.approval` 仍然权威）；
  4. 工具声明带 `override`（如关键命令模式）→ 询问；
  5. 工具声明 `allow`/`prompt` → 按声明；
  6. 用户策略；
  7. `always-ask-cached` 看记住的授权；
  8. 按模式的最高档位比较（`always-ask`→读、`write`→写、`yolo`→执行）；
  9. 最后 `restrictedFolders` 命中则无论如何改为每次询问（deny 除外）。
- 非 shell 工具：`read`/`write`/`edit` 的档位由路径协议决定（`local://` 按读档，`OMP/internal-urls/local-protocol.ts:473`）；`always-ask-cached` 下以目标路径、目录、目录树为授权键（`OMP/tools/approval-cache.ts`，`approval.ts:160-260`）；MCP 工具走 `mcpApprovalPreflight`，按工具名（含旧名回退，只继承 deny/prompt，不继承 allow，`approval.ts:406-420`）。

#### b. shell 怎样匹配

- 通配符，不是前缀：`match` 转成 `^…$` 的正则，`*` → `.*`，其余字符转义，空白折叠（`OMP/tools/bash.ts:247-253`）。因此 `git status` 不匹配 `git status -s`，要写 `git status*`。
- 是否解析：分两层。
  - 判断 allow 能否适用：`hasBashApprovalShellControl` 字符级扫描（单双引号、转义），含 `\n \r ; & | < > \` $ ( )` 之一就视为有 shell 控制，**allow 规则不适用**；另外 `-c`/`-e`/`--command`/`--eval` 类选项（`sh -c "…"`、`git -c alias.x='!…'`）会让引号内的控制符也算（`OMP/tools/bash.ts:96-137`）。
  - 判断 deny/prompt：用共享分词器 `tokenizeShellSegments` 按 `; && || | & ( )` 和换行拆段，整条或任一段命中即生效（`OMP/tools/shell-tokenize.ts:25-45`，`OMP/tools/bash.ts:285-319`）。分词器明说“deliberately not a full POSIX parser — heredocs, command substitution, and arithmetic expansion are out of scope”。
- 复合命令：默认下含控制符的命令不会被 allow 规则放行（回到模式判定），deny/prompt 按段命中。开 `bash.allowCompoundCommands` 后，仅对“纯字面、仅用 `&&` 连接”的链逐段判（`extractLiteralAndChainSegments`，拒绝展开、通配、重定向、注释、赋值、控制流、shell 包装与解释器、改当前 shell 的命令，`OMP/tools/shell-tokenize.ts:225-300`）；若所有段都被 allow 命中则放行，有未命中的段按原兜底（`exec` 档）。
- 子 shell、`$(...)`、重定向：含这些字符的命令 allow 不适用；deny/prompt 的分段匹配对 `$(...)` 内部未做命令级解析（分词器范围外，推断）。环境变量前缀、别名、`xargs`、`find -exec`、`timeout`：没有专门剥离或识别（`bash.ts` 与分词器中未见，推断）。
- 解析不了时：回到模式判定（`exec` 档），即默认配置 `yolo` 放行、`write` 及更严询问。
- 另有 `CRITICAL_BASH_PATTERNS`（一组正则：递归删除根路径、`sudo rm`、`chmod -R … /`、`mkfs`、`dd … of=/dev/…`、fork 炸弹、`curl … | sh` 及其进程替换变体、`eval "$(curl …)"`、关机命令、`nc -e` 等），命中则对非 `yolo` 模式强制询问（`override`）；`yolo` 下被忽略（`OMP/tools/bash.ts:187-232`，`approval.ts:437-453`）。
- `bashInterceptor`、`bash.gitGuard` 是另外的非权限机制：前者把 `grep`、`cat` 等引导到专用工具，后者拒绝在主检出里丢弃共享工作的 git 命令（`OMP/exec/settings.ts:144-180`）。

#### c. 只读命令怎样判定

- **没有**。bash 的默认档位是 `exec`（`OMP/tools/bash.ts:600`）；`write` 模式（放行读与写）也要为 bash 弹窗。想让 `ls`、`git status` 免问，只能用 `bash.patterns` 写 `allow`（命中则按 `write` 档放行，`bash.ts:591`）。内置没有清单，也不看子命令或参数。

#### d. “本会话都批准”或“以后都允许”

- 选项由提示框给出：“Approve … for this session”的范围是 `{工具名或设备名, 档位}`，**不是命令**：`sessionApprovalScope` 返回键 `工具\0档位`（`OMP/tools/approval.ts:595-607`）。也就是批准一次 bash 的 `exec` 档，本会话所有 bash 都放行。
- 仅当提示由“审批模式”引起时才可记住；关键命令覆盖、用户或工具显式 `prompt` 策略的提示每次都问（同上）。
- 跨会话的记住只有 `always-ask-cached` 下的文件与目录授权，存 `approval-cache.db`（`OMP/tools/approval-cache.ts`）；bash 没有 `approvalCacheTargets`，不会被记住成命令规则（`bash.ts` 中无该字段）。不会自动把批准写成 `bash.patterns`。

#### e. 沙箱和规则的关系

- omp 没有 OS 级沙箱（源码里 grep `sandbox-exec`、`landlock`、`bwrap`、`seatbelt` 均无相关命中；“sandbox”一词只指 `local://` 这类内部协议的写范围）。规则（审批）就是唯一的执行前防线，外加 `restrictedFolders`、`CRITICAL_BASH_PATTERNS`、`bash.gitGuard`。推断：需要隔离时靠外部容器。

#### f. 官方承认的局限

- 代码注释承认：`allow` 规则“never rides a compound line (shell control syntax could smuggle an unsafe segment past a narrow allow)”（`OMP/tools/bash.ts:301-305`）；`CRITICAL_BASH_PATTERNS` “Kept intentionally tight — the cost of a false negative is data loss … while false positives remain actionable through user policy control”（`bash.ts:179-186`）；分词器不是完整 POSIX 解析器。
- 默认审批模式是 `yolo`；plan 的 shell 不拦（见 2.2）。
- 已修绕过类：CHANGELOG 里有 `tools.restrictedFolders`（18.13.1）、`always-ask-cached`（18.12.3）的新增；绕过类 issue 本次未系统检索（open issue #11686：不声明征询能力的 ACP 客户端上，工具审批被静默拒绝而 plan 审批被静默通过，标题所述，正文本次未读）。

## 7. 对照

### 7.1 共同点

- **三家都不让“模式”承担全部权限**：omp、Codex 把审批和 plan 分开；Claude Code 虽然把 plan 放进权限模式，但规则（deny/ask/allow）和沙箱仍是与模式正交的层，deny 在所有模式都生效。
- **三家的 plan 都不由模型自己决定退出**：omp 只能提议（写 `xd://propose`）、Claude Code 调 `ExitPlanMode` 要用户批准、Codex 只能在回复里输出 `<proposed_plan>` 由用户点。
- **都把计划留作可回看的内容**：omp 用 `local://` 文件加内联；Claude Code 用 `~/.claude/plans/` 文件；Codex 用回复里的块（无文件）。
- **计划提示词都放在消息里而不是系统提示词里**：omp 是自定义消息，Codex 是 developer 消息，Claude Code 是元消息（文档明说）。
- **没有一家有真正的“讨论”模式**；Codex 官方把“只聊不改”交给只读沙箱，omp 有开放 issue 要 `/read-only`，Claude Code 最接近的是 plan 或 `dontAsk`。
- **shell 规则都承认不是边界**：Claude Code 文档明说，Codex 禁止建议太宽的前缀，omp 的 allow 不适用于含控制符的命令。

### 7.2 分歧点与各自的代价

| 分歧 | 做法与代价 |
|---|---|
| plan 的约束靠什么 | **Codex：只有提示词**，实现最简，代价是模型不遵守时无防线，已有 issue #32594 报告改了文件；hook 也看不到 plan（#42881）。**omp：写文件在工具内硬拦，shell 靠提示词**，写工作区被挡住，但 shell 是漏洞（默认 `yolo` 下无弹窗）；多一套“沙箱根”（`local://`）要维护，扩展的同名 `write` 曾引发死循环。**Claude Code：编辑与 shell 都硬拦，再加提示词**，最严，代价是历史上多次补洞（2.1.136、2.1.212、2.1.218、2.1.299）、规则与 hook 与 mod 的交互复杂（“plan 下 hook 的 allow 无效”），且 bypass 下整套拦截关闭，只剩提示词。 |
| 模式与全部放行叠加 | omp：plan 的写拦截不受 yolo 影响，但 shell 受影响。Codex：互不影响，plan 退化为纯提示词。Claude Code：bypass 可用的交互终端里 plan 拦截不生效（文档承认），非交互与 SDK 里仍生效；代价是“同一个 plan”在不同入口强度不同。 |
| 模型能否自己进入 plan | 只有 Claude Code 有 `EnterPlanMode`，免批准；好处是复杂任务自动先规划，代价是需要靠工具说明里的长篇判据约束何时用，且提示词里的“Prefer using EnterPlanMode”倾向使用。omp、Codex 只让用户进入，模型要规划只能建议。 |
| 退出时能不能同时选权限 | Claude Code 的批准选项直接是后续权限模式（auto、自动接受编辑、bypass、手动），一步到位，代价是“模式”和“权限”被绑在一个入口；omp、Codex 的批准不改审批和沙箱，需要另外调，代价是用户批准后可能仍被审批弹窗打断，或在 yolo 下直接开干。 |
| 计划怎样带入实现 | omp：内联正文加持久文件，历史被改写后自动重注入，最稳，代价是提示词长、要维护重注入逻辑。Claude Code：磁盘文件加批准结果带正文，可选清上下文，另需修“压缩后丢 plan”的问题（2.1.47）。Codex：靠对话历史或把正文塞进新线程首条消息，最简，代价是没有文件、不能从外部编辑。 |
| 切换时通知模型 | omp：每个用户回合都带完整 plan 消息，不会遗忘，代价是 token 与（工具集变化时）缓存失效。Codex：只在变化时发一段，Default 文字用来取消 Plan 指令，代价是漏发或错乱时模型会“自以为还在 Plan”（#10185）。Claude Code：完整加精简两种提醒，退出发“Exited Plan Mode”；节奏文档没写。 |
| 缓存影响 | Claude Code 文档明确“模式切换对缓存安全”，工具定义不随模式变（除 `opusplan` 切模型）。omp 进入 plan 若需补 `write` 工具会重建系统提示词；Codex 工具集不随模式变（推断）。 |
| 规则语法 | Claude Code：通配符模式字符串加 gitignore 式路径规则，deny→ask→allow 固定顺序。Codex：argv 前缀加 Starlark，三档取最严，规则带示例自检（`match`/`not_match`）。omp：整串通配符加有序列表，allow 不碰复合命令。代价：Claude Code 的通配符能写出过宽规则（官方对 `git * main` 发警告）；Codex 的前缀对 `bash -c` 内容无能为力；omp 的 `git status` 要写 `git status*`，没有按子命令的结构。 |
| shell 解析 | Claude Code：识别所有分隔符、子 shell 和命令替换里的命令（deny/ask 方向），剥固定包装，解析不了就问；但 `bash -c`、绝对路径、`git -C` 绕得过规则。Codex：tree-sitter 只拆纯单词链，其余整条当一个命令；包装不剥。omp：字符级扫描加轻量分词，不拆 `$(…)`，不剥包装。 |
| 只读命令的判定 | Claude Code：内置清单，覆盖到选项和通配符，不可配置，只读命令各模式都不问。Codex：没有清单，靠沙箱；命令名无关，代价是沙箱不可用时（如部分平台）没有兜底，且 `allow` 规则会把命令放到沙箱外。omp：没有，读命令也按 `exec` 档，代价是用户要自己写大量 `allow` 模式，否则要么全放行要么全询问。 |
| “不再询问”的粒度 | Claude Code：对话框建议前缀规则，落盘到本地设置文件，复合命令拆成多条。Codex：模型建议前缀（带禁用名单），落盘到 `default.rules`，规则放行即脱离沙箱。omp：按“工具加档位”记住，不生成命令规则；代价是粒度粗，批准一次 bash 即放开本会话所有 bash。 |
| 沙箱与规则 | Claude Code：两层互补，规则与沙箱配置合并，沙箱内 Bash 可免问。Codex：沙箱是主防线，规则 `allow` 等于出沙箱。omp：无 OS 沙箱，审批是唯一防线。 |
| plan 与“讨论” | Codex 把“只聊不改”放在权限维度（只读沙箱）；Claude Code 与 omp 放在 plan 模式（模式维度）；代价各异：前者无需新增模式，但沙箱层面的只读会让模型无法写计划文件（Codex 因计划在回复里而无此问题）；后者需要给计划文件开豁免。 |

## 8. 查不到或拿不准的条目

- omp：会话内切换审批模式的命令（未查到）；`ast_edit` 在 plan 下是否被拦（未查到调用点）；vibe 模式的真实语义（只读到命令说明）；`/plan` 不批准直接关闭时是否通知模型（未查到）；plan 下 bash 不拦是从代码推断，没有在真实运行时复现；issue #6995、#11686 只读了标题。
- Codex：Plan 与批准提示的缓存影响（只读了模板与世界状态，没读 `prompt_caching.rs` 测试）；“本会话”粒度的批准机制（未查到）；`xargs`、`find -exec` 的处理（未查到）；已修绕过类 issue（未系统检索）；deny-read 通配符的细节；官方文档页面里关于 plan/协作模式的专门章节（`learn.chatgpt.com` 的 `/docs/reference/slash-commands` 只有一行）。
- Claude Code：不开源，内部实现一律是文档与二进制字符串旁证；完整与精简提醒的轮换节奏（文档没写）；plan 下临时目录能否写（文档没写）；“read-only forms of git”的具体子命令表（文档没列）；`sed -i`、`git branch -D` 是否属只读（文档没单独说）；Explore、Plan 子代理的详细权限（子代理文档本次未读）；`permission-modes` 页后 20% 内容（抓取截断）未读。
