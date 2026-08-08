# NeuroBook Context

NeuroBook 是一个本地优先的小说创作工作台。该语境记录用户运行数据、配置、Project Workspace 可携带性和数据库边界相关的稳定术语。

## Language

**Workspace Root**:
应用内承载全部 Project Workspace 的数据根目录，逻辑路径默认是 `workspace/`；其物理父目录由 State Root 决定。
_Avoid_: workspace, project root

**Installation Root**:
NeuroBook 源码、`.output`、`.runtime` 和 `.deploy` 的统一程序根。Git checkout、Product Bun 和 Windows Portable 都使用这一底座。
_Avoid_: Workspace Root, State Root, app checkout

**Product Runtime Image**:
由 Product Runtime Image Builder 从一个锁定身份的 Source 投影出的、经过完整验证并以 `runtime-image.ready` 提交的自包含 `.output`。它包含前端、Nitro/命令 bundle、Profile Authoring Kit、System Assets 和显式 package islands；正式运行不得回退读取 Installation Root 根 `node_modules` 或可变 Source。
_Avoid_: Nuxt build output, product staging directory, copied node_modules

**Product Runtime Contract**:
Product Runtime Image 内 `server/runtime-contract.json` 声明的唯一逻辑命令与发布检查接口。Manager、Docker、Release、Portable 和稳定 Agent CLI 只解析逻辑 ID，不依赖 bundle 文件名或旧 `server/scripts` 路径。
_Avoid_: command bundle filename, deployment script fallback, Product manifest

**Profile Authoring Kit**:
与一个 Product Runtime Image revision 绑定的 Profile 编译包根，包含 `nbook/profile-sdk`、编译 worker、声明投影和显式批准的 authoring 依赖。普通 Product 的 Profile 编译不得向上借用 Source Root 或根 `node_modules`。
_Avoid_: root development dependencies, arbitrary npm environment, Product package islands

**Profile Authoring Interface**:
Profile 作者可导入的稳定源码边界：`nbook/profile-sdk`、Profile root 内相对模块和 Runtime builtin。`typebox` 是 SDK 内部实现依赖，不是作者可直接导入的包；宿主类型图不得通过 SDK 声明泄漏给作者。
_Avoid_: direct typebox import, server type graph, arbitrary npm import

**Variable Authoring SDK**:
`nbook/variable-sdk` 提供 Variable definition 作者需要的最小稳定类型与 `defineWorkspaceRootVariable()` / `defineProjectVariable()`。它与 Profile Authoring Interface 使用同一 Product-bound compiler package root 和 import gate，不从调用 cwd 猜测 Global 或 Project locator。
_Avoid_: profile-sdk variable exports, server variable internals, cwd-derived scope

**State Root**:
用户真相源的物理根目录。受管 Installed Windows 固定为 `%LOCALAPPDATA%/NeuroBook/data`，Windows Portable 固定为 `Installation Root/data/`；Boot Config、Product Env、日志、secrets 和 Workspace Root 都从这里解析，更新永不覆盖。
_Avoid_: Workspace Root, source root

**Cache Root**:
NeuroBook 可删除、可重建数据的物理根。受管 Installed Windows 固定为 `%LOCALAPPDATA%/NeuroBook/cache`，Portable 固定为 `Installation Root/.cache/`；图片变体、llmlint detect cache、Bun install cache、authoring lease 和 Bash 完整输出分别由自己的 Module 管理预算。Bun cache 当前只有路径隔离，尚无受管 `bun install` 消费者；硬预算在该安装命令落地时执行，不把普通 Product 启动变成全盘扫描。
_Avoid_: State Root, temporary directory, one global cache owner

**Desktop Local Root**:
Desktop Envelope 拥有的设备本地状态根；WebView Root 是其受管子路径。正常更新保留、内容备份排除，只有显式 desktop reset 或卸载删除；Product RuntimePaths 不消费该 root。
_Avoid_: Cache Root, State Root, browser localStorage truth source

**Desktop Distribution Manifest**:
描述一个桌面发行候选可下载或可从本地 depot 安装的组件清单；它记录 Source、Product、Bun、Manager、Envelope、Tool Pack 和 WebView Runtime 的相对 locator、版本与摘要，不记录用户状态或控制凭据。
_Avoid_: installation state, user data manifest, arbitrary absolute path

