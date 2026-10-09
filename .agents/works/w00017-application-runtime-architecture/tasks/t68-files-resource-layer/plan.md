# t68 实施计划：Files 竖切一：资源层与文件服务

## Context

- **为什么做**：第 6 步是 Files 竖切（[v2 重建提案](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 推进顺序第 6 条：资源层 → 文件资源管理器视图 → 编辑器打开与切换，性能按 `workbench.files-explorer` 的标准验收）。依据是 [项目文件底座与 Files 竖切](../../../../../docs/proposals/project-file-foundation.md)（2026-10-02 `accepted`）与四份 `planned` Spec：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)。资源层的 Opus 与 omp 对照实验 2026-10-08 由开发者暂缓，仍由 Opus 编码、omp 审查。
- **已有的底座**：项目实例（`runtime.projects`：每个打开的项目一个子进程里的 `project` 位置内核实例，项目里的插件经 `currentProjectKey` 取项目目录；两个服务端可以同时打开同一个项目）；远程服务（`provider: "project"` 的合同从浏览器 `remote.use(合同)` 直达窗口绑定的项目代次；同实例调用同样核对合同的 `callers`）；Storage、配置与公开状态（K4–K6）；工作台外壳一至三。旧应用的 Files（`packages/neuro-book-legacy/server/workspace-files/`、`server/features/platform-files/`）只作行为参照：v2 不搬它的 Project 会话、索引与 frontmatter 预读。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)，与 t65–t67 相同（worktree 逐片提交并 push；真实内核、真实文件系统、真实项目子进程与 WebSocket；不用 mock、spy、假计时器、固定等待；变异检查；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。
- **计划审查**（2026-10-09，三份报告见 `evidences/plan-review-*.txt`）：采纳的改动已并入下文；偏离已接受提案或改变产品可见行为的取舍记入 [待确认清单](../../pending-confirmations.md)。

## 第 6 步分解

Files 竖切按依赖拆成五个 Task，每个 Task 自带计划、三方审查与实现审查：

| Task | 范围 | 主要 Spec |
|---|---|---|
| t68（本 Task） | 资源层：`nbook.files` 插件、`project://` 与 `user://` 提供者、列出一层（三类文件夹的投影与正文入口）、读取与磁盘基线、对已有文件的条件保存与来源、变更事件、浏览器文件客户端 | resources、folder-kinds、files 的读写部分 |
| t69 | 文件操作：新建文件（唯一的新建入口）与文件夹、创建内容、改名、移动、复制、删除；批量的逐项结果、冲突、取消与结果未知；内容文件夹内的操作同步清单 | files 的操作部分、folder-kinds 的清单维护 |
| t70 | 资源管理器视图：两个根、按需展开与增量刷新、虚拟列表、三类文件夹的呈现、选择与键盘、右键菜单与 `explorer/context`、窗口内文件剪贴板、树内拖动移动、碰撞与逐项反馈 | files-explorer 的呈现与操作部分 |
| t71 | 编辑器区：编辑组与标签（preview / permanent）、`nbook.editor.open`、文档模型（打开引用、dirty、按基线保存、冲突、外部修改同步）、Markdown 编辑控件按类型复用、乐观切换与 800 ms 进度条 | files-explorer 的“文档与体验”“打开与切换” |
| t72 | 性能验收：复用 t68 的样本生成器与样本描述，生产构建、本机浏览器逐项测性能表，按测量修正 | files-explorer 验收 12 |

不在第 6 步（记入待确认清单）：`docs://`、`tmp://`、`local://`、`projects://` 与 bash（使用方是 Agent 文件工具，随 nb-harness 接入）；插件注册新方案的开放接口与虚拟提供者（第一个使用方是剧情插件的 `plot://`）；glob 与 grep（能力模型待讨论）；History 插件（提案的“默认启用、独立订阅底座事件”随 History 接入时验收，本步的事件合同按它可独立订阅来设计）；活页夹的呈现（剧情插件）；大于单条 RPC 消息的正文（见第 4 节）。

## 关键设计

### 1. 插件与位置（`src/plugins/files/`）

