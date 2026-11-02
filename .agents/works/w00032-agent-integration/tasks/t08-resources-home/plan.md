# t08 实施计划：资源地址与 home

第三稿（2026-11-02）：按两轮设计审查修订，处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。与初稿最大的不同：服务端插件经进程内服务访问已注册的方案，浏览器一侧不动，浏览器访问新方案随 t17（开发者 2026-11-02 确认）。

## Context

t12（基础工具）要按资源地址读写，地址层却只有 `project://`、`user://` 两个写死的方案；开发者 2026-11-02 定先做 t08。依据：本 Task README 的“决定”（第三版设计稿与 2026-10-30 的三条后续修改）、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 输出 8、9、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)。

开发者 2026-11-02 已确认的决定：

1. Agent 的方案都注册进文件服务（`nbook.files`），不由 Agent 插件绕开文件服务直接读写；方案注册接口（`resources.md` 里的 planned 项）在本 Task 做掉，`nbook.files` 可以一起改设计。
2. Agent 写入记为该会话（来源 `{kind: "agent", session}`）：`nbook.files` 加“代哪个会话写”，只认 `nbook.agent`。
3. `tmp://` 在会话归档时清理，服务端启动时清掉已不存在或已归档的会话留下的目录；不在会话空闲卸下（t10 的 30 秒关闭）时清。第二轮审查后细化：归档的会话等它卸下（不在运行）时再清，见“Agent 的方案”。
4. `docs://` 先放插件 SDK 的说明与示例（`docs://builtin/sdk/`）和 Agent 插件自己的文档（`docs://agent/`）；插件声明文档目录等第一个使用方。`skills://` 只有说明、没有条目，条目随 t15。
5. `sessions://` 的根先只按最近使用列出，“与本会话有关的排在前面”随 t14 的父子会话。
6. 初稿里另定、开发者已认可：`tmp://` 的全局名 `temps://<会话 id>/`；`projects://` 的租约跟着每次调用走；代会话写按插件 id 认人；`sessions://` 根至多 200 条；挂载目录空闲 5 分钟关闭、上限 64；新失败码 `unsupported-capability`、`project-unavailable`。

工作方式：代码在 Work worktree `.worktree/w00032-agent-integration`；Spec 与 Task 记录在主工作区。附件地址改名这一小片前端改动派 Sonnet 审查，其余交 omp。

## 技术选型

无新的通用问题：受根约束的读写、锁沿用 `nbook.files` 的 `rooted.ts`、`files-service.ts`、`operations.ts`；系统临时目录用 `node:os` 的 `tmpdir()` 与 `userInfo().uid`；SDK 作者文档复用 `plugin-sdk/pack.ts` 的生成逻辑。

## 关键设计

### 地址规则

- 复数是目录、单数是当前这一个（README 的“规律”）。注册表只认**全局地址**；单数地址只在有上下文的一侧改写：浏览器的 `project://` 由绑定解析（不变），Agent 的 `project://`、`session://`、`profile://`、`tmp://` 由 Agent 地址层改写（见“Agent 地址层”）。
- 浏览器用的 `parseResource` 不变（仍只认 `project`、`user`）。服务端另加 `parseAddress(address)`（`files/shared/resource.ts`）：与 `parseResource` 共用语法与 `pathProblem`，只是不限方案集合，方案存不存在由注册表判定（`unknown-scheme`）。

### 方案注册（`files/shared/schemes.ts`、`files/backend/registry.ts`、`files/backend/mounted.ts`）

- 新贡献点 `files.schemes`：贡献 id 就是方案名，不加插件前缀；`project`、`user`、`projects` 保留给 `nbook.files`，重复注册被拒（`resources.md` 输入第 4 条）。这次只接受内置插件注册，第三方注册与 SDK 公开面随第一个插件方案（`plot://`）。
- 贡献实现是**声明式的挂载方案** `MountedSchemeSpec`（类型在 `files/shared/schemes.ts`，不引 Node）：
  - `capabilities`：这次只用 `read`、`write`、`list`、`realPath`；没声明的操作由注册表答 `unsupported-capability`；
  - `root(caller)` → `{description, entries: [{name, title?, meta}]}`：列出根本身得到的说明与条目；
  - `container`：挂载点根所在的受管容器目录（例如 `<状态根>/agent/profiles/`），注册方在激活时建好；
  - `mount(name, caller)` → `{create: boolean, ensure?: readonly string[]} | null`：根下第一段对应 `<container>/<name>/`，`null` 为 `not-found`；`create` 为真时允许 Files 在第一次写入时建这个目录；`ensure` 列出挂载点内要随之建好的单段子目录（例如会话的 `home`）；
  - `authorize(caller, mount, operation, relativePath)` → `true` 或失败码：`mount` 是挂载点名，`relativePath` 是挂载点内的路径。Files 对词法路径与解析链接后的真实路径各调用一次（同一个 `mount`），两次都通过才执行；列出的结果逐项按 `"read"` 授权，不通过的子项不返回。