**Desktop Supervisor Protocol**:
Desktop Envelope 与 Manager 之间的 stdin/stdout NDJSON 控制合同，覆盖验证、迁移、启动、ready、停止和失败事件。Envelope 不直接编排 Product 内部命令，Manager/Product 仍分别拥有安装事务和业务生命周期。
_Avoid_: ad hoc shell output, exposed shutdown token, UI-owned migration

**Windows Release Zip**:
面向 Windows x64 用户的 GitHub Release 资产。解压目录就是 Installation Root，包内包含完整源码、`.output`、托管 Bun/rg/PortableGit/bash、版本化 Manager 和根启动入口；用户状态位于 `data/`。
_Avoid_: deploy mode, source bootstrap zip, app sub-root

**Owned Process**:
NeuroBook 在一个有界 lease 内创建并拥有完整后代集合的外部进程。Windows x64 通过目标启动前已建立的 Job Object、POSIX 通过独立 process group 实现；timeout、abort、cancel、shutdown、启动失败或宿主断连只有在进程树和继承资源收口后才完成。它不表示 NeuroBook 可以扫描或终止用户与系统进程。
_Avoid_: direct child process, PID tree scan, global process killer

**NeuroBook Manager**:
独立 npm 包 `@notnotype/neuro-book-manager` 提供的安装、更新、启动、诊断、Runtime 和 Tool 管理器，公开命令为 `neuro-book`。
_Avoid_: application dependency installer

**NeuroBook Manager GUI**:
与主 Electron 共享 Chromium 载荷的独立安装向导进程。它只调用 Manager CLI/Supervisor 的结构化合同，显示安装、修复、组件检查和卸载状态，不直接执行 Product、数据库、Provider 或 shutdown 逻辑。
_Avoid_: GUI-owned installer, second Electron runtime, Product replacement

**Desktop Envelope**:
围绕 Product Runtime 的 Electron 或 Tauri 宿主，拥有窗口、单实例、菜单、托盘、WebView profile 和设备本地状态；它通过 Manager/Supervisor 合同启动 Product，不复制业务命令。
_Avoid_: Product replacement, browser-only shell, GUI Manager

**Desktop Installation Manifest v3**:
本机桌面安装的真相源，记录 `user`/`machine` 安装范围、程序相对根、State/Cache/Desktop/WebView 用户 locators、组件 receipts 和默认保留 State Root 的卸载策略；canonical Installed root 缺少或损坏 manifest/locator 时必须停在 Repair，不回退到 Portable 布局；不保存 API Key、cookie 或 shutdown token。
_Avoid_: portable payload manifest, absolute installation path, user content backup

**Windows Machine-scope UAC Broker**:
Manager GUI 为 `Program Files` 安装、修复和卸载创建的一次性提升边界；控制管道使用版本化 NDJSON 与 `operationId/nonce`，管理员密码只在独立 secret 管道完成同样身份握手后写入 Manager CLI stdin。它不拥有安装事务，只转发白名单动作并回传阶段事件。
_Avoid_: GUI-owned install, password in argv/env/log, arbitrary elevated shell

**Workspace Root `.nbook`**:
Workspace Root 的全局控制区，保存 Global Config、用户 assets、Agent 资源覆盖层和全局运行状态。
_Avoid_: assets folder, user workspace

**Project Workspace**:
一个具体内容项目的工作区，当前主要是单本小说。
_Avoid_: workspace

**Project Root**:
Project Workspace 在 Workspace Root 下的单段相对 root，例如 `ming-ding-zhi-shi-2`。公开 API 使用 `projectRoot`，不带 `workspace/` 前缀。
_Avoid_: Project Path, projectId, novelId, database id

**Current Project**:
Agent Session 或前端工作面当前绑定的 Project，由可选 `currentProjectRoot` 持久化。为空表示没有 Current Project；运行时 admission 必须把它解析成精确 ready Project handle。
_Avoid_: workspaceKey, projectPath, route intent

**Project Surface**:
前端当前已完成 `open + presence_ready + bootstrap`、可以挂载 Project 数据面的工作面。切换 Project 时先释放旧 surface 和本标签页 presence，再打开目标；route intent、opening 和 reconnecting 都不是 Project Surface。
_Avoid_: candidate handoff, route project, globally closed Project

**Session Recovery**:
Session schema v2 中因无法确定 Current Project 而需要用户确认的状态，只用 `migrationReview.reason = "current_project_unresolved"` 表达。它不表示历史工具参数需要重放，也不阻断其他 Session 或整个实例升级。
_Avoid_: migration warning list, release-level manual migration

