# Workspace Terms

本文件定义 NeuroBook 中 workspace 相关术语。后续文档、代码注释、API 命名和设置页文案都应优先引用这些词，避免把 `workspace` 同时用于多个层级。

## Terms

- **Installation Root**：NeuroBook 源码与 `.output`、`.runtime`、`.deploy` 组件的统一程序根；它不是 Workspace Root。
- **State Root**：运行状态的物理根。默认等于 Installation Root；Windows Portable 为 `Installation Root/data/`。
- **Workspace Root**：应用运行数据根目录，默认是 `workspace/`。它只是数据容器，不直接表示某本小说或某个项目。
- **Workspace Root `.nbook`**：Workspace Root 的全局控制区，默认是 `workspace/.nbook/`。它保存 Global Config、用户 assets、全局 Agent 资源覆盖层和后续全局运行状态。
- **Project Workspace**：一个具体内容项目的工作区，当前主要是单本小说，默认是 `workspace/{project}/`。它保存 manuscript、lorebook 等项目内容。
- **Project Root**：Project Workspace 在 Workspace Root 下的单段相对 root，例如 `ming-ding-zhi-shi-2`。Project API 使用 `projectRoot`，不带 `workspace/` 前缀。
- **Current Project**：Agent Session 或前端工作面当前绑定的 Project。Session schema v2 只持久化可选 `currentProjectRoot`；运行时 admission 将它解析成 exact ready Project handle。
- **Project Surface**：前端已完成 `open + presence_ready + bootstrap`、可以挂载 Project 数据面的工作面。route intent、opening 和 reconnecting 都不算 Project Surface。
- **Session Recovery**：Session schema v2 中唯一的待确认状态，表示旧 header 无法确定 Current Project；它与 `currentProjectRoot` 互斥，用户可重绑 Project 或明确改为 Workspace Root Session。
- **Runtime Workspace Root**：每次 Agent invocation 从当前 State Root 注入的绝对 Workspace Root。它不写入 Session metadata。
- **File Scope**：文件工具与 bash 在一次 Agent invocation 中共用的物理 cwd。绑定 Current Project 时是当前 Project Workspace，未绑定时是 Workspace Root。File Scope 只决定普通相对路径的解析基准，不是绝对路径权限边界或持久化 identity。
- **Project File Address**：显式跨 Project 文件地址，形态为 `workspace/{project-root}/{relative-path}`。它经过目标 Project 的 open gate并保留 History、Context Access 与变更记账身份；它是文件输入语法，不是 `ProjectPath` brand 或 Session identity。
- **Workspace Root `.nbook` File Address**：显式 Workspace Root 全局控制区地址，形态为 `workspace/.nbook/{relative-path}`。它固定映射到 Workspace Root `.nbook`，不属于任何 Project，也不携带 Project History 或 Context Access 身份。
- **Project Workspace `.nbook`**：Project Workspace 的项目级控制区，默认是 `workspace/{project}/.nbook/`。它保存 Project Config、项目状态和项目私有元数据。
- **Project Runtime Artifact**：NeuroBook 从 Project Workspace 源文件派生、可随时重建、仅供运行时执行或缓存使用的文件。canonical 位置在 Project Workspace `.nbook`；它不是项目内容，不进入文件历史、Agent 文件变更提醒、Project Workspace File Index 或 Project 下载包。
- **Project Workspace Download Archive**：Project Workspace 的可携带完整备份。普通文件继续遵守 `.gitignore`，`project.yaml`、Project Config、Project SQLite 和已有 History SQLite 强制纳入；两个 SQLite 使用独立在线 snapshot，不复制 live WAL/SHM。History SQLite 可能包含全文、删除内容、acceptance 与 session cursor，分享前必须评估隐私风险。
- **user-assets**：前端用于编辑 Workspace Root `.nbook` 的入口。它不是独立配置层，而是把当前 Studio 挂载在 `workspace/.nbook/`。
- **Bundled Workspace Template**：随项目发布的默认 workspace 模板与系统资源，位于 `assets/workspace/`。
- **Seed Root**：Bundled Workspace Template 中的 `agent/{skills,workflows,profiles}/`，是随程序附带的 Agent 资产种子包仓库。它是只读的，**不是 catalog 层**；catalog 不从这里加载资产，安装器只把它当作来源之一。见 [Agent Asset Install Protocol](../agent/agent-asset-install.md)。
- **Install Root**：Workspace Root `.nbook` 下的 `agent/{skills,workflows,profiles}/`，是已安装 Agent 资产的落点与 provenance 账本所在位置。它在 State Root 之下，随 Windows Portable 的 `data/` 一起搬移。