- Backend 由 Files 构造和管理（`mounted.ts`），注册方不碰 `openBackend`：
  - 每个挂载点一个子作用域，状态 `opening`、`open`、`closing`，同一时刻只有一个打开 Promise；
  - 请求从开始到结算一直借用挂载点；回收只选借用为 0 且空闲满 5 分钟的；
  - 64 是软上限：超出时回收空闲的，都在用就照开并写诊断；`closing` 中到来的请求等它收口后重新打开；
  - 挂载点的根目录不存在：读为 `not-found`，列出为空列表；
  - 物化（第一次写、新建或取真实路径）：先按词法路径授权；通过后核对容器是真实目录，`create` 为真时在容器下非递归建挂载点根（名字是单段），打开根并核对它是真实目录；目标落在 `ensure` 的子目录下时，在打开的根里排他新建这个子目录；同名的文件或链接已存在时为 `not-a-directory` 或 `protected-path`，不覆盖；然后照常按真实路径授权实际目标。被拒的请求不建任何目录；
  - 注册方撤回或入口停止：先拒新请求，等在途请求结算，再关闭全部挂载点；
  - `retire(mount)`（Files 交给注册方的句柄上）：只撤一个挂载点，同样先拒新借用、等在途结算、关闭 Backend；之后再访问时按新根重新打开。
- 挂载方案的 Backend 不做文件夹类型投影：`.content`、`.binder` 当普通目录，不维护 `content.xml`，新建不会顺带写别的文件。
- 授权只在服务入口做（词法与真实路径各一次），操作内部等锁后的重新解析不再调授权回调：其间能换链接的只有 Agent 自己的 shell，shell 绕过文件工具是已接受的限制（t12 决定），写进 Spec 的已知限制。
- 这次不声明 `watch`：没有订阅方，挂载点的 ChangeHub 不开监视（`changes.ts` 只在有订阅时监视），写入照样经 ChangeHub 记来源，留给 t17 的订阅。
- `user://` 不迁移，仍是现有的单根实现与 `nbook.files/user` 合同。
- 执行模块（`files/backend/execute.ts`）：把“在一个根上执行一次已接纳的请求（`tracked`）、记来源、发变更、转成公共结果”从 `plugin.ts` 的 `implementation()` 抽出来，旧远程合同、服务里的 `user://` 与挂载方案共用，不各写一份保存编排。

### 服务端的进程内服务（`files/shared/contracts.ts` 的 `serverFilesKey`，实现在 `files/backend/server-files.ts`）

- `nbook.files` 服务端入口提供按调用方门面的服务 `serverFilesKey`（`nb-runtime/services` 的 `perConsumer`）。方法：`list(address, options?)`、`read(address, options?)`、`write(address, text, baseline, options?)`、`create(address, kind, options?)`、`realPath(address, options?)`。不提供批量、删除、改名，也没有单独的取消方法：t12 的工具用不到。
- 成功值：实体沿用现有合同（`FilesResult` 里的列出结果、`{text, baseline}`、`{path}`）；虚拟根的 `list` 返回 `{kind: "virtual", description, entries: [{name, address, title?, meta}]}`（`address` 是全局地址），虚拟根的 `read` 为 `not-a-file`、`realPath` 为 `unsupported-capability`。
- `options.signal`：调用方的 `AbortSignal`（t12 传工具执行的 `signal`）；门面释放与 Files 入口停止也中止在途调用。写请求已发出后中止的，结果照实交回（`projects://` 为 `unknown-outcome`）。
- `options.as: {agent: {session, profile}}`：只在门面的调用方是服务端位置的 `nbook.agent` 时接受，否则为 `invalid-input`。带了它时写入来源为 `{kind: "agent", session}`，授权回调收到的 `caller.agent` 就是它；没带时来源按现有 `sourceOf` 为 `{kind: "system", plugin}`。
- 会话与 Profile 的真伪由 `nbook.agent` 负责（它只按内核给的 `ToolSessionContext` 签发），Files 不查。
- 分派：`projects://` 见下节；`user://` 用现有 Backend；其余查注册表。