**Runtime Workspace Root**:
每次 Agent invocation 从当前 State Root 注入的绝对 Workspace Root。它不写入 Session metadata；`RunFrame` 与工具上下文只携带该绝对 root 和可选的 exact ready Project handle。
_Avoid_: session workspaceRoot, persisted cwd, Installation Root

**File Scope**:
文件工具与 bash 在一次 Agent invocation 中共用的物理 cwd。绑定 Current Project 时是该 Project Workspace；未绑定时是 Workspace Root。它只决定普通相对路径的解析基准，不是绝对路径权限边界，也不是持久化 identity。
_Avoid_: WorkspaceRootRef, persisted workspace path, Project Path

**Project File Address**:
显式跨 Project Workspace 的文件地址，固定为 `workspace/{project-root}/{relative-path}`。它经过 Project open gate并保留 History、Context Access 和变更记账身份；它是文件输入语法，不是 Session 持久化 identity。
_Avoid_: project-slug relative alias, inferred project path

**Project Manifest**:
Project Workspace 根目录中描述项目类型、标题、摘要等展示元数据的 `project.yaml` 文件。
_Avoid_: Novel row, workspace.yaml, project metadata

**Project Workspace Issue Index**:
从 Project Workspace 文件派生出的校验问题索引，用于前端展示当前已知的问题状态。
_Avoid_: validation truth, workspace issues

**Project Workspace File Index**:
从 Project Workspace 文件系统构建的内存索引，保存文件节点、frontmatter、state、refs 和路径存在信息。它是弱一致 snapshot：目录枚举后消失的路径可以被本轮扫描忽略，只有 `ENOENT` 可被吸收，权限、越界和磁盘错误仍必须失败。
_Avoid_: tree cache, validation table

**Project Runtime Artifact**:
NeuroBook 从 Project Workspace 源文件派生、可随时重建、只供运行时执行或缓存使用的文件。它属于 Project Workspace `.nbook` 控制区，不是项目内容，不进入文件历史、Agent 文件变更提醒、Project Workspace File Index 或 Project 下载包。
_Avoid_: project content, source file, Project SQLite

**Rebuildable Runtime Artifact**:
NeuroBook 从源码、配置或发布真相源派生并持久化的运行文件，删除后可以重建且不会丢失用户内容，但必须有明确 owner、可达集合和硬容量预算。
_Avoid_: user data, source asset, unbounded cache

**Canonical Image**:
由具体业务领域拥有、保持上传或快照时原始 bytes 的当前图片。Agent Attachment 的 canonical image 属于 Attachment Store；Project 封面属于 Project Workspace。它不等于派生缩略图，也不要求跨领域统一 ID。
_Avoid_: media asset, thumbnail, transcoded original

**Image Variant**:
领域路由完成授权后，由共享 Image Variant Module 按规范化尺寸、fit 和 quality 从 Canonical Image 派生的固定 WebP。它只用于显示，不进入 Agent Provider、Project 内容或原图持久化。
_Avoid_: canonical image, uploaded cover, provider image

**Image Variant Cache**:
位于 `Cache Root/image-variants/` 的有界可重建缓存；只有未显式配置 Cache Root 时，它才默认落在 `State Root/cache/image-variants/`。它不属于 Application State migration、Project Runtime Artifact、Project Workspace File Index、History 或下载归档。
_Avoid_: media library, project asset, backup data

**Application State Catalog**:
由 Product 定义的有序持久状态迁移合同。Manager 只消费严格 JSON plan/apply/resume/rollback 报告并在候选 Product 健康后提交；历史 catalog parser 只存在于 migration Module，runtime 只接受 current complete sentinel。
_Avoid_: application-version migration, Nitro auto migration, Manager-owned Session decoder

**Published Profile Artifact**:
由 Profile Publisher 发布、受 current manifest 引用的内容寻址不可变 Profile 编译产物，是 Profile 的运行真相而不是普通缓存。
_Avoid_: runtime import cache, source profile, temporary bundle

**Runtime Import Cache**:
为保证 Bun 和 Product 能按内容身份动态导入 ESM 而创建的可删除物理副本，不是发布真相源并必须受 retention policy 约束。
_Avoid_: published artifact, release manifest, permanent module store

**Project Workspace Download Archive**:
Project Workspace 的可携带完整备份。它包含普通项目文件、独立一致的 Project SQLite snapshot，以及项目已存在时的完整 History SQLite snapshot；不复制 live WAL/SHM。History SQLite 可能包含全文快照、已删除内容、acceptance 和 session cursor，分享前必须评估隐私风险。
_Avoid_: live database copy, log archive, content-only export

