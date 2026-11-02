# t08 实施计划：资源地址与 home

## Context

t12（基础工具）要按资源地址读写，地址层却只有 `project://`、`user://` 两个写死的方案；开发者 2026-11-02 定先做 t08。依据：本 Task README 的“决定”（第三版设计稿与 2026-10-30 的三条后续修改）、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 输出 8、9、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)。

开发者 2026-11-02 已确认的决定：

1. Agent 的方案都注册进文件服务（`nbook.files`），不由 Agent 插件绕开文件服务直接读写；方案注册接口（`resources.md` 里的 planned 项）在本 Task 做掉，`nbook.files` 可以一起改设计。
2. Agent 写入记为该会话（来源 `{kind: "agent", session}`）：`nbook.files` 的合同加“代哪个会话写”，只认 `nbook.agent`。
3. `tmp://` 在会话归档时清理，服务端启动时清掉已不存在或已归档的会话留下的目录；不在会话空闲卸下（t10 的 30 秒关闭）时清。
4. `docs://` 先放插件 SDK 的说明与示例（`docs://builtin/sdk/`）和 Agent 插件自己的文档（`docs://agent/`）；插件声明文档目录等第一个使用方。`skills://` 只有说明、没有条目，条目随 t15。
5. `sessions://` 的根先只按最近使用列出，“与本会话有关的排在前面”随 t14 的父子会话。

工作方式：代码在 Work worktree `.worktree/w00032-agent-integration`；Spec 与 Task 记录在主工作区。前端部分（文件客户端、编辑器、文件树的类型改动）单独派 Sonnet 审查，其余交 omp。

## 技术选型

无新的通用问题：受根约束的读写、监视、锁沿用 `nbook.files` 现有的 `rooted.ts`、`changes.ts`（chokidar）、`proper-lockfile`；系统临时目录用 `node:os` 的 `tmpdir()` 与 `userInfo().uid`。

## 关键设计

### 地址规则（`files/shared/resource.ts`）

- 复数是目录、单数是当前这一个（README 的“规律”）。文件服务只认**全局地址**；“当前这一个”的单数地址只在有上下文的一侧改写：浏览器的 `project://` 由绑定解析（不变），Agent 的 `project://`、`session://`、`profile://`、`tmp://` 由 Agent 地址层改写成全局地址（见下文“Agent 地址层”）。
- `tmp://` 的全局形式是新方案 **`temps://<会话 id>/`**（照复数规则命名；README 没有给它的全局名，属本计划新定，计划确认即算定）。
- `parseResource` 不再按固定的 `SCHEMES` 判方案：任何合法写法的方案名都能解析，“方案不存在”由分派时判定（`unknown-scheme` 从解析失败移到服务端）。`Scheme` 类型改为 `string`；文件树自己的两个根另用 `ExplorerRoot = "project" | "user"`。

### 方案注册（`files/shared/schemes.ts`、`files/backend/registry.ts`）

- 新贡献点 `files.schemes`：贡献 id 就是方案名（不加插件前缀；`project`、`user`、`projects` 保留给 `nbook.files`，重复注册被拒，`resources.md` 输入第 4 条）。声明 `{capabilities: ("read" | "write" | "list" | "watch" | "realPath")[]}`；这次只支持服务端位置的提供方。
- 实现形状 `SchemeProvider`：与现有方法同名的子集，每个方法多收一个 `caller: SchemeCaller = {consumer, source}`；没声明的能力由注册表直接答“能力不支持”（码 `unsupported-capability`，新增），不调提供方。
- 现成实现 `mountedScheme(options)`（`files/backend/mounted.ts`）：根是虚拟目录，读根得到说明与条目，根下第一段是挂载点，每个挂载点是一个真实目录，复用现有的 `openBackend`（`service`、`operations`、`batch`、`changes`）。
  - `options.root(caller)` → `{description, entries}`；`options.mount(name, caller)` → `{path, access: "read" | "write", visible?: (relativePath) => boolean} | null`。
  - 挂载点的 Backend 按需打开、空闲关闭（没有订阅且 5 分钟没有请求），上限 64 个，超出时关最久未用的。理由：会话目录可能成千上万，不能常开。
  - 写操作在 `access: "read"` 时为 `permission-denied`；`visible` 为假的路径为 `protected-path`（会话目录里只露出 `session.jsonl` 与 `home/`）。
- 列出结果加可选的 `description`：虚拟根的说明随列出返回，读工具（t12）把它拼成文字。
- `user://` 改为第一个用这套机制注册的方案：单根版本 `directoryScheme(path)`。

### 服务端的通用合同（`files/shared/contracts.ts`）