- 内置插件 `nbook.files`，三个入口：
  - `project` 位置：`project://` 的提供者，根是 `currentProjectKey` 的 `root`。提供远程服务 `nbook.files/project`（`provider: "project"`，调用方 `browser`、`tui`、`project`、`server`）。项目实例里的插件经同一份合同本地调用；服务端插件按 `{project: id}` 定址，由路由已有的项目租约核对保护。
  - `server` 位置：`user://` 的提供者，根是 `<状态根>/user/`（不存在时创建）。提供远程服务 `nbook.files/user`（`provider: "server"`，调用方 `browser`、`tui`、`project`、`server`）。
  - `browser` 位置：文件客户端 `filesKey`（按调用方门面），给资源管理器与编辑器用；按资源地址的方案分派到上面两份合同。
- 两份合同的方法、事件与业务失败码相同，由一个函数按方案生成（同 `nbook.settings` 两层的写法）；不另加只转发的本地服务。
- 进入产品清单（`src/manifest.ts`）：`project` 入口随项目实例 `onStartup`，`server` 入口 `onStartup`，浏览器入口在第一个使用方（t70 的资源管理器视图）依赖它时激活。

### 2. 资源地址（`shared/resource.ts`）

- `parseResource("project://a/b.md") → {scheme: "project", path: "a/b.md"}`；路径用 `/` 分隔、相对方案根，不得含空段、`.`、`..`、反斜杠、NUL，第一段不得是盘符形式（`C:`、`C:notes.md`），长度上限 4096 字节；根本身是空路径。不合法为 `invalid-address`；格式合法但没有这个方案为 `unknown-scheme`。
- 名字里的 `:` 在 Linux 与 macOS 上是合法文件名，地址接受；Windows 宿主的提供者另拒绝含 `:` 的段（备用数据流）、UNC 与设备名（本机无法验证，标为未验证）。
- `formatResource`、`parentOf`、`basenameOf`、`joinResource` 一组纯函数；浏览器与服务端共用，不碰 Node 与 DOM。

### 3. 受根约束的文件原语（`backend/rooted.ts`，加锁替换抽到共用后端模块）

只做本切片要的：解析根内路径、`lstat`、列目录、读、按基线替换。

- **根身份**：根在入口激活时 `realpath` 一次，记下路径与设备号、inode；每个请求先 `lstat` 根核对仍是同一目录，根被移走、删除或换成别的目录为 `root-gone`，不重新解析。
- **包含校验**：每个请求把相对路径拼到根上，逐级 `lstat`，遇到符号链接 `realpath` 它，落在根外为 `outside-root`；悬空链接为 `not-found`，不当作可新建的位置。
- **控制目录**：项目根下第一段名字按不区分大小写等于 `.nbook` 的目录项（项目身份、项目层配置与 Storage）是控制目录。词法路径与解析后的真实路径都要检查：任一个的根内相对路径第一段是控制目录就拒绝（`alias -> .nbook` 这类链接别名同样拒绝），失败码 `protected-path`；列根时不出现。检查只在这一个原语里做，服务内部读清单也经过它。用户资产根没有控制目录；嵌套的 `notes/.nbook/` 是普通目录。
- **按基线替换**（发现：两个调用方用同一基线都能成功、rename 绕过只读位与改掉权限、写到链接上把链接换成普通文件）：把 `settings/backend/layer-file.ts` 的加锁替换抽成共用后端模块（`src/backend/`，目录约定写进 `packages/neuro-book/AGENTS.md`；`architecture.test.ts` 已把路径段 `backend` 判为后端），settings 与 Files 共用，settings 的测试不改即通过：
  - 取锁（proper-lockfile，跨进程：两个服务端可以同时打开同一个项目）→ 读当前字节、算 hash、与基线比较（不同为 `conflict`，带当前基线）→ 核对目标仍是普通文件且可写（只读为 `permission-denied`）→ 写同目录临时文件（沿用原文件的权限位）→ fsync → 改名前核对仍持锁、文件身份没变 → rename → 释放锁。
  - 锁目录不放在用户文件旁：项目根放 `.nbook/locks/files/<真实相对路径的 hash>.lock`，用户资产根放 `<状态根>/locks/user-files/`；同一真实文件经不同链接别名得到同一把锁。
  - 符号链接解析到最终目标，替换目标、链接保留。
  - 外部编辑器不走锁：改名前的身份核对只缩小窗口，Spec 写明剩余竞态。

### 4. 读、列出与三类文件夹（`backend/files-service.ts`、`backend/folder-kinds.ts`）