## Path Mapping

- `assets/workspace/.nbook` 是系统模板层，映射到运行时 `workspace/.nbook`。
- `NEURO_BOOK_STATE_ROOT` 决定 State Root；Workspace Root、Boot Config、Product Env 和日志都从 State Root 解析。
- Windows Portable 的物理 Workspace Root 是 `data/workspace/`，但 Project API 的 `projectRoot` 仍是同一个单段 root。
- 用户的 `workspace/.nbook` 可以覆盖系统 `assets/workspace/.nbook`，但**这条只对 `templates/` 与 `variables/` 成立**。`agent/{skills,workflows,profiles}/` 已改为包安装模型：Seed Root 不参与覆盖，资产由安装器装进 Install Root，catalog 层级是 `Install Root → Project Root`。见 [Agent Asset Install Protocol](../agent/agent-asset-install.md)。
- `assets/workspace/global.config.example.json` 对应运行时 `workspace/.nbook/config.json` 的示例。
- `assets/workspace/workspace.config.example.json` 对应运行时 `workspace/{project}/.nbook/config.json` 的示例。
- user-assets 入口直接编辑 `workspace/.nbook`，不再使用 `workspace/.nbook/assets` 作为嵌套资产根。
- Project-bound Agent 的 File Scope 是当前 Project Workspace。当前项目优先使用 `manuscript/...`、`lorebook/...`、`reference/...`；任意已知文件系统目标可直接使用绝对路径；访问另一个 Project 且需要保留 Project 领域身份时，使用完整 Project File Address `workspace/{project-root}/...`。
- 统一 File Address resolver 将 `workspace/.nbook/...` 明确映射到 Workspace Root `.nbook`。Agent 图片附件的 canonical Markdown 目标固定为 `workspace/.nbook/agent/attachments/sha256/<2位>/<62位>`，但公开读取仍必须经过当前 Session 的 Authority 与 entry locator；该地址本身不是 Attachment 授权凭证，也不能作为 snapshot 读取 Attachment Store 的旁路。
- Project Runtime Artifact 固定写入 Project Workspace `.nbook` 控制区；源码目录旁的旧 runtime artifact 位置只用于迁移清理，不再作为当前写入位置。
- Project Workspace Download Archive 在 OS 临时目录准备 SQLite snapshot，不向 Project Workspace 写入打包中转文件；Project SQLite 与 History SQLite 分别一致，但不承诺与普通文件构成跨存储全局事务。
- Agent Session schema v2 只保存可选 `currentProjectRoot`。每次 invocation 从当前 State Root 注入绝对 Runtime Workspace Root，并把 `currentProjectRoot` admission 为 exact ready Project handle；Windows Portable 移动完整 `data/` 后仍解析到新的 `data/workspace/{project-root}/`。
- 前端普通 Project 切换先释放旧 Project Surface 和本标签页 presence，再打开目标；它不调用全局 Project close，因此不会主动中断其他标签页或后台 Agent。
- Current Project Workspace决定Project-bound invocation的File Scope；它只决定相对路径起点，不限制绝对路径可访问范围。
- 绝对路径是直接文件系统地址，不从物理位置反推managed Project身份；Project外绝对写入不进入Project History、Inbox或Context Access。若这些Project语义重要，使用显式Project File Address。
- 仓库源码根、仓库级 `reference/` 与其他File Scope外文件可通过调用方已知或提供的绝对路径访问；运行时不再注入一套仓库根专用提醒。

## Naming Rules

- 不要把 Workspace Root 缩写成 workspace 来表达 Project Workspace。
- 不要把 Project Workspace 缩写成 workspace。
- 不要把 **Installation Root** 或 **State Root** 称为 Workspace Root；前者是程序组件根，后者是状态物理根，Workspace Root 是项目数据容器。
- 当讨论单本小说/项目的文件根时，使用 **Project Workspace**。
- 当讨论全局用户资产、全局配置、Agent profiles/skills 覆盖层时，使用 **Workspace Root `.nbook`**。
- 当讨论前端入口时，`user-assets` 只表示 Studio 挂载目标，不表示新的配置 scope。