**Imported Reference**:
导入到 Project Workspace `reference/` 下的外部原始素材、解包结果、低置信迁移材料和报告。
_Avoid_: canon, lorebook, runtime state

**Canonical Lorebook Entry**:
Project Workspace `lorebook/` 下的稳定作品说明书条目，用于保存 canon、prototype、世界规则、角色设定、地点、物品、系统和作品级 AI 指令。
_Avoid_: imported reference, subject knowledge, runtime state

**Dynamic Migration Note**:
从外部系统导入但暂不能直接运行或稳定入库的动态机制迁移记录，例如 SillyTavern MVU、Prompt Template、regex、状态栏、Tavern Helper 脚本或变量规则。
_Avoid_: runtime implementation, canonical lorebook entry, subject knowledge

**Subject-facing Knowledge**:
`simulation/subjects/{id}/knowledge.md` 中记录的主体视角知识，只包含该 subject 已经知道、被告知、观察、推断或误解的信息。
_Avoid_: lorebook, omniscient context, imported reference

**Boot Config**:
启动和部署期配置，修改后需要重启服务才能可靠生效。
_Avoid_: settings, runtime preference

**Process Environment**:
进程启动时实际生效的环境变量集合，是数据库运行时配置的执行真值源。
_Avoid_: config mirror, settings

**Global Config**:
单用户全局运行配置，位于 Workspace Root `.nbook/config.json`。
_Avoid_: boot config, project config

**Model Library**:
NeuroBook 维护的只读标准模型资料目录，按精确 model ID 保持唯一条目；保存模型身份与通用能力，只服务设置页候选补全和显式添加，不代表任意 Provider 实际提供该模型，也不参与 Agent runtime 解析。
_Avoid_: Provider model list, live registry, discovery result

**Provider Template Library**:
NeuroBook 维护的只读精选连接模板目录，包含 MiMo Token Plan 等尽量只需 Secret 即可创建的模板，以及 Custom Provider 创建入口。
_Avoid_: Model Library, Provider Config, runtime provider

**Provider Template**:
Provider Template Library 中的一条只读创建资料，提供名称、Pi API、Base URL、鉴权、request options、内部发现 hint 和可选推荐 model ID；实例化后得到普通 Provider Config 草稿，保存结果不保留模板引用。
_Avoid_: Provider Config, runtime provider, credential profile

**Provider Config**:
Global Config 中用户保存的完整 Provider 连接与模型能力配置；包含本地 ID、连接参数和自包含模型列表，是模型 runtime 的唯一配置真值源。所有已保存模型无论是否启用都必须能力完整；`enabled` 只表达是否允许选择和运行。
_Avoid_: Provider Template, Pi Provider ID, discovery result

**Provider Model API**:
Provider Config 中用于创建新模型候选的连接级 Pi API 提示，配置字段名为 `modelApi`。Provider Template 可以预填，Custom Provider 可以由用户选择，已保存 Provider 也可以直接修改；它不属于 Provider Config ID、Base URL 与 proxy 组成的凭据连接身份。它只参与 Automatic Model Discovery、手动添加和 Model Library 候选补全，runtime 不得从它回退，最终执行格式必须保存到每个模型自己的 `model.api`。
_Avoid_: Discovery Adapter, runtime API fallback, model capability

**Automatic Model Discovery**:
用户在设置页显式触发的一次性模型发现操作。Implementation 按已知主机或连接级 `modelApi` 选择 OpenAI/OpenRouter/Google Adapter，不会因为响应失败把同一 Secret 切换到另一种认证形式；结果只存在于当前前端发现会话，Provider Config 不保存 Adapter 或 endpoint path。
_Avoid_: Provider Config field, runtime refresh, user-configured discovery adapter

**Discovered Model Candidate**:
Automatic Model Discovery 返回的前端临时模型候选，允许字段不完整；远端字段优先，Model Library 只按精确 model ID 补缺，只有补全并通过 Provider Config 合同后才能保存。
_Avoid_: Provider Config model, Model Library entry, disabled model draft

**App SQLite**:
应用级 SQLite 数据库，位于 Workspace Root `.nbook`，保存用户、鉴权和 Global Config，不记录 Project Workspace。
_Avoid_: project database, SQLite Data File

**Project SQLite**:
Project Workspace-local SQLite 数据库，位于 Project Workspace `.nbook`，保存 Story、StoryPhase、Plot、Scene 和其他项目级结构化数据。
_Avoid_: app database, global database, Novel database