- 新合同 `nbook.files/server`（版本 1，提供方 `server`，调用方 `browser`、`tui`、`project`、`server`）：方法与现有一套相同，入参从 `{path}` 改为全局地址 `{address}`，订阅的过滤参数为 `{scheme, mount?}`。按方案分派到注册表。旧合同 `nbook.files/user` 删除，它只被 `nbook.files` 自己的浏览器客户端使用。
- **代会话写**：写方法多一个可选的 `agentSession: string`，只在调用方是服务端位置的 `nbook.agent` 时接受，来源记为 `{kind: "agent", session}`；别的调用方带了就按 `invalid-input` 拒绝。读方法也接受它，提供方按它判权限（例如别的会话的 home 对 Agent 只读）。
- 浏览器文件客户端（`files/web/client.ts`）：`project://` 走项目合同，其它都走服务端合同；`sameScheme` 等批量检查不变。

### `projects://`（`nbook.files` 服务端入口）

- 根：已登记项目的列表（短名、显示名、是否运行），来自 `projectsKey.list`。
- `projects://<短名>/路径`：每次调用先 `acquire` 租约，经 `{project: id}` 目标调用项目合同，结算后释放；订阅期间一直持有租约。理由：租约跟着调用走，Agent 与浏览器都不必自己管项目的寿命；运行中的项目上 `acquire` 只是登记，空闲的项目会被打开（ADR 0024 的跨项目访问）。
- 来源透传：项目合同的写方法加可选的 `as: ChangeSource`，只在调用方是服务端位置的 `nbook.files` 时接受。这样 Agent 经 `projects://` 写书，项目实例里记下的来源仍是该会话。
- 没登记的短名为 `not-found`；`acquire` 被拒（`admission-closed`、`create-failed`）为新失败码 `project-unavailable`。

### Agent 的方案（`agent/backend/schemes.ts`）

`nbook.agent` 服务端入口贡献五个 `files.schemes`，权限按 `caller`：用户（浏览器）可写的照写；Agent 按 `agentSession` 判断。

| 方案 | 根的说明与条目 | 挂载点与真实目录 | Agent 可写的 |
|---|---|---|---|
| `sessions` | 最近使用的会话，至多 200 个（id、标题、Profile、更新时间） | `<id>` → `<状态根>/agent/sessions/<id>/`，只露出 `session.jsonl`（所有人只读）与 `home/` | 自己的 `home/` |
| `profiles` | Profile 目录（key、名称、来源、可不可用），来自 `ProfileCatalog` | `<key>` → `<状态根>/agent/profiles/<key>/`，第一次写时创建 | 自己会话的 Profile |
| `temps` | 无条目（说明它是各会话的临时目录） | `<会话 id>` → `<系统临时目录>/nbook/sessions/<id>/`；`nbook` 属别的用户时用 `nbook-<uid>` | 自己的 |
| `docs` | 说明与 `builtin`、`agent` | `builtin/sdk` → 插件 SDK 的作者文档；`agent` → `plugins/agent/docs/` | 无 |
| `skills` | 只有说明（t15 之前没有条目） | 无 | 无 |

- `session://attachments/`、`session://artifacts/` 对 Agent 只读（`home/` 里按前两段判断），由宿主写入：附件上传在 t17，大结果全文在 t12。
- 建会话时创建 `home/`（`createSession` 之后，失败按建会话失败）。
- `temps` 的清理：会话归档时删除它的目录；服务端入口激活时扫一遍，删除已不存在或已归档的会话的目录。删除只在 `<系统临时目录>/nbook*/sessions/` 下，不跟随符号链接。
- `docs://builtin/sdk` 的真实目录：开发时是源码的 `plugin-sdk/`（只露出 `README.md` 与 `examples/`）；打包后是 `pack-app.ts` 复制进应用包的同一份。

### Agent 地址层（`agent/backend/resources.ts`）

- `AgentService.resources(context: ToolSessionContext): SessionResources`，t12 的工具按会话取用：
  - `expand(address)`：把单数地址改写成全局地址。`project://` 在会话没有主项目时为 `no-project`；
  - `classify(address)` → `{content: boolean; write: "allowed" | "ask" | "denied"}`：作品内容是 `project://`、`projects://`；`user://` 的写入为 `ask`；其余按上表。只给分类，审批的接线在 t06、t12；
  - `list`、`read`、`write`、`create`、`realPath`：先 `expand`，再经 `nbook.files/server` 调用并带上 `agentSession`。结果里的地址保留全局形式。
- 内核的资源接口（`SessionEnv.resources`）改由它实现：`resolve` 为 `expand` 加规范化，`read` 为读文本、不存在时为 `undefined`。取代 t10 的 `sessionResources`。

### 前端（`files/web/`、`editor/web/`、`explorer/web/`）

