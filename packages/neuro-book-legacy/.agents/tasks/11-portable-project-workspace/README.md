# Portable Project Workspace

> 2026-07-31 CLI 路径取代说明：下文 `assets/workspace/.nbook/agent/scripts/workspace.ts` 与旧同步链只保留为历史证据。当前 Agent 稳定入口为 `.nbook/agent/bin/workspace`；Workspace CLI implementation 归 Product 领域 Module，Source checkout wrapper 调 Product-owned source entry，发行物通过 Task 130 的 Product Runtime Contract 解析 `workspace` 逻辑命令，不恢复旧 asset script fallback。

> 2026-07-11 Workspace 语义补充：普通 Agent 的工具 cwd 始终是 Workspace Root；Project Slug 是单段目录名，Project Path 固定为 `workspace/{slug}`。Current Project Workspace 只是模糊项目操作的默认焦点，不是访问边界。文件工具使用 `{project-slug}/...`，项目级 API 使用 `workspace/{project-slug}`；所有受管 Project Workspace 都可跨项目访问。仓库源码与仓库级 `reference/` 位于 cwd 外，通过 Runtime Location reminder 给出的绝对路径访问。

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## User Request

- 制定一次重构计划，使 Project Workspace 能脱离运行环境并随时打包带走。
- 彻底移除 PostgreSQL 依赖，后续项目不再兼容 PostgreSQL。
- `execute_sql` 改为 SQLite-only，只操作当前 Project Workspace 的 `.nbook/project.sqlite`，并移除 PostgreSQL 兼容。
- 评估是否删除 `execute_sql` 工具，改为让 Agent 通过 `bash` 操作数据库。
- 应用级数据库仍然保留，用于保存 `User` 等全局数据；`User` 不进入 Project Workspace-local SQLite。
- Project Workspace 级数据库允许文件化，路径使用相对 path，便于打包迁移。
- 任务最后一步必须同步修改 `README.md`、`docs/operator-bridge.md`、`scripts/migrate-config-system.ts`、`scripts/deploy.mjs`和当时的旧部署脚本。

## Goal

- Project Workspace 目录本身包含该项目可迁移的定位、展示元数据、内容、剧情结构和项目级配置。
- 复制或压缩一个 Project Workspace 后，换一台机器仍能恢复项目内容和 Plot / Story 数据。
- 全局应用数据库只保存用户、鉴权和全局配置，不记录 Project Workspace 身份、路径、状态或最近项目。
- 数据库运行时收敛为 SQLite-only，删除 PostgreSQL schema、adapter、部署入口、文档和兼容分支。
- Agent 操作结构化数据时通过受控 SQLite 工具访问当前 Project Workspace 的 Project SQLite，不再依赖当前环境里的单一全局数据库。

## Assumptions

- `User` 表属于应用级全局数据库，不进入 Project Workspace-local SQLite。Project Workspace 打包迁移时不携带用户账号和登录态。
- Project Workspace-local SQLite 默认落在 Project Workspace `.nbook` 控制区，例如 `workspace/<project>/.nbook/project.sqlite`。
- Project Workspace-local SQLite 内部保存 Story / StoryPhase / Plot / Scene 等项目域数据；正文、设定、引用资产仍优先保存在文件树中。
- Project Workspace 使用相对 Workspace Root 的单段 Project Path 作为公开 API 和运行时定位标识。
- Project Workspace 根目录 `project.yaml` 保存 `kind`、`title`、`summary` 等展示元数据；当前设计不需要 `projectId`。
- 不再读取旧 `workspace.yaml`，也不做 legacy 双读。
- Project 重命名就是 Project Workspace 目录改名；`project.yaml.title` 是展示名，可以和 Project Path 不同。
- 最近打开项目可以保留在 Browser State / localStorage，不进入 App SQLite。
- Project Workspace 打包包含 `.nbook/config.json`；Global Config 中的 secret 不随 Project Workspace 打包。
- 本计划会覆盖 `docs/tasks/08-sqlite-first-database/README.md` 中 “Postgres 作为长期一等支持保留” 的旧决策。
- 旧 PostgreSQL 数据不提供内置迁移脚本。

## Current State