**Controlled SQLite Tool**:
Agent 使用的受控 SQLite 查询工具，只操作当前 Project Workspace 的 Project SQLite，并集中限制危险 SQL。
_Avoid_: Postgres SQL tool, generic SQL tool, bash-only database access

**Agent Steer**:
Agent 运行期间追加的带前缀纠偏消息，会在当前 assistant turn 和 tool results 完成后、下一次模型调用前进入上下文。
_Avoid_: interrupt, next turn, follow-up

**Agent FollowUp**:
Agent 运行期间追加的后续消息，会在当前 run 本来要停止时进入下一轮上下文。
_Avoid_: steer, continue, retry

**Agent ReAct Loop**:
一次 Agent 从当前上下文开始，交替生成 assistant message、执行 tool results，并在无后续 tool calls 时停止的运行循环。
_Avoid_: invocation, session, queue

**Agent Continue**:
不新增用户消息、从当前 session 尾部继续运行的 Agent 调用。
_Avoid_: follow-up, prompt, resume message

**Agent Queued Message**:
尚未被 harness drain 的 Agent Steer 或 Agent FollowUp 消息。
_Avoid_: optimistic chat message, command

**Agent Queue Event**:
Agent Queued Message 入队时通过 session event hub 广播的运行态事件。
_Avoid_: session entry, consumed event, chat message

**Agent Dialogue Content**:
Agent session active path 中用户和 assistant 的可见正文文本，用于派生 session 展示元数据。
_Avoid_: tool result tokens, thinking tokens, raw context tokens

**Agent Summarizer Profile**:
用于维护另一个 Agent session 展示标题和摘要的后台 profile。
_Avoid_: linked agent, visible subagent, user-facing agent

**Agent Summarizer Session**:
运行 Agent Summarizer Profile 的后台 session，绑定一个源 Agent session 但不作为 linked agent 展示。
_Avoid_: linked session, child agent, visible agent

**History-Frozen Agent Session**:
有 session 身份和初始化历史，但运行过程中不持久化 assistant/toolResult transcript 的 Agent session。这是观察到的会话行为，不是 runtime public API enum；实现上由 runtime hooks 组合表达。
_Avoid_: sessionless agent, no-session profile, normal transcript session

**Agent Summarizer ModelContext**:
Agent Summarizer Profile 每次模型调用时使用的上下文，由 summarizer system prompt 和从源 session 当前 active path 提取的 Agent Dialogue Content 组成。
_Avoid_: summarizer history, diagnostic transcript, incremental summary context

**Agent Summarizer Trigger**:
源 Agent session 完成后请求后台维护展示标题和摘要的运行信号。
_Avoid_: leader invocation, user prompt, linked agent call

**IDE Mode**:
NeuroBook 主界面中以 Studio 编辑体验为中心的布局模式，Agent chat surface 位于右侧辅助槽位。
_Avoid_: editor page, normal mode

**Agent Mode**:
NeuroBook 主界面中以 Agent chat surface 为中心的布局模式，左侧显示当前 Project Workspace 的 session 导航，右侧显示 Studio。
_Avoid_: agent drawer, chat-only page

**Agent Chat Surface**:
承载一个 Agent session 的消息流、输入框、运行状态、模型 / Plan Mode / 审批恢复等交互的可移动界面表面；它可以在 IDE Mode 的右侧槽位或 Agent Mode 的中间槽位展示。
_Avoid_: drawer-only component, separate chat implementation

**Agent Session Pin**:
当前客户端对某个 Agent session 的本机列表排序偏好，用于在当前 Project Workspace 的 Agent Mode session 导航中置顶会话。
_Avoid_: session metadata, durable conversation fact, linked agent relation

**Studio**:
Project Workspace 的文件化创作工作区表面，包含文件树、已打开文件和 Markdown Studio 等编辑能力；在 IDE Mode 中是中心，在 Agent Mode 中是右侧辅助区。
_Avoid_: files-only panel, workspace switcher

## Relationships