- **列出**一层：`readdir(withFileTypes)`，不 `stat` 子项、不读文件内容。每项 `{name, kind: "file" | "directory" | "link" | "other"}`；目录另带 `folder: "plain" | "content" | "binder"`（只看名字后缀）。
  - 普通文件夹：目录在前，名字用一个复用的 `Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"})` 比较，相等时按 UTF-16 码元次序（`a < b`）；这是新规则，与旧应用（`localeCompare(…, "zh-Hans-CN")`，无 numeric）不同，Spec 给出示例（`chapter-2.md` 在 `chapter-10.md` 前，`A.md` 在 `a.md` 前）。
  - 内容文件夹及其任意深度的子目录：找最近的 `*.content` 祖先（含自己），每次列出都读一次它根上的 `content.xml`（不缓存；小文件，t72 测量后再定），取与当前目录对应的那一层 `item`：按清单顺序排、带 `title`、`icon`；未列入项按上面的名字规则排在末尾；清单里有、磁盘上没有的标为 `missing`；清单文件本身标 `manifest: true`。清单不合法时按普通文件夹排序，结果带 `manifest: {status: "invalid", detail}`。
  - **正文入口**（发现：父层列出看不出哪个子目录有正文）：内容树里的每个子目录各 `lstat` 一次它的 `index.md`，结果带 `body: true | false`（是普通文件才算）；不读正文、不列子目录。内容节点自己的 `index.md` 在结果里标 `role: "body"`（隐不隐藏归视图）。
  - 活页夹：本切片按普通文件夹列出并带 `folder: "binder"`。
  - 结果另带当前目录自身的 `folder` 与所属内容根（如有），视图不用自己推算。
- XML 解析用 `fast-xml-parser`（设计稿“依赖”一节已批准新增 XML 解析库）；只接受 `content` 根与嵌套 `item`（`name` 必填、`title`、`icon` 可选），`name` 必须是单个目录项名（不含 `/`、不是 `.` 或 `..`），同一层重名判为不合法；其余结构也判为不合法。清单不存在、是目录或读不出与 XML 不合法分开报告，都退回普通文件夹，不让整次列出失败。
- **读取**：返回 `{text, baseline}`，`baseline = {hash}`（内容字节的 SHA-256 十六进制）。文本用 `TextDecoder("utf-8", {fatal: true, ignoreBOM: true})` 解码，BOM 留在文本里，保存时原样写回，读写往返字节不变；含 NUL 或解码失败为 `not-text`。目录读为 `not-a-file`。
- **正文大小**（发现：8 MiB 文本超过 RPC 单条消息 1 MiB，保存时连接被断开、结果未知）：本 Task 不引入 HTTP 大块内容通道。正文的上限按“写入请求能装进一条 RPC 消息”定：`text` 经 JSON 编码后不超过 `RPC_MAX_MESSAGE_BYTES` 减去 64 KiB 的帧包络余量。读取时超过即 `too-large`（读得出就保存得了，除非编辑后变大）；浏览器客户端在发出写请求前按同一算法核对，超过直接返回 `too-large`、不发出；提供者对收到的写入再核一次。大于此限的正文何时可编辑，随第一个需要它的场景接入 HTTP 资源地址时定。
- **条件保存**：`write({path, text, baseline})` 只保存已有的普通文件，`baseline` 必填，走第 3 节的按基线替换。目标不存在为 `not-found`，类型变了为 `not-a-file`；成功返回新基线。新建文件只有 t69 的 `create` 一个入口（它同时维护清单），t68 不提供 `baseline: null`。写入只改文件内容，不建父目录。
- 业务失败码（不与路由保留码重名：`denied` 是路由的）：`invalid-address`、`unknown-scheme`、`root-gone`、`outside-root`、`protected-path`、`permission-denied`、`not-found`、`not-a-file`、`not-a-directory`、`not-text`、`too-large`、`conflict`、`io-failed`。失败详情用资源地址描述，不带服务端绝对路径（IO 异常的原文只进诊断）。

### 5. 来源与变更事件（`backend/changes.ts`）