### `projects://`（同一服务里）

- 根：已登记项目的列表（短名、显示名、是否运行），来自 `projectsKey.list`；登记表损坏（`registry-invalid`）为 `project-unavailable`，详情带原因，修好后下一次调用照常。
- `projects://<引用>/路径`：引用按登记表解析（先 id 后短名）。每次调用：`acquire` 租约 → 回来后复核调用方的 `signal`，已取消就立即释放并以 `cancelled` 结束 → 对 `{project: id}` 目标调用 `projectFilesContract` 的同名方法，传入调用方的 `signal` → `finally` 释放租约。
- 这是进程内服务直接发出的远程调用，路由失败（`unknown-outcome`、`target-gone`、`timeout` 等）原样交回调用方，不经第二层远程提供方改报。
- 来源透传：项目合同的写方法加可选的 `as: ChangeSource`，只在调用方是服务端位置的 `nbook.files` 时接受；Agent 经 `projects://` 写书，项目实例记下的来源是该会话。Agent 来源的事件会进 `project://` 与 `user://` 的订阅，所以 `nbook.files/project` 与 `nbook.files/user` 两份合同的版本都加 1。
- 没登记的引用为 `not-found`；`resolve` 或 `acquire` 被拒（`registry-invalid`、`admission-closed`、`create-failed`、`unknown-project`）为 `project-unavailable`。

### Agent 的方案（`agent/backend/schemes.ts`）

`nbook.agent` 服务端入口贡献五个 `files.schemes`。授权回调按 `caller.agent` 判断：带了的是 Agent，没带的是服务端插件（这次只有 Agent 会调，服务端插件按“系统”放行读写，日志等系统只读的除外）。

| 方案 | 根的说明与条目 | 挂载点与真实目录 | Agent 可写的 |
|---|---|---|---|
| `sessions` | 最近使用的会话，至多 200 个（id、标题、Profile、更新时间） | `<id>` → `<状态根>/agent/sessions/<id>/`，`create: false`、`ensure: ["home"]`；只露出 `session.jsonl`（所有人只读）与 `home/`，其余为 `protected-path` | 自己的 `home/`，`home/attachments/`、`home/artifacts/` 除外 |
| `profiles` | Profile 目录（key、名称、来源、可不可用），来自 `ProfileCatalog` | `<key>` → `<状态根>/agent/profiles/<key>/`，`create: true` | `caller.agent.profile` 与挂载点相同时 |
| `temps` | 无条目（说明它是各会话的临时目录） | `<会话 id>` → `<系统临时目录>/nbook/<状态根标记>/sessions/<id>/`，`create: true`；`nbook` 属别的用户时用 `nbook-<uid>`；状态根标记是状态根真实路径 SHA-256 的前 16 位 | 自己的 |
| `docs` | 说明与 `builtin`、`agent` | `builtin` → `dist/docs/builtin/`（SDK 作者文档在其下的 `sdk/`，下节）；`agent` → Agent 插件的文档目录 | 无 |
| `skills` | 只有说明（t15 之前没有条目） | 无 | 无 |

- `home/` 按需建：`sessions` 的挂载点 `create: false`（会话目录由内核建，不存在就是没有这个会话），`ensure: ["home"]`，第一次写入或取真实路径落在 `home/` 下时建。fork 与已有会话因此不必另补。
- `temps` 的容器：`nbook[-uid]`、状态根分区、`sessions` 三层由 `nbook.agent` 在激活时建（权限 0700），逐层 `lstat` 核对是本用户的真实目录；任何一层是链接、文件或别的用户的，就换 `nbook-<uid>` 再试一次，仍不行则 `temps` 不可用并写诊断。系统临时目录本身不查。
- `temps` 的清理：内核的归档不停止运行，所以归档当下不删；已归档的会话从句柄表卸下时（t10 的卸下只在没有运行时发生）先 `retire` 该挂载点、再删目录。服务端入口激活时（还没注册方案之前）只扫本状态根的分区，删除已不存在或已归档的会话的目录。删除前逐层核对同上，不跟随符号链接。
- `session://attachments/`、`session://artifacts/` 由宿主写入（附件上传在 t17，大结果全文在 t12），宿主写入不带 `as`。

### SDK 作者文档（`plugin-sdk/pack.ts`、`scripts/pack-app.ts`）