- 当前仓库已经完成 SQLite-first 双库运行时，默认 SQLite，但仍保留 PostgreSQL schema、migrations、adapter、部署脚本和文档入口。
- 当前 `execute_sql` 已有 SQLite / PostgreSQL 双 adapter，description、schema summary 和错误提示按 Database Kind 分支。
- 当前 Plot 系统仍依赖 `Novel` / `novelId`，业务数据位于应用级数据库，Project Workspace 删除或复制时无法天然携带 Plot 数据。
- 当前部署文档和脚本仍描述 Docker 内置 PostgreSQL、外部 PostgreSQL、`DATABASE_KIND=postgres` 等兼容路径。
- 当前应用级 SQLite 默认位于 Workspace Root `.nbook`，适合保存用户、鉴权和全局配置，但不适合作为单个 Project Workspace 的可携带数据边界。

## Success Criteria

- 新安装和部署路径不再出现 PostgreSQL 选项，也不需要 PostgreSQL 依赖、环境变量、compose override 或迁移脚本。
- 应用级 SQLite 可以 fresh migrate，至少包含 `User`、auth/session 相关表和全局配置必要系统表，且不包含 Project Workspace 索引表。
- 每个 Project Workspace 可以初始化、校验和迁移自己的 `.nbook/project.sqlite`。
- Project Workspace 打包后，根 `project.yaml`、manuscript/lorebook 文件、Project Config 和 Project SQLite 都在同一目录内。
- Plot API / Agent Plot 工具不再依赖全局数据库中的 `novelId` 来定位可迁移项目数据。
- `execute_sql` 不再包含 PostgreSQL 文案、adapter、错误提示或测试；本任务保留 SQLite-only 受控工具，且只允许访问当前 Project Workspace 的 `.nbook/project.sqlite`。
- README、operator bridge、部署脚本和迁移脚本全部改成 SQLite-only 叙事。

## Walkthrough

### 1. 收敛数据库边界

- 删除 PostgreSQL 作为支持目标：
    - 移除 `DATABASE_KIND=postgres` 运行分支。
    - 移除 `@prisma/adapter-pg` / `pg` 相关运行依赖和工具代码。
    - 移除 Postgres schema、migrations、migration runner、compose override 和部署询问。
    - 保留必要的历史文档引用，但标记为 archived / legacy，不作为当前运行合同。
- 明确两个 SQLite 边界：
    - App SQLite：默认 `workspace/.nbook/neuro-book.sqlite`，保存 `User`、auth 和 global config，不记录 Project Workspace。
    - Project SQLite：默认 `workspace/<project>/.nbook/project.sqlite`，保存 Story / StoryPhase / Plot / Scene 等项目级结构数据。

### 2. Project Manifest 与 Project SQLite

- Project Workspace 根目录使用 `project.yaml`，保存 `kind`、`title`、`summary` 等展示元数据；旧 `workspace.yaml` 不做 runtime legacy 兼容。
- Project SQLite 不负责生成、缓存或覆盖项目定位信息，也不需要 `Project` 表。
- 新增 Project SQLite resolver：
    - 输入 Project Workspace 相对 path，即 Project Path。
    - 扫描 Project Workspace 根目录 `project.yaml`，校验 manifest 存在且合法。
    - 返回 Project Workspace root 和 `.nbook/project.sqlite` 相对路径。
    - SQLite 文件缺失时，允许通过初始化/迁移流程创建。
- 新增 Project SQLite migration runner：
    - 每个 Project Workspace 独立记录 schema version。
    - 打开 Project Workspace 时检查并提示迁移。
    - CLI 支持单项目迁移与批量扫描迁移。
- Project SQLite 内保存相对路径：
    - 章节、引用、素材关系使用 `manuscript/...`、`lorebook/...` 等相对 Project Workspace 的路径。
    - 不保存宿主机绝对路径。
    - 不保存 `Project` / `Novel` 这类项目身份表；项目定位来自 Project Path，展示元数据读取根 `project.yaml`。
    - 可以使用通用元数据表保存 schema version / migration 记录和其他自定义元数据，例如 `Metadata(key, value)`；系统语义不从该表读取 Project Path、title、summary 或其他项目展示元数据。

### 3. Plot / Story 数据迁移