- **Workspace Root `.nbook`** belongs to exactly one **Workspace Root**.
- An **Installation Root** owns Source, Product, Runtime and Deployment State components.
- A **Product Runtime Image** belongs to one exact Source identity and platform; only its ready marker makes it publishable.
- A **Product Runtime Contract** belongs to one Product Runtime Image; every executable consumer must resolve logical commands through it.
- A **Profile Authoring Kit** belongs to one Product Runtime Image revision and is the only ordinary Product package root for Profile compilation.
- A **Profile Authoring Interface** belongs to the Product SDK contract; SDK implementation dependencies do not automatically become author imports.
- A **Variable Authoring SDK** belongs to the Product SDK contract and is distinct from the richer host Variable runtime.
- A **State Root** belongs to one Installation Root and owns Boot Config、Product Env、logs and one logical Workspace Root.
- A **Cache Root** belongs to one installation locator set, but each cache Module owns its own reachable set and hard budget.
- A **Desktop Local Root** belongs to the Desktop Envelope; its WebView Root is not part of Product RuntimePaths or content backup.
- A **Desktop Distribution Manifest** describes portable/installable component identities; it is not a user-state or installation manifest.
- A **Desktop Supervisor Protocol** carries Manager lifecycle events over stdin/stdout NDJSON; it does not expose Product internals to the Envelope.
- A **Desktop Envelope** owns native window and device interaction while Product owns business APIs and application shutdown.
- A **Windows Release Zip** extracts directly into one **Installation Root**.
- An **Owned Process** belongs to one runtime lease; terminating that lease must not affect another Owned Process or an external user process.
- Agent Bash and the Windows Portable foreground Product are **Owned Process** consumers; their Agent Job and Installation state machines remain separate domain owners.
- Windows Portable uses `data/` as State Root, so its physical Workspace Root is `data/workspace/` while Project Path remains `workspace/{project-slug}`.
- **NeuroBook Manager** updates component-owned paths and must not overwrite State Root user data.
- **Global Config** lives in **Workspace Root `.nbook`**.
- A **Provider Template** may create one **Provider Config**, but the saved Provider Config does not retain a reference to the template.
- A **Provider Config** owns its Base URL, credentials, request options and complete user model list; it does not persist Automatic Model Discovery strategy.
- A **Provider Config** may own one editable **Provider Model API** for new candidate completion; changing it does not change the Provider connection identity or any saved model, while runtime reads only each model's final `model.api`.
- A **Model Library** entry may supplement a Discovered Model Candidate by exact model ID, but it does not assert that the current Provider offers that model.
- **Automatic Model Discovery** returns frontend-temporary Discovered Model Candidates through internal Adapters; users do not configure or persist Adapter selection.
- A **Discovered Model Candidate** must become complete before it can enter a Provider Config; incomplete candidates cannot be persisted by setting `enabled=false`.
- Agent runtime never queries the Model Library, Provider Template Library or Automatic Model Discovery.
- **App SQLite** lives in **Workspace Root `.nbook`**.
- **Project SQLite** lives in exactly one **Project Workspace `.nbook`**.
- **Project Path** locates exactly one **Project Workspace** under a **Workspace Root**.
- **Agent Workspace Root Reference** is persisted in an Agent session and resolves to one current **Agent Workspace Filesystem Root** for each invocation.
- Managed **Agent Workspace Root Reference** values are portable across Installation Root and State Root moves; their resolved **Agent Workspace Filesystem Root** is not persisted.
- **File Scope** is projected for each invocation from the session's Agent Workspace Root Reference and optional Project Path; it is not persisted as an absolute path.
- Project-bound file tools use Project-relative paths inside the current File Scope; cross-project file access uses a **Project File Address**.
- **Project Manifest** lives at the root of exactly one **Project Workspace** and stores display metadata.
- **Project Workspace File Index** belongs to one **Project Workspace** and is refreshed from file scans or file watcher events.
- A **Project Workspace File Index** is a weakly consistent filesystem snapshot: paths that disappear during enumeration may be omitted, while non-`ENOENT` I/O failures remain errors.
- **Project Workspace Issue Index** belongs to one **Project Workspace** and can be rebuilt from its files.
- **Project Workspace Issue Index** is derived from **Project Workspace File Index** plus validation rules.
- A **Project Runtime Artifact** is derived from Project Workspace source files and may be deleted and rebuilt without losing project content.
- A **Project Runtime Artifact** must not enter Project Workspace file history, Agent file-change notices, Project Workspace File Index or Project downloads.
- A **Project Runtime Artifact** is one kind of **Rebuildable Runtime Artifact**.
- A **Published Profile Artifact** is a **Rebuildable Runtime Artifact**, but a current manifest reference makes it non-evictable.
- A **Runtime Import Cache** contains evictable copies of **Rebuildable Runtime Artifacts** and never defines the current Profile release.
- A **Project Workspace Download Archive** contains standalone snapshots of Project SQLite and, when present, History SQLite; it never copies their live WAL/SHM sidecars.
- History SQLite in a **Project Workspace Download Archive** is complete backup data and may retain full text, deleted content, acceptance state and session cursors.
- Every History consumer must obtain its `WorkspaceHistory` through the host opening seam, which purges no-longer-managed paths before returning the instance; a ProjectSession that never uses History does not open the database solely for this maintenance.
- **Imported Reference** may be transformed into **Canonical Lorebook Entry** only after classification and confidence checks.
- **Dynamic Migration Note** belongs in **Imported Reference** until a later migration step turns it into simulator, writer, subject, entity, Plot, or lorebook material.
- **Subject-facing Knowledge** must not be generated by directly copying a full **Canonical Lorebook Entry** or **Imported Reference**.
- A **Canonical Lorebook Entry** is omniscient project material; visibility to a subject requires filtering into **Subject-facing Knowledge** or a simulator leader message.
- **Project SQLite** stores project data but does not define project identity or display metadata.
- **App SQLite** must not record Project Workspace identity, path, status, or recent project index.
- **Boot Config** may mirror **Process Environment** with `${NAME}` templates but does not override it.
- **Controlled SQLite Tool** targets the current **Project SQLite** only and must not access **App SQLite**.
- **Project Workspace** is portable project data; it may own **Project SQLite** but should not own users or authentication state.
- **Agent Queued Message** is either an **Agent Steer** or an **Agent FollowUp**.
- **Agent Steer** affects the next model call inside an active **Agent ReAct Loop**.
- **Agent FollowUp** starts or continues work after an **Agent ReAct Loop** would otherwise stop.
- **Agent Continue** must not create an **Agent Queued Message**.
- An **Agent Queue Event** announces an **Agent Queued Message** before it becomes a session message.
- A consumed **Agent Queued Message** becomes a normal user message in session history.
- Pending **Agent Steer** messages are all consumed together at the same steer point.
- Pending **Agent Steer** messages prevent the current **Agent ReAct Loop** from stopping and cause another model call in the same loop.
- Pending **Agent FollowUp** messages are consumed one at a time only after an **Agent ReAct Loop** has no tool calls and no pending **Agent Steer** messages.
- **Agent Dialogue Content** excludes tool calls, tool results, and thinking content.
- **Agent Dialogue Content** excludes harness reminders, profile/model-context injected messages, and custom messages unless the content boundary is explicitly expanded later.
- An **Agent Summarizer Session** belongs to exactly one source Agent session.
- An **Agent Summarizer Session** must not create a linked-agent relationship with its source Agent session.
- An **Agent Summarizer Session** is a **History-Frozen Agent Session**, not a sessionless profile.
- An **Agent Summarizer Profile** reports session display metadata; it must not change the source Agent session's conversation history.
- An **Agent Summarizer Trigger** is transparent to the source Agent session's user-facing result.
- Concurrent **Agent Summarizer Triggers** for the same source Agent session coalesce into latest-only background work.
- An **Agent Summarizer Session** rebuilds **Agent Dialogue Content** from the source session's current active path for each run.
- An **Agent Summarizer Session** does not persist its own assistant messages, tool calls, or tool results as conversation history.
- An **Agent Summarizer ModelContext** uses an empty AppendingSet and receives freshly rebuilt **Agent Dialogue Content** from the source session.
- An **Agent Summarizer Session** is created by the harness as a background system session, not by the normal linked-agent `parentSessionId` creation path.
- **Agent Dialogue Content** includes compaction messages when they are on the source session's active path.
- **Agent Dialogue Content** should be rendered as a stable transcript with explicit source labels before it is summarized.
- An **Agent Summarizer Session** reuses the source session's compaction result indirectly because compaction entries are part of **Agent Dialogue Content**.
- **IDE Mode** and **Agent Mode** are alternate layouts of the same current **Project Workspace**; switching modes must not imply project switching.
- **Agent Chat Surface** is shared by **IDE Mode** and **Agent Mode** rather than implemented as two separate chat UIs.
- In **IDE Mode**, **Studio** is the primary center workspace and **Agent Chat Surface** occupies the right-side support slot.
- In **Agent Mode**, **Agent Chat Surface** is the primary center workspace and **Studio** occupies the right-side support slot.
- Switching between **IDE Mode** and **Agent Mode** must preserve the active **Agent Chat Surface** state, including streaming output, SSE recovery state, input draft, and scroll position.
- An **Agent Session Pin** belongs to local UI preference for the current client and must not be written as an Agent session JSONL history fact.