- **来源**：由提供方按调用方身份确定，业务输入没有来源字段（合同的严格 schema 拒绝多余字段）：浏览器与 TUI 实例上的调用为 `{kind: "user", plugin}`；服务端与项目实例上的插件调用为 `{kind: "system", plugin}`；文件监视发现的为 `{kind: "external"}`。调用方身份证明的是“哪个窗口里的哪个插件执行”，不是“谁发起”：窗口里的插件替远程命令（例如 Agent 经 `nbook.commands/remote` 触发的命令）写文件时也记为 `user`。发起者沿命令调用链传到执行边界随 nb-harness 加入，Spec 写明这个限制，验收 2 只覆盖直接调用（记入待确认清单）。
- **监视**：每个根一个递归 `fs.watch`（Bun 1.4 在 Linux 上支持递归且覆盖之后新建的子目录，2026-10-09 实测），第一个订阅建立时建、最后一个订阅释放时关。
- **失同步**：以下情况整批作废、推一次 `resync`：监视器报 `error`；回调没有文件名（Bun 在 inotify 队列溢出时发 `change` 且文件名为 `null`、根自身被移动时文件名为空，都不报 `error`，审查对照 Bun 源码核实）；一批待处理路径超过 1000 个。没有文件名的回调先核对根身份：根还在就关掉旧监视器、重建递归监视再推 `resync`（溢出期间新建的子目录没有被加上监视，只重列补不回来）；根已不在就以 `root-gone` 结束全部订阅。
- **分类**：原始事件攒一批（75 ms）后，对涉及的路径各 `lstat` 一次：
  - 外部事件只分两类：路径现在存在为 `changed`，不存在为 `deleted`。`fs.watch` 对新建、原子替换、改名都只给 `rename`，事后的 `lstat` 区分不了新建与替换；不为此建整根索引。外部改名表现为旧地址 `deleted` 加新地址 `changed`。订阅方对 `changed` 按当前状态核对（重列父目录或重读文件）。
  - 经文件服务的操作给精确类型（本 Task 只有保存的 `changed`；t69 加 `created`、`renamed`、`deleted`），带真实来源。
- **自己写入的回声**：保存成功后立即以真实来源发出 `changed`（请求地址；经链接写入时真实目标的地址也发一条），并按真实目标的根内路径记下“本服务最近一次写入的内容 hash”；监视器随后对该路径报来的事件，读当前内容算 hash，与记下的相同就丢弃（内容就是自己写的），不同就作为外部修改发出并清掉记录。不用时间窗口，也不靠 `mtimeMs + size`（保留时间戳的外部修改会被它吞掉，审查实测）。
- **自己的临时文件**：保存时分配的临时文件路径登记在提供者里，监视报来的这些精确路径直接丢弃，保存结束后所在批次处理完再撤销登记；不按点文件名或后缀忽略（会吞掉用户的真实文件）。
- **订阅**：远程事件 `changes`（过滤为空），先推 `{kind: "ready"}`，之后推 `{kind: "batch", events: [{type, path, source}]}`；监视器报错时推 `{kind: "resync"}` 并重建监视。项目代次结束、提供者停止、连接中断等由内核以订阅结束或 `onResync` 结算（见第 6 节），Files 不另维护项目代次。
- 事件不持久化、不保证逐条可靠，订阅方按当前状态核对（Spec 原文）。
- 监视器、合并计时器与在途的回声核对都登记在提供者入口的作用域上，入口停止时收口，不靠进程退出代替释放。

### 6. 浏览器文件客户端（`web/client.ts`）

- `filesKey` 的门面：`list(address)`、`read(address)`、`write(address, text, baseline)`、`watch(scheme, listener) → 释放函数`。结果为 `{ok, value} | {ok: false, code, detail}`；远程层的失败（`target-gone`、`unavailable`、写请求的 `unknown-outcome` 等）原样透出，不转成空目录。
- `watch` 的监听者收到：`{kind: "ready"}`、`{kind: "batch", events}`、`{kind: "resync"}`（监视器报错，或内核在同代次重连后的 `onResync`：断线期间的事件不补发，要按当前状态重新核对）、`{kind: "ended", reason}`（订阅建立失败或结束，原样带内核的结算原因；之后不再有回调）。
- 同一窗口对同一方案只建一条远程订阅，多个监听者共享；`ended` 广播给全部监听者；一个监听者释放不影响其它；最后一个释放时退订；已释放的监听者不再收到回调。建立未完成时最后一个监听者就释放，订阅建好后立即撤回。