- 一次性把公开 Plot API 和 Agent Plot 工具从 `novelId` / `/api/novels/:novelId/...` 迁到 Project Workspace 语义。
- 删除 `Novel` / `novelId` 作为 Project SQLite 概念：
    - 新入口使用 Project Path。
    - 不保留旧 `/api/novels/:novelId/...` legacy API。
    - 迁移脚本可以读取旧 App SQLite 的 `Novel` / `novelId`，但 runtime 不把 `novelId` 写入 Project SQLite。
    - Project SQLite 是单项目数据库，不需要全局唯一 numeric `novelId`，也不需要 `Novel` 表。
    - 继续保留 Story / StoryPhase 等剧情层级；删除的是数据库层面的 Novel 身份锚点，不是剧情领域语言。
- 迁移现有数据：
    - 从 App SQLite 读取 `Novel` 与 Plot / Story 表。
    - 按 `Novel.workspaceSlug` 或 manifest 映射到 Project Workspace。
    - 为每个 Project Workspace 写入 `.nbook/project.sqlite`。
    - 迁移成功后 App SQLite 不保留 project index 或旧 `novelId` mapping。
- 对异常状态给可恢复错误：
    - DB 有 Plot 但 Project Workspace 缺失：报告 orphan project data，提供导出/重新绑定命令。
    - Project Workspace 有 manifest 但缺 Project SQLite：提示初始化。
    - Project SQLite 有数据但 manifest 缺失：提示补 manifest 或 adopt。
    - App SQLite 不记录 missing/invalid Project 状态；项目发现始终来自扫描 `project.yaml`。

### 4. `execute_sql` SQLite-only 方案

- 移除 PostgreSQL adapter、`information_schema`、Postgres 错误码和双 schema summary 分支。
- 如果保留 `execute_sql`，输入 schema 调整为：
    - `sql`：单条 SQL。
    - 不提供 `sqlitePath`、`mode` 或其他目标切换参数；权限保持当前工具语义，允许受限读写，继续禁止 DDL、多语句、事务控制和危险 PRAGMA。
- 默认目标：
    - 当前 Agent 有 `currentProjectWorkspace` 时，默认指向该 Project Workspace 的 `.nbook/project.sqlite`。
    - 没有当前 Project Workspace 时直接报错，不允许通过参数指定其他 SQLite 文件。
    - 禁止访问 App SQLite，避免 Agent 读取或修改 `User`、auth 和 Global Config。
- description 明确当前是 SQLite 文件工具：
    - schema discovery 使用 `sqlite_schema` / `PRAGMA table_info`。
    - 文件内容仍使用 `read` / `write` / `edit` / `apply_patch`。
    - 业务路径字段是 Project Workspace 相对 path，不是宿主机绝对 path。

### 5. 保留 SQLite-only `execute_sql`

本任务保留 SQLite-only `execute_sql`，但把它收敛为受控 SQLite 查询工具。

- 保留 `execute_sql` 的优点：
    - 可以集中做 SQL 安全边界、单语句限制、当前 Project SQLite 目标校验和审计日志。
    - Agent 不需要知道宿主机是否安装 `sqlite3` CLI。
    - 工具 description 可以稳定注入当前 Project SQLite schema summary。
    - 对写操作可以做更明确的错误提示和恢复建议。
- 删除 `execute_sql`、改用 `bash` 的优点：
    - 工具面更少，Agent 心智更接近真实文件系统。
    - 不需要维护一套 SQL 工具安全层。
    - 高级调试更自由，可以直接使用 `sqlite3`、脚本或临时查询文件。
- 风险：
    - `bash` 方案依赖运行环境携带 `sqlite3` CLI 或 Bun/Node 脚本。
    - SQL 安全边界和目标数据库选择更难统一提示，也更难避免误写 App SQLite。
    - schema summary 需要另一个上下文注入机制，否则 Agent 更容易猜表结构。

当前决策：保留 SQLite-only `execute_sql`，同时允许高级场景用 `bash`。`execute_sql` 不接收 SQLite 文件路径参数，只操作当前 Project Workspace 的 Project SQLite。

### 6. CLI 与恢复能力

- 新增或扩展 `workspace project` CLI：
    - `workspace project create`
    - `workspace project validate`
    - `workspace project init-db`
    - `workspace project migrate-db`
    - `workspace project pack`
    - `workspace project adopt`
    - `workspace project rename`