- 从 `pack.ts` 抽出只生成作者文档的入口（README 的链接改写、三份附表、同版本 Spec、示例源码），开发时生成到 `packages/neuro-book/dist/docs/builtin/sdk/`（新脚本 `build:agent-docs`），`pack-app.ts` 调用同一入口生成进应用包，并把目录加进 `files` 白名单。Agent 插件的文档放 `plugins/agent/docs/`，打包时一并复制。
- 服务端用一个定位函数按安装布局找这两个目录，开发与打包共用；开发时生成目录不存在，`docs://builtin` 的说明写明要先运行 `build:agent-docs`，列出为空。

### Agent 地址层（`agent/backend/resources.ts`）

- `AgentService.resources(context: ToolSessionContext): SessionResources`，t12 的工具按会话取用：
  - `expand(address)`：单数地址先按 `pathProblem` 校验路径（拒绝 `.`、`..`，不做去点段），再拼成全局地址：`project://p` → `projects://<主项目 id>/p`（没有主项目为 `no-project`），`session://p` → `sessions://<id>/home/p`，`profile://p` → `profiles://<key>/p`，`tmp://p` → `temps://<id>/p`；全局地址原样通过；
  - `classify(address)` → `{content: boolean; write: "allowed" | "ask" | "denied"}`：只看 `expand` 之后的全局地址，`sessions://<自己>/home/…` 与 `session://…` 结果相同；作品内容是 `projects://`；`user://` 的写入为 `ask`；其余按上表。只给分类，审批的接线在 t06、t12；
  - `list`、`read`、`write`、`create`、`realPath`：收 `{signal?}`，`expand` 后经 `serverFilesKey` 调用并带上 `as: {agent: {session, profile}}`；结果里的地址是全局形式。
- 内核的资源接口（`SessionEnv.resources`）改由它实现，取代 t10 的 `sessionResources`：`resolve` 返回 `expand` 的结果，校验不过的原样返回；`read` 在 `not-found` 时为 `undefined`，其它失败抛出。

### 附件地址改名（前端小片）

- `markdown/shared/targets.ts` 把 `session://attachments/` 判为附件（原来按 `local`）；`nb-agent-ui/src/prompt-token-action.ts` 按 `session://attachments/` 取名字；对应测试的地址一并改。只改识别，不接上传（t17）。

## Spec 与文档改动

- `workspace/resources.md`：
  - 方案表改为现状：去掉 `local://`；加 `projects://`、`sessions://`、`profiles://`、`temps://`、`docs://`、`skills://`，后五个链接 `agent/resources.md`；
  - 方案注册（声明式挂载方案、授权回调、挂载点寿命）与 `serverFilesKey` 写成本次实现；浏览器访问已注册方案标 planned（t17）；第三方注册标 planned（随 `plot://`）；
  - 写入来源加“Agent 会话”与 `projects://` 的透传；失败码加 `unsupported-capability`、`project-unavailable`；已知限制加“授权只在服务入口做，Agent 的 shell 换链接可以绕过”；
  - 验收场景 1、4 改写，补 `projects://`、代会话写与路径授权的场景。
- 新建 `docs/specs/agent/resources.md`（planned）：Agent 的地址改写与分类、各方案对 Agent 的权限、`home/` 与 `temps` 的寿命和清理、`docs://` 与 `skills://` 的内容。
- `ui/prompt-editor.md`、`workspace/markdown-dialect.md`：附件地址从 `local://名称` 改为 `session://attachments/名称`。
- `runtime/projects.md` 的“Agent 会话的项目租约与 `projects://` 提供者随 nb-harness”改为链接 `resources.md`。
- `docs/specs/README.md` 注册表加 `agent/resources.md`。

## 切片