### 7. 测试场地与样本（`testing/`）

- 快速场地：照 `settings/testing/world.ts` 搭服务端（状态根）、项目实例（`currentProjectKey` 指向真实临时目录）与浏览器窗口，经进程内链路连路由，装真实的 `nbook.files`。用于读写、来源、订阅共享与释放、合同核对。
- 真实项目场地：复用 `server/testing/projects.ts` 与 `storage/project-child.test.ts` 的做法（真实服务端实例、项目管理器、项目子进程跑产品插件），验项目子进程里的 Files、两个窗口共享、项目代次结束后旧窗口的请求与订阅、新代次重读。不复制第二套项目租约。
- 真实传输：经真实 `startServer` 与生产 RPC 监听器的 WebSocket，验正文上限两侧（含 JSON 转义膨胀）。
- `scripts/files-sample.ts`：固定缺省 seed，生成约 3000 个 Markdown（3–5 层，单章 5–30 KB 的精确字节分布）、一个 400 项的宽目录、一个带 `content.xml` 的 `lorebook.content/`（含有正文与无正文的节点、未列入项、缺失条目）；输出机器可读的样本描述（seed、文件数、总字节、宽目录、正文标记、供冷/热打开的地址）。t68 用它取“列出不读内容”的访问记录，t72 复用同一参数与描述测性能。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workspace/resources.md` | 本切片的范围：`project://`、`user://` 随 t68，其余方案、方案注册接口、glob 与 grep 标明随后续使用方；来源按调用方身份确定；事件的 `ready`、`batch`、`resync` 推送，外部事件只分 `changed` 与 `deleted`（验收 5 的“外部改名为删除加新建”改为“旧地址删除、新地址变化”）；失败码表 |
| `docs/specs/workspace/folder-kinds.md` | 普通文件夹的排序规则与示例；内容树子目录的正文入口标记；清单每次列出读取 |
| `docs/specs/workspace/files.md` | 磁盘基线（内容 hash）、文本解码（BOM 保留、NUL 为非文本）、正文上限按 RPC 单条消息算；条件保存只针对已有文件、新建归 `create`；加锁替换的权限位、链接与剩余竞态；项目控制目录 `.nbook/`（含大小写与链接别名）不列出、不可读写；`user://` 的根位置 |
| `docs/specs/settings/configuration.md` | 若抽取共用模块改变了它的实现合同引用，同步路径 |
| `packages/neuro-book/AGENTS.md` | `src/backend/` 共用后端模块的目录约定 |
| `docs/specs/README.md` 与 `docs/modules/` | `nbook.files` 插件登记（若模块边界表要求） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 2、3 节 | 资源地址、受根约束的原语、共用加锁替换（settings 改用它） | `bun test`：路径规范化逐条（含盘符形式）；根被移走或换成链接后为 `root-gone`；根外链接、悬空链接；`.nbook`、`.NBOOK`、`alias -> .nbook` 的读与列出拒绝；两个调用方同基线并发保存恰好一个成功、另一个 `conflict`，失败后下一次合法保存能完成；`0444` 拒绝且字节不变、`0755` 保存后仍可执行、链接保存后仍是链接且目标更新；settings 原测试不改通过 |
| S2 | 第 1、4 节，第 7 节快速场地 | 两份远程合同、三个入口的最小接线、列出（三类文件夹、清单投影、正文入口）、读取与条件保存、`fast-xml-parser` 依赖 | 快速场地：浏览器、项目插件、服务端插件经合同读写两个根；清单的顺序、展示名、未列入与缺失、不合法回退、深层节点与正文入口；BOM 往返；`chmod 000` 的文件仍能列出（不可读正文不妨碍列出）；正文上限两侧 |
| S3 | 第 5、6 节 | 来源与变更事件、监视的开关与合并、回声去重、失同步与监视重建、浏览器客户端与共享订阅 | 快速场地：三种来源各由真实调用方产生；外部写、删、改名、新建子目录里的文件；回声被丢、保留时间戳的同长外部修改仍发出；一次保存只产生目标地址的事件（没有临时文件的事件）；经目录链接保存不被记为外部；监视根被移走后订阅以 `root-gone` 结束；最后一个订阅释放后监视关闭（`/proc/self/fd` 里的 inotify 实例回到基线）；一个监听者释放另一个继续；建立未完成即释放 |
| S4 | 第 7 节其余 | 真实项目场地、真实 WebSocket 正文上限、产品清单登记、样本脚本与无正文访问证据 | 真实项目子进程：读写、外部修改通知、两窗口共享、项目代次结束后旧窗口请求失败且订阅 `ended`、新代次重读；暂停项目子进程（`SIGSTOP`）制造真实 inotify 溢出，恢复后订阅收到 `resync`，且溢出期间新建的子目录里随后的修改能收到通知（监视已重建）；真实 WebSocket：上限内保存成功、超出在客户端返回 `too-large` 且连接不断；样本上 `strace -f -yy` 记录一次列出：普通目录零正文访问、内容目录只读 `content.xml`，并以“预读失败也继续”的变异核对该证据会失败；`smoke:server` 与 e2e 不退化 |
| S5 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