- `Scheme` 改为 `string` 后，编辑器的文档仓库按方案开监视的逻辑不变；面包屑的根标签在 `project`、`user` 之外显示 `方案://`。
- 文件树只有 `project`、`user` 两个根，类型改为 `ExplorerRoot`，行为不变。

## Spec 与文档改动

- `workspace/resources.md`：
  - 方案表改为现状：去掉 `local://`；加 `projects://`、`sessions://`、`profiles://`、`temps://`、`docs://`、`skills://`，各自链接 owner；
  - 方案注册与 `nbook.files/server` 合同从 planned 改为本次实现；
  - 写入来源加“Agent 会话”与透传规则；
  - 失败码加 `unsupported-capability`、`project-unavailable`；
  - 验收场景 1、4 改写，补 `projects://` 与代会话写的场景。
- 新建 `docs/specs/agent/resources.md`（planned）：Agent 的地址改写、各方案对 Agent 的权限与分类、`home/` 与 `temps` 的寿命和清理、`docs://` 与 `skills://` 的内容。
- `ui/prompt-editor.md`：附件地址从 `local://名称` 改为 `session://attachments/名称`。
- `runtime/projects.md` 的“Agent 会话的项目租约与 `projects://` 提供者随 nb-harness”改为链接 `resources.md`。
- `docs/specs/README.md` 注册表加 `agent/resources.md`。

## 切片

0. **Spec**（主工作区）：上面全部 Spec 改动，`docs:check`。单独提交。
1. **注册表与服务端合同**：地址规则、贡献点、注册表、`directoryScheme`、`nbook.files/server`，`user://` 迁过去，删 `nbook.files/user`。验证：`bun run test:affected`，files 的合同测试。
2. **前端跟着改**：文件客户端分派、`Scheme` 类型、面包屑与文件树。验证：files、editor、explorer 的单元测试与受影响的 e2e。完成后派 Sonnet 审这一片（后台，不阻塞）。
3. **挂载方案与 `projects://`**：`mountedScheme`、Backend 的按需打开与空闲关闭、`projects://` 与租约、项目合同的 `as`、代会话写。验证：files 测试，加多项目的场景。
4. **Agent 的方案**：五个方案、`home/` 的创建、`temps` 的清理、`docs` 的打包。验证：agent 测试、`pack-app` 的检查。
5. **Agent 地址层**：`resources.ts`、内核资源接口改接、`AgentService.resources`。验证：agent 测试。
6. **收口**：全量受影响测试、nb-harness 测试、真实浏览器打开 `user://` 与 `project://` 的文件（`nbdev dev start`），然后做实现审查。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `resources.md` 场景 1（改写后） | `files/schemes.test.ts`：对各方案读、列出，`docs://` 写入被拒，未注册方案 `unknown-scheme` |
| `resources.md` 场景 2 | `files/changes.test.ts` 补“Agent 会话”来源与冒充被拒 |
| `resources.md` 场景 4 | `files/schemes.test.ts`：测试插件注册只读方案，写为 `unsupported-capability`，重复注册被拒，插件关闭后方案不可用 |
| `resources.md` 新场景：`projects://` | `files/projects-scheme.test.ts`：没在运行的项目经 `projects://` 读写，期间不被宽限期关掉，来源透传 |
| `resources.md` 场景 6、7 | 现有测试照过 |
| `agent/resources.md` 各输出 | `agent/resources.test.ts`：地址改写、`no-project`、分类、各方案对 Agent 的权限、只读子目录、`temps` 的清理（归档与启动扫描） |
| `prompt-editor.md` 附件地址 | 只改文字，组件不解析方案，无行为改动 |

## 验证

- `bun run test:affected`；nb-harness 的测试（内核资源接口改接）；`bun run typecheck`；`governance:check`、`docs:check`。
- 真实浏览器：`nbdev dev start` 打开一个项目，在文件树里打开 `user://` 与 `project://` 的文件并保存，确认迁移没有改变行为。
- 未验证的边界：Windows 上 `temps` 的目录名与清理；`docs://builtin/sdk` 只在 `pack-app` 的检查里核对目录存在，不装包实测。

## 不做与风险

- 不做：`history://`（t13）、`mcp://`（t19）、插件声明文档目录、glob 与 grep 能力（t12 决定在真实路径上用 `pi-natives`）、项目实例里的方案注册、按天自动清理 `temps`。
- 风险：
  - 第 1 片改动浏览器合同：开着的旧窗口要刷新（合同不兼容按 `version-changed` 失败，现有行为）。
  - 挂载点 Backend 的打开和关闭与订阅交错：关闭只在没有订阅时进行，订阅建立时先占住挂载点。
  - `projects://` 每次调用 `acquire`、`release`：空闲项目会被频繁打开，宽限期 5 分钟内不会真的关，代价可接受；高频时再改为挂在调用方会话上。