- CLI 重点不是强制所有入口都走 Project Manager，而是让任意外部创建的 Project Workspace 都能被校验、初始化、迁移、打包和恢复。
- 所有错误报告必须说明：
    - 缺的是 `project.yaml`、Project SQLite，还是 schema version。
    - 是否可以自动修复。
    - 推荐命令是什么。
- Project 列表扫描只看 Workspace Root 下一级目录的 `project.yaml`，不递归。
- `workspace project pack` 输出 zip；zip 根就是 Project Workspace 内容。
- 当前 Project 下载对 Project SQLite 和已有 History SQLite 分别执行在线 `VACUUM INTO`，每个输出通过 `PRAGMA quick_check` 后才进入 zip；不复制 live 主库、WAL 或 SHM，失败时直接终止打包。
- `project.yaml`、Project Config、Project SQLite 与已有 History SQLite 不受 `.gitignore` 排除；普通项目文件继续遵守 `.gitignore`，Project Runtime Artifact 始终硬排除。
- History SQLite 是完整备份数据，可能含全文快照、已删除正文、acceptance 与 session cursor；前端仅对 Project 下载显示分享隐私警告，user-assets 仍走普通 workspace archive。

### 7. Agent Tool 合同

本任务需要一次性更新 Agent 可见工具合同，避免继续暴露 `novelId` 或全局数据库心智。

#### Plot tools

- 保留现有 Plot tool key，避免工具名 churn：
    - `get_plot_tree`
    - `get_story_thread`
    - `get_story_scene_context`
    - `get_chapter_plot`
    - `create_story_thread`
    - `update_story_thread`
    - `create_story_scene`
    - `update_story_scene`
    - `create_story_plot`
    - `update_story_plot`
- 所有 Plot tools 的 `novelId` 参数改为 `projectPath`。
- `projectPath` 是 Workspace Root 下的单段 Project Path，不允许绝对路径、`..`、斜杠嵌套或 URL path 片段。
- 当前 Project Workspace 可由 `client.currentProjectWorkspace` / `AppendingSet` runtime reminders 提醒模型，但 Plot tools 不从旧 `session.novelId` 推断项目。
- `plot.selection` 状态字段从 `{ novelId, threadId, sceneId }` 改为 `{ projectPath, threadId, sceneId }`。
- 省略 `threadId` / `sceneId` 时，只能复用相同 `projectPath` 的 selection；跨 Project Workspace 调用必须显式传 ID。
- `chapterPath` 继续使用 Project Workspace 内相对路径，例如 `manuscript/001-volume/001-chapter/`。
- Tool description 必须删除 “novelId” 文字，改成 Project Path / Project Workspace 术语。

#### `execute_sql`