失同步用真实触发验证：队列溢出由暂停真实项目子进程制造，根丢失由移走临时根制造；监视器的 `error` 回调本身找不到局部复现办法时在证据里标为未验证，不用 mock 或耗尽系统 inotify 配额补。

## 验收映射

| 行为 | 入口与可观察完成条件 | 片 |
|---|---|---|
| resources 验收 1 的 `project://`、`user://` 读与列出；未注册的方案为“方案不存在” | 浏览器经 `filesKey` 调用，结果与磁盘一致 | S2 |
| resources 验收 2：写作者与系统写入的来源正确，调用方不能冒充 | 浏览器、项目插件、服务端插件直接各保存一次，订阅收到的来源分别为 `user`、`system`（插件 id 正确）；输入带来源字段被 schema 拒绝。经远程命令间接发起的写入不在本 Task 覆盖 | S3 |
| resources 验收 5：经文件服务的写入事件带来源；外部改名为旧地址删除、新地址变化 | 等 `ready` 后做磁盘操作，按地址等目标事件 | S3 |
| resources 验收 6：项目代次结束后 `project://` 请求失败、订阅结束、迟到结果不投递 | 真实项目子进程结束后旧窗口调用失败、监听者收到 `ended` | S4 |
| resources 验收 7：列出 3000 个文件的根与任一层不读内容 | `strace` 访问记录与变异核对 | S4 |
| folder-kinds：后缀识别、清单的顺序与展示名、未列入与缺失、不合法回退、正文入口 | 快速场地列出结果 | S2 |
| files 验收 4 的服务侧：过期基线与同基线并发保存得到冲突，不覆盖 | 磁盘字节等于成功的那次提交 | S1、S2 |
| files 验收 5 的服务侧：外部修改收到通知；断线、队列溢出与项目结束可观察 | 监听者收到 `batch`、`resync`、`ended`；溢出后监视恢复 | S3、S4 |
| files 验收 6 的服务侧：越界、控制目录（含别名）、根外链接、根被替换、只读拒绝，根外数据不变 | 原语与合同两层各验一次 | S1、S2 |
| files 验收 7 的服务侧：一个窗口释放订阅，另一个窗口仍可读写 | 真实项目场地两个窗口 | S4 |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑 typecheck。
- 收口：`test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`。
- 真实环境：真实临时目录与真实监视；项目子进程与 WebSocket 由 S4 的场地直接验，不借 `smoke:server` 与项目 e2e 冒充（它们不消费 Files）。浏览器界面的端到端在 t70。
- 未验证边界：macOS 与 Windows 的递归监视与大小写不敏感卷（本机只有 Linux）；网络文件系统上 `fs.watch` 收不到事件；root 或绕过权限位的进程下的只读语义；大目录的监视事件洪水（t72 在样本上测）。

## 不做与风险

- 不做：新建、改名、移动、复制、删除（t69）；界面（t70、t71）；性能修正（t72）；HTTP 大块内容通道；见“第 6 步分解”的推迟项。
- 风险：抽取 settings 的加锁替换会动已实现的代码：先让 settings 全部测试原样通过，再接 Files。
- 风险：递归 `fs.watch` 在大目录（`node_modules` 一类）上的开销与事件洪水：第一版不加排除规则，t72 在样本上测事件量；需要时加忽略名单（`.git/` 等）。
- 风险：回声判断要为“本服务写过的路径”的监视事件读一次文件算 hash；只对这些路径做，其余事件不读内容。