0. **Spec**（主工作区）：上面全部 Spec 改动，`docs:check`。单独提交。
1. **注册表、挂载方案与服务**：执行模块（先抽出，旧合同测试照过）、`parseAddress`、贡献点、`mounted.ts`（寿命、物化、授权、`retire`）、`serverFilesKey`（不含 `projects://`）、`user://` 合同版本加 1。用测试插件注册一个挂载方案验证。验证：files 的合同测试。
2. **`projects://`**：租约、项目合同的 `as`、失败原样交回。验证：在 `project-child.test.ts` 的场地上起真实项目子进程。
3. **Agent 的方案**：五个方案、`temps` 的分区与清理、SDK 作者文档的生成与打包。验证：agent 测试、`pack-app` 的检查。
4. **Agent 地址层**：`resources.ts`、内核资源接口改接、`AgentService.resources`。验证：agent 测试、nb-harness 测试。
5. **附件地址改名**：前端小片，完成后派 Sonnet 审查（后台）。验证：markdown、nb-agent-ui 的测试。
6. **收口**：受影响测试全跑、`typecheck`、`governance:check`、`docs:check`，然后做实现审查。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `resources.md` 场景 1（改写后） | `files/schemes.test.ts`：各方案的读、列出、真实路径；`docs://` 写入被拒；未注册方案 `unknown-scheme`；未声明能力 `unsupported-capability` |
| `resources.md` 场景 2 | `files/schemes.test.ts`：带 `as` 的写入来源为该会话；别的服务端插件、浏览器（项目合同的 `as`）带了被拒；不带 `as` 的浏览器写入照常 |
| `resources.md` 场景 4 | `files/schemes.test.ts`：测试插件注册只读方案；重复注册被拒；插件关闭后方案不可用，在途请求先结算 |
| `resources.md` 新场景：挂载点寿命 | `files/mounted.test.ts`（经真实插件宿主与 `serverFilesKey`，操作用门闩卡住、时钟注入）：推进 5 分钟后空闲的被回收、在途的不被回收；第 65 个照开；同一挂载点并发首次打开只打开一次；`closing` 中的新请求等收口后重开；打开中撤回；`retire` 等在途结算 |
| `resources.md` 新场景：物化与授权 | `files/mounted.test.ts`：根不存在时读 `not-found`、列出为空；第一次写入、真实路径建根与 `ensure` 子目录；`ensure` 的位置已是文件或链接时不覆盖；被拒的请求不建目录；授权按挂载点名区分（A 会话写 A、B 两个同名路径）；列出不返回未授权的子项；`.content` 目录下新建不改 `content.xml` |
| `resources.md` 新场景：合同版本 | `files/schemes.test.ts`：旧版本的 `user://`、`project://` 订阅方得 `version-changed` |
| `resources.md` 新场景：`projects://` | `files/projects-scheme.test.ts`（真实项目子进程）：没在运行的项目经 `projects://` 读写；来源透传；`acquire` 未完成时取消、调用已派发时取消，各自观察是否派发与租约是否释放；子进程断链后 `unknown-outcome` 原样交回；登记表损坏为 `project-unavailable`、修好后照常 |
| `agent/resources.md` 各输出 | `agent/resources.test.ts`（经 `AgentService.resources`）：地址改写、`no-project`、`..` 被拒、分类（单数与全局地址一致）、各方案对 Agent 的权限、切 Profile 前后 `profile://` 的权限、日志可读不可写、附件与大结果只读、经链接指向日志被拒、虚拟根的成功值与条目地址、首次 `home`/`profile`/`temp` 的真实路径、`temps` 的清理（运行中归档不删、卸下后删、启动扫描、两个状态根并存互不影响、容器某层是链接时拒绝）、`docs://builtin/sdk/README.md` 可读并跟进一条附表与一条 Spec 链接 |
| 应用包的文档布局 | `scripts/pack-app.test.ts`：把打包产物解到仓库外，用同一个定位函数找到 `docs/builtin/sdk/README.md` 与 Agent 文档 |
| `prompt-editor.md`、`markdown-dialect.md` 附件地址 | `markdown/shared/targets.test.ts`、`nb-agent-ui` 的 `prompt-token-action.test.ts` |

## 验证

- `bun run test:affected`；nb-harness 的测试；`bun run typecheck`；`governance:check`、`docs:check`；`pack-app` 的检查。
- 浏览器一侧没有行为改动，不做浏览器验收；附件地址改名由单元测试与 Sonnet 审查覆盖。
- 未验证的边界：Windows 上 `temps` 的目录与清理；应用包不做完整安装与启动，只验证解包后的定位。

## 不做与风险

- 不做：浏览器访问已注册方案（t17，第一轮审查的第 3、5、6、7、13、16 条是它的输入）；第三方插件注册方案与 SDK 公开面（随 `plot://`）；`watch` 与订阅；`history://`（t13）；`mcp://`（t19）；插件声明文档目录；glob 与 grep（t12 在真实路径上用 `pi-natives`）；项目实例里的方案注册；按天自动清理 `temps`。
- 风险：
  - `user://`、`project://` 合同版本各加 1：开着的旧窗口会得到 `version-changed`，要刷新。
  - `projects://` 每次调用 `acquire`、`release`：空闲项目会被打开，5 分钟宽限期内不会真的关；高频时再改为挂在会话上。
  - 授权回调由注册方实现：写错会放行。Agent 的规则集中在 `schemes.ts` 一处，测试逐条覆盖上表。