- 保留工具 key：`execute_sql`。
- 输入 schema 调整为：
    - `sql`：单条 SQL，允许 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`，继续禁止 DDL、事务控制、session control、危险 PRAGMA 和多语句。
- 默认目标是当前 Project Workspace 的 `.nbook/project.sqlite`。
- 没有当前 Project Workspace 时，工具必须报错，不 fallback 到 App SQLite 或任意第一个项目。
- 工具不提供 SQLite 文件路径参数；跨 Project Workspace SQL 访问不通过 `execute_sql` 暴露，必要时使用专门业务工具或 `bash`。
- 禁止目标为 App SQLite，例如 `workspace/.nbook/neuro-book.sqlite` 或任何 Workspace Root `.nbook` 下的全局数据库。
- 权限与当前 `execute_sql` 保持一致：允许受限写入，不降级为只读。
- Schema summary 按目标 Project SQLite 生成，不再按全局 Database Kind 生成。
- Schema summary 详情表从 `Novel` / `User` / app-wide tables 改为 Project SQLite 的 Story / StoryPhase / StoryThread / StoryScene / StoryPlot / StorySceneRef 等表。
- Tool description 必须说明：
    - 当前工具只操作 SQLite 文件。
    - 目标默认是当前 Project Workspace 的 `.nbook/project.sqlite`。
    - 禁止访问 App SQLite。
    - 对正文、设定和普通文件仍使用 `read` / `write` / `edit` / `apply_patch`。

#### Profile / prompt 同步

- `leader.default` 的 Plot System 指南删除“所有 plot 工具必须显式传 novelId”，改为“所有 plot 工具必须显式传 projectPath”。
- `writer` profile 删除 `novelId` 输入和基于 `Novel.workspaceSlug` 的查询，改为根据 Project Path + chapterPath 定位 Project SQLite。
- Agent harness/session metadata 中的 `novelId` 要迁到 Project Path / current Project Workspace 语义；旧 session 可直接删除，不做 legacy 兼容。
- 旧 `docs/modules/agent/tools-reference.md` 已下线；当前 Agent 工具和协作合同以 `reference/agent/leader-default.md`、`reference/agent/project-workspace-guide.md` 与本任务记录中的 v3 迁移结论为准。

### 8. 部署与文档收尾

任务最后阶段统一修改：

- `README.md`
    - 删除 PostgreSQL 部署选项。
    - 改成 SQLite-only 安装、备份、迁移和 Project Workspace 打包说明。
- `docs/operator-bridge.md`
    - 删除内置/外部 PostgreSQL 运维桥接说明。
    - 增加 App SQLite 与 Project SQLite 的备份、恢复、打包边界。
- `scripts/migrate-config-system.ts`
    - 删除 PostgreSQL Boot Config / env 迁移分支。
    - 确保旧 `DATABASE_KIND=postgres` 配置迁移时给出 hard-cut 提示。
- `scripts/deploy.mjs`
    - 删除 PostgreSQL 相关同步、compose override 和远端环境假设。
    - 确认远端部署只需要 app + workspace 数据目录。
- 当时的旧部署脚本（已删除）
    - 删除数据库类型选择。
    - 不再生成 PostgreSQL password、service、override 或外部 URL 配置。
    - 输出 SQLite-only 的备份和 Project Workspace 打包提示。

## Decisions

- **Hard Cut PostgreSQL**：本任务完成后不再支持 PostgreSQL，也不提供旧 Postgres 数据迁移路径。
- **App SQLite Remains**：应用级数据库保留，用于 `User`、auth 和 global config；不记录 Project Workspace。
- **Project SQLite Is Portable**：Project Workspace-local SQLite 是项目结构化数据的默认仓库，必须位于 Project Workspace 内，并使用相对 path。
- **Project Path Locates Projects**：Project Path 是公开 API 和运行时定位 Project Workspace 的标识；当前设计不需要 `projectId`。
- **Root `project.yaml` Owns Metadata**：Project Workspace 根目录 `project.yaml` 保存 `kind`、`title`、`summary` 等展示元数据；旧 `workspace.yaml` 不做 runtime legacy 兼容。
- **Recoverability Over Gatekeeping**：不强制所有创建入口都走 Project Manager；但所有需要项目身份或项目数据库的入口必须能报错、校验和恢复。
- **No Project Index in App SQLite**：App SQLite 不保存 Project index、recent project、missing/invalid 状态或旧 `novelId` mapping；项目列表来自扫描 Project Workspace 根目录 `project.yaml`。
- **No `Project` / `Novel` in Project SQLite**：Project SQLite 是单项目数据库，不保留 `Project` 表、`Novel` 表和 numeric `novelId`；旧 `novelId` 只允许作为迁移脚本输入。
- **Generic Metadata Table Is Not Project Metadata**：Project SQLite 可以使用通用元数据表保存 schema version / migration 记录和自定义元数据；系统语义不从该表读取 Project Path、title、summary 或其他项目展示元数据。
- **Story Hierarchy Remains**：Project SQLite 继续保留 Story / StoryPhase 等剧情层级，项目展示 title/summary 放在 `project.yaml`。
- **Project API Hard Cut**：公开 API 和 Agent Plot 工具一次性从 `/api/novels/:novelId/...` 迁到 Project Path 语义，不保留旧路由兼容层。
- **Controlled SQLite Tool Remains**：保留 SQLite-only `execute_sql`，只访问当前 Project Workspace 的 Project SQLite，用于集中 schema summary、危险 SQL 限制和恢复提示；`bash` 只作为高级逃生口；权限与当前工具一致，允许受限写入。
- **App SQLite Is Forbidden To Agent SQL**：`execute_sql` 禁止访问 App SQLite，避免 Agent 读取或修改 `User`、auth 和 Global Config。
- **Browser State May Remember Project Path**：最近打开项目可以保存在 Browser State / localStorage，但不得进入 App SQLite。
- **Project List Is Non-recursive Scan**：项目列表只扫描 Workspace Root 下一级 `project.yaml`。
- **Project Pack Includes Config**：Project Workspace 打包包含 `.nbook/config.json` 和 `.nbook/project.sqlite`，但不包含 Global Config secret。
- **No Built-in Postgres Importer**：不提供内置旧 PostgreSQL 数据迁移脚本。
- **ADR Accepted**：新增 `docs/adr/0001-sqlite-only-portable-project-workspace.md` 记录 SQLite-only runtime 与 portable Project SQLite 决策。

## Follow-up Fixes

### 2026-05-25 review fixes

- 修复 `scripts/prisma-migrate.mjs` 的 deploy 分支：启动 `scripts/sqlite-migrate.mjs` 后不再立即 `process.exit(0)`，避免迁移未完成却返回成功。
- 收紧 `workspace-files` 公共 API：移除 HTTP 入参中的 `root` 通道，`resolveWorkspaceRootInput` 不再接受 legacy client / `novelId`，Project Workspace 解析必须通过 `projectPath -> project.yaml`。
- 修复 Project Config 定位：`server/config/config-service.ts` 写读 Project Config 前会 normalize `projectPath` 并读取 `project.yaml`，避免无效路径直接拼 `.nbook/config.json`。
- 修复 `execute_sql` 目标：schema summary 和执行路径都使用 session `projectPath`，并在打开 Project SQLite 前校验 `project.yaml`；不再用 `workspaceRoot` 推断数据库目标。
- 清理 PostgreSQL 启动入口：删除 `docker-compose.postgres.yml` 和 `docker-compose.external-db.yml`，本地 `.env` 的旧 PostgreSQL `DATABASE_URL` 已切回 `file:./workspace/.nbook/neuro-book.sqlite`。

验证结果：

- `bunx vitest run server/database/config.test.ts server/api/workspace-files/download.get.test.ts server/api/workspace-files/upload-file.post.test.ts server/api/workspace-files/upload-project.post.test.ts server/api/workspace-files/events.get.test.ts server/config/config-service.test.ts` 通过，16 tests passed。
- `node --check scripts/prisma-migrate.mjs` 和 `node --check scripts/prisma-env.mjs` 通过。
- `bun run typecheck` 仍失败，但失败项来自前端设置/Profile Workbench/Markdown Studio 相关既有类型问题，不属于本次 Project Workspace / SQLite 边界修复。

## Files Changed

- `docs/tasks/11-portable-project-workspace/README.md`
- `CONTEXT.md`
- `docs/adr/0001-sqlite-only-portable-project-workspace.md`
- `package.json`
- `bun.lock`
- `prisma/schema.prisma`
- `prisma/schema.sqlite.prisma`
- `prisma/project.schema.prisma`
- `prisma.config.ts`
- `prisma/migrations/sqlite/20260524120000_init/migration.sql`
- `server/workspace-files/project-workspace.ts`
- `server/workspace-files/novel-workspace.ts`
- `server/database/config.ts`
- `server/database/prisma.ts`
- `server/database/locks.ts`
- `server/plot/**`
- `server/agent/tools/sql-tool.ts`
- `server/agent/tools/plot-tools.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/profiles/profile-dsl.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `shared/dto/agent-session.dto.ts`
- `shared/dto/config.dto.ts`
- `shared/dto/plot.dto.ts`
- `server/api/workspace-files/**`
- `app/composables/useConfigApi.ts`
- `app/composables/useWorkspaceFileEvents.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/stores/novel-ide.ts`
- `scripts/prisma-env.mjs`
- `scripts/prisma-migrate.mjs`
- `scripts/docker-entrypoint.sh`
- `scripts/deploy.mjs`
- 当时的旧部署脚本（已删除）
- `scripts/migrate-config-system.ts`
- `README.md`
- `docs/operator-bridge.md`
- `PROJECT-STATUS.md`

## Verification

- 2026-07-18 Project 下载回归：`workspace-archive.test.ts` 与 `download.get.test.ts` 通过，覆盖 live WAL 中已提交 Project 数据、保持打开的 History operation/acceptance/cursor、两个 standalone SQLite、WAL/SHM 与 runtime artifact 排除、`.gitignore` 下 metadata 强制纳入、损坏库失败清理、可选 metadata 的非 `ENOENT` 错误不被吞，以及 user-assets 继续走普通 archive。
- 已执行 `bun .\assets\workspace\.nbook\agent\scripts\workspace.ts project create "workspace/codex-project-create-smoke" --title "测试项目" --summary "临时验证" --json`，确认会合并 bundled `assets/workspace/.nbook/templates/novel-directory-templates` 与用户覆盖层 `workspace/.nbook/templates/novel-directory-templates`、写入 `project.yaml`、初始化 `.nbook/project.sqlite`，且目标目录不再保留旧 `workspace.yaml`；验证后已删除临时 Project Workspace。
- 已执行 `bun .\scripts\sync-user-assets.ts`，确认仍跟随旧系统上游的 `workspace/.nbook/agent/scripts/workspace.ts` 会同步到新 `workspace project create` 命令面。
- 已执行目标已存在场景的 smoke，确认 `workspace project create` 失败时不会删除已有 Project Workspace 目录，也不会残留 `.creating-*` 临时目录。
- 已执行 `cwd=workspace` 下的 `workspace node validate workspace/silver-dragon-hime/manuscript/001-荒野觉醒/001-祭坛苏醒/` smoke，确认 `workspace node` 已按 `project.yaml` 定位 Project Workspace，并兼容 `workspace/<project>/...` Project Path 输入。
- 已执行 `bunx vitest run server/workspace-files/workspace-files.test.ts -t "Agent runtime|Project Workspace"`。
- 已执行 `bun x prisma generate --schema prisma/schema.sqlite.prisma`。
- 已执行 `bun x prisma generate --schema prisma/project.schema.prisma`。
- 已执行 `bun install` 更新 `bun.lock`，移除 PostgreSQL adapter / driver 直接依赖。
- 已执行 `bun run typecheck`。本轮 Project SQLite / Plot / SQL / Agent projectPath 迁移相关编译错误已清除；当前仍失败在既有前端设置与 Markdown Studio 类型问题：
    - `app/components/novel-ide/NovelAgentDrawer.vue` providerConfigId 类型断言。
    - `app/components/novel-ide/settings/*` defaultProfileKey / JSONType 类型问题。
    - `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` schema `unknown` vs JSONType。
    - `app/pages/index.vue` Markdown Studio controller 上不存在 `workspaceKind/currentNovelId`。

## TODO / Follow-ups

- 继续补 `workspace project` CLI：migrate-db / pack / adopt / rename。
- 清理 API / 前端命名：`/api/novels/*`、`Novel*Dto`、`currentNovelId` 暂时承载 `projectPath`，后续应重命名为 Project 术语。
- 更新或删除旧 Plot / workspace-files / agent profile 测试中的 `novelId`、`workspace.yaml`、旧 Postgres 心智。
- 根据最终 CLI 形态，把 Project SQLite 初始化 SQL 从内嵌字符串迁到更正式的 migration runner。
- 运行针对性测试：`server/agent/tools/sql-tool.test.ts`、`server/agent/tools/plot-tools.test.ts`、`server/plot`、`server/workspace-files`。

## Updates

### 2026-05-27 `workspace project create`

- `assets/workspace/.nbook/agent/scripts/workspace.ts` 新增 `workspace project create <project>`，支持 `--title`、`--summary`、`--template`、`--target`、`--json` 和 `--no-db`。
- 创建逻辑先复制 bundled `assets/workspace/.nbook/templates/<template>`，再叠加 Workspace Root `.nbook/templates/<template>` 用户覆盖层；复制后移除旧模板 `workspace.yaml`，写入当前合同的 `project.yaml`，并把旧覆盖层状态文档中“已创建 workspace.yaml”的单点文案归一到 `project.yaml`。
- 创建命令改为先在目标旁边 `.creating-*` 临时目录内完成模板、manifest 和 Project SQLite，再复制到最终目录；失败时只清理自己的临时目录，避免并发创建时误删已有 Project Workspace。
- `syncSystemAssetsToUserAssets()` 会同步仍跟随系统上游的 Agent runtime bin/script；缺少 sync state 但内容等于 Git HEAD 中旧系统 asset 的副本，会视为未手改旧同步副本并更新，真实手改副本仍保留并给 warning。
- `workspace node parse/validate/new/state` 的 root marker 已从旧 `workspace.yaml` 迁到 `project.yaml`；从 Workspace Root 执行时，`workspace/<project>/...` 会先归一为 `<project>/...`，避免 Agent 把 Project Path 双拼成 `workspace/workspace/<project>/...`。
- 抽出 `initProjectDatabaseAtRoot()`，让 agent assets CLI 能在只有目标绝对目录时初始化 Project SQLite，同时保留原有 `initProjectDatabase(projectPath)` 入口。
- `leader.default` prompt 的 Shell commands 已加入 `workspace project create`，并提醒创建新小说 Project Workspace 时不要手动复制模板或手拼 manifest。
- 新小说模板状态文档已从 `workspace.yaml` 改成 `project.yaml`，避免新项目初始化后文档和实际 manifest 冲突。

### 2026-05-30 `workspace project create --target`

- `workspace project create` 已扩展为唯一模板安装入口，`<project>` 只表示项目名/slug；传入 `--target <dir>` 时，`<dir>` 是实际 Project Workspace 根目录。
- `--target` 不改变模板覆盖层来源，仍使用当前 Workspace Root `.nbook/templates/<template>` 叠加 bundled 模板。
- `workspace project validate [target]` 和 `workspace project init-db [target]` 已迁入 active Agent workspace CLI；删除仓库侧重复 CLI 时保留 Project Workspace 校验和数据库恢复能力。
- 删除仓库侧重复 CLI `scripts/cli/workspace.ts`；测试和手工入口统一使用 active Agent workspace CLI。

### 2026-05-29 Agent cwd 与模板覆盖修复

- 普通 Project agent 的工具 cwd 明确统一为 Workspace Root `workspace/`；Project Workspace 仍由 `projectPath` / `Current Project Workspace` 表达，项目文件首选 `project-slug/...`，`workspace/project-slug/...` 只作为兼容别名。
- 修复 `resolveWorkspacePath()` 在 `workspaceRoot=workspace` 时把 `workspace/<project>/...` 错误裁成项目内相对路径的问题，避免读写落到 `workspace/lorebook/...` 或形成双前缀心智。
- `/api/projects` / `/api/novels` 创建路径本身会在 Project Workspace 根目录写入 `project.yaml`；`project.yaml` 不在 `.nbook/`。本轮清理了 bundled 与 user 覆盖模板里的旧 `workspace.yaml`，并让模板复制流程在合并后移除旧 manifest、归一 `PROJECT-STATUS.md` 文案，避免前端新建项目继续携带旧模板文件。
- `leader.default`、`retrieval`、SillyTavern / 番茄导入 skill 文案同步到 Workspace Root cwd 心智；SillyTavern CLI stdout 与 import report 改为输出 Agent 可直接读取的 `project-slug/...` 路径，不再把宿主机绝对路径作为后续操作入口。

### 2026-05-30 Plot chapterPath 输入归一化

- 修复生产中 `update_story_scene` 传入 `project-slug/manuscript/...` 或 `workspace/project-slug/manuscript/...` 被误判为不在 `manuscript/` 下的问题。Plot 服务仍然只把 Project Workspace 内部 `manuscript/...` 写入 `StoryScene.chapterPath`，但入口会把 Agent 常见 Project 前缀归一掉，降低 writer `chapterPaths` 与 Plot `chapterPath` 两套合同之间的误用成本。
- `chapterPath` 指向 `manuscript/<volume>/` 这类卷 content-node 时，现在返回明确的 400：这是卷目录，不是章节目录，需要传更深一层的 `manuscript/<volume>/<chapter>/`。
- 修复 Plot 错误 helper 缺少 `createError` 导入的问题，避免错误路径退化成 `createError is not defined`。

验证结果：

- `bunx vitest run server/plot/services/plot-scope.guard.test.ts server/agent/tools/plot-tools.test.ts` 通过，4 tests passed。