## Example dialogue

> **Dev:** "If I zip a Project Workspace and move it to a new NeuroBook install, do I need the old App SQLite too?"
> **Domain expert:** "No. The Project Manifest, manuscript/lorebook files, Project Config, and Project SQLite travel together. The new App SQLite only keeps its own users and global settings, and the project is located by its Project Path."

> **Dev:** "The Agent is running and I type another instruction. Is that Continue?"
> **Domain expert:** "No. If it should affect the next model call, it is Agent Steer; if it should wait until the run would stop, it is Agent FollowUp. Agent Continue adds no new user message."

> **Dev:** "Should the session summarizer show up as a linked agent?"
> **Domain expert:** "No. It is an Agent Summarizer Session: a background system session that reads Agent Dialogue Content and reports display metadata."

## Flagged ambiguities

- "项目级数据库存 User 表" was used ambiguously. Resolved: **User** belongs to **App SQLite**; **Project SQLite** must not carry users, sessions, or administrator state.
- "NovelId" was used as both project identity and Plot anchor. Resolved: Project runtime identity is **Project Path**; Project SQLite is single-project and does not need a global `Novel` row or numeric `novelId`.
- "Project Index" was proposed as rebuildable App SQLite state. Resolved: **App SQLite** must not record Project Workspace identity or status; Project Workspace discovery scans `project.yaml`.
- "projectId" was proposed as immutable packaged identity. Resolved: no projectId is required in the current design; **Project Path** is the runtime locator and `project.yaml` carries display metadata.
- "workspaceIssues" was used as both UI state and validation truth. Resolved: known issues are a **Project Workspace Issue Index**, a rebuildable materialized index derived from Project Workspace files.
- "tree cache" and "validate table" were used to describe the same optimization. Resolved: file metadata belongs to **Project Workspace File Index**; validation results belong to **Project Workspace Issue Index**.
- "引导", "队列", and "continue" can sound like the same running-session action. Resolved: **Agent Steer** changes the next model call, **Agent FollowUp** waits until the run would stop, and **Agent Continue** adds no user message.
- "queued event" was used like a durable chat entry. Resolved: an **Agent Queue Event** is only runtime state; a consumed **Agent Queued Message** becomes durable history when it is written as a normal user message.
- "steer priority" was used too broadly. Resolved: **Agent Steer** is checked before loop stop; pending **Agent Steer** keeps the current **Agent ReAct Loop** alive, while **Agent FollowUp** only runs after the loop has no tool calls and no pending steer.
- "steer text" was treated as raw user text. Resolved: **Agent Steer** must carry a model-visible prefix aligned with the Codex harness convention.
- "one at a time" was used ambiguously for queues. Resolved: **Agent Steer** uses all-at-steer-point drain; **Agent FollowUp** uses one-at-a-time drain after the loop stops.
- "摘要 agent" was used like a normal visible agent. Resolved: session title/summary maintenance uses an **Agent Summarizer Profile** and **Agent Summarizer Session**, not a linked agent.
- "会话正文 Token" mixed content boundary with token measurement. Resolved: **Agent Dialogue Content** names the content boundary; token counts are a measurement over that content.
- "summary" can mean session display summary, compaction summary, or branch summary. Resolved: **Agent Summarizer Profile** only owns session display metadata.
- "摘要上下文 append-only" was used too broadly. Resolved: source session history remains append-only, but **Agent Summarizer Session** rebuilds Agent Dialogue Content from the current active path each run.
- "摘要者诊断历史" conflicted with history-frozen summarizer semantics. Resolved: **Agent Summarizer Session** does not persist its own ReAct transcript; diagnostics come from state, lifecycle, source session, and runtime logs.
- "sessionless summarizer" was too imprecise. Resolved: summarizer has a session identity and initialization history, but behaves as a **History-Frozen Agent Session** after initialization.
- "portable workspace" can mix program files with user data. Resolved: **Installation Root** names program/component ownership, **State Root** names physical user state, and **Workspace Root** names the logical project container.
- "Windows portable" sounded like a separate updater protocol. Resolved: **Windows Release Zip** is the `windows-portable` Profile assembled from the same Source/Product/Runtime/Tool components and operated by **NeuroBook Manager**.
- "data/workspace" exposed a platform-specific Project Path. Resolved: Windows Portable stores data physically under `data/`, but public Project Path remains `workspace/{project-slug}`.
