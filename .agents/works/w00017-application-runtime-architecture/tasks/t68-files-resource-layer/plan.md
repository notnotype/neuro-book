# t68 实施计划：Files 竖切一：资源层与文件服务

## Context

- **为什么做**：第 6 步是 Files 竖切（[v2 重建提案](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 推进顺序第 6 条：资源层 → 文件资源管理器视图 → 编辑器打开与切换，性能按 `workbench.files-explorer` 的标准验收）。依据是 [项目文件底座与 Files 竖切](../../../../../docs/proposals/project-file-foundation.md)（2026-10-02 `accepted`）与四份 `planned` Spec：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)。资源层的 Opus 与 omp 对照实验 2026-10-08 由开发者暂缓，仍由 Opus 编码、omp 审查。
- **已有的底座**：项目实例（`runtime.projects`：每个打开的项目一个子进程里的 `project` 位置内核实例，项目里的插件经 `currentProjectKey` 取项目目录）；远程服务（`provider: "project"` 的合同从浏览器 `remote.use(合同)` 直达窗口绑定的项目代次，代次结束时请求失败、订阅以 `project-gone` 结束）；Storage、配置与公开状态（K4–K6）；工作台外壳一至三（视图贡献点 `workbench.views`、命令、拖放）。旧应用的 Files（`packages/neuro-book-legacy/server/workspace-files/`、`server/features/platform-files/`）只作行为参照：v2 不搬它的 Project 会话、索引与 frontmatter 预读。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)，与 t65–t67 相同（worktree 逐片提交并 push；真实内核、真实文件系统与本机 Chrome；不用 mock、spy、假计时器、固定等待；变异检查；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。

## 第 6 步分解

Files 竖切按依赖拆成五个 Task，每个 Task 自带计划、三方审查与实现审查：

| Task | 范围 | 主要 Spec |
|---|---|---|
| t68（本 Task） | 资源层：`nbook.files` 插件、`project://` 与 `user://` 提供者、列出一层（三类文件夹的投影）、读取与磁盘基线、条件写入与来源、变更事件、浏览器文件客户端 | resources、folder-kinds、files 的读写部分 |
| t69 | 文件操作：新建文件与文件夹、创建内容、改名、移动、复制、删除；批量的逐项结果、排他提交、冲突、取消与结果未知；内容文件夹内的操作同步清单 | files 的操作部分、folder-kinds 的清单维护 |
| t70 | 资源管理器视图：两个根、按需展开与增量刷新、虚拟列表、三类文件夹的呈现、选择与键盘、右键菜单与 `explorer/context`、窗口内文件剪贴板、树内拖动移动、碰撞与逐项反馈 | files-explorer 的呈现与操作部分 |
| t71 | 编辑器区：编辑组与标签（preview / permanent）、`nbook.editor.open`、文档模型（打开引用、dirty、按基线保存、冲突、外部修改同步）、Markdown 编辑控件按类型复用、乐观切换与 800 ms 进度条 | files-explorer 的“文档与体验”“打开与切换” |
| t72 | 性能验收：约 3000 个 Markdown 文件的生成样本，生产构建、本机浏览器逐项测性能表，按测量修正 | files-explorer 验收 12 |

不在第 6 步：`docs://`、`tmp://`、`local://`、`projects://` 与 bash（它们的使用方是 Agent 文件工具，随 nb-harness 接入）；插件注册新方案的开放接口与虚拟提供者（第一个使用方是剧情插件的 `plot://`）；glob 与 grep（能力模型待讨论，见设计稿“后续重构”）；History 插件；活页夹的呈现（剧情插件）。这些推迟记入待确认清单。

## 关键设计

### 1. 插件与位置（`src/plugins/files/`）

- 内置插件 `nbook.files`，三个入口：
  - `project` 位置：`project://` 的提供者，根是 `currentProjectKey` 的 `root`。提供远程服务 `nbook.files/project`（`provider: "project"`，调用方 `browser`、`tui`）。
  - `server` 位置：`user://` 的提供者，根是 `<状态根>/user/`（不存在时创建）。提供远程服务 `nbook.files/user`（`provider: "server"`，调用方 `browser`、`tui`、`project`）。
  - `browser` 位置：文件客户端 `filesKey`（按调用方门面），给资源管理器与编辑器用；按资源地址的方案分派到上面两份合同。
- 两份合同的方法与事件相同（同 `nbook.settings` 两层的写法）；客户端只认资源地址，不认合同。
- 进入产品清单（`src/manifest.ts`）；入口激活懒：`project` 入口随项目实例 `onStartup`（项目实例里只有它与 Storage 等少数入口），`server` 入口 `onStartup`，浏览器入口在第一个使用方（t70 的资源管理器视图）依赖它时激活。

### 2. 资源地址（`shared/resource.ts`）

- `parseResource("project://a/b.md") → {scheme: "project", path: "a/b.md"}`；路径用 `/` 分隔、相对方案根，规范化后不得含空段、`.`、`..`、反斜杠、NUL，长度上限 4096；根本身是空路径。不合法为 `invalid-address`。
- `formatResource`、`parentOf`、`basenameOf`、`joinResource` 一组纯函数；浏览器与服务端共用，不碰 Node 与 DOM。

### 3. 受根约束的文件原语（`backend/rooted.ts`）

只做本切片要的：解析根内路径、`lstat`、列目录、读、排他创建、按基线替换。从旧应用 `platform-files/paths.ts` 改写包含校验的做法：

- 根在入口激活时 `realpath` 一次并记下；每个请求把相对路径拼到根上，逐级 `lstat`：遇到符号链接时 `realpath` 它，落在根外为 `outside-root`；目标不存在时只校验已存在的最近祖先。
- 项目根的 `.nbook/`（项目身份、项目层配置与 Storage）是控制目录：列根时不出现，任何读写都 `denied`。用户资产根没有控制目录。
- 写入用“写同目录临时文件 → fsync → rename 替换”，读到的不会是半截文件；排他创建用 `open(..., "wx")`。

### 4. 读、列出与三类文件夹（`backend/files-service.ts`、`backend/folder-kinds.ts`）

- **列出**一层：`readdir(withFileTypes)`，不 `stat` 子项、不读文件内容。每项 `{name, kind: "file" | "directory" | "link" | "other"}`；目录另带 `folder: "plain" | "content" | "binder"`（只看名字后缀）。结果的排序与展示：
  - 普通文件夹：按名字（Unicode 码位比较，大小写不敏感时以原名为次序，见下）排序，目录在前；没有展示名。
  - 内容文件夹及其任意深度的子目录：找最近的 `*.content` 祖先（含自己），读它根上的 `content.xml`（按 `mtimeMs + size` 缓存，变更事件让缓存失效），取与当前目录对应的那一层 `item`：按清单顺序排、带 `title`、`icon`；未列入项按真实名字排在末尾；清单里有、磁盘上没有的标为 `missing`；清单文件本身标 `manifest: true`（显不显示归视图）。清单不合法时按普通文件夹排序并带 `manifest: {status: "invalid", detail}`。
  - 活页夹：本切片按普通文件夹列出并带 `folder: "binder"`（呈现归剧情插件，未启用时视图提示，见 folder-kinds 输出）。
  - 排序规则写进 Spec：目录在前，名字按 `Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"})`，相等时按码位；与旧应用的文件树一致性由实现时对照确认。
- XML 解析用 `fast-xml-parser`（设计稿“依赖”一节已批准新增 XML 解析库）；只接受 `content` 根与嵌套 `item`（`name` 必填、`title`、`icon` 可选），其余结构判为不合法。
- **读取**：返回 `{text, baseline}`，`baseline = {mtimeMs, size, hash}`（`hash` 是内容的 SHA-256 前 16 字节十六进制）；只接受 UTF-8 文本，解码失败为 `not-text`；超过 8 MiB 为 `too-large`（编辑器不打开）。目录读为 `not-a-file`。
- **条件写入**：`write({path, text, baseline})`：`baseline` 与磁盘当前的 `hash` 不同为 `conflict`（带当前基线），相同才替换；`baseline: null` 表示新建，目标已存在为 `conflict`。成功返回新基线。写入只改文件内容，不建父目录（新建文件夹归 t69）。
- 失败码（远程合同的业务失败码）：`invalid-address`、`outside-root`、`denied`、`not-found`、`not-a-file`、`not-a-directory`、`not-text`、`too-large`、`conflict`、`io-failed`。

### 5. 来源与变更事件（`backend/changes.ts`）

- **来源**：由提供方按调用方身份确定，输入里没有来源字段：浏览器与 TUI 实例上的调用为 `{kind: "user"}`（写作者）；服务端与项目实例上的插件调用为 `{kind: "system", plugin}`；文件监视发现的为 `{kind: "external"}`。Agent 会话的来源随 nb-harness 加入（调用方身份里届时有会话）。
- **监视**：每个根一个递归 `fs.watch`（Bun 1.4 在 Linux 上支持递归且覆盖之后新建的子目录，2026-10-09 实测），第一次有订阅时建、最后一个订阅释放时关。事件先攒 75 ms，再对涉及的路径 `lstat` 一次定出 `created`、`changed`、`deleted`（`fs.watch` 只给 `rename`、`change`），同一路径在一批里合并。
- **自己的写入**：写入成功后立即以真实来源发出 `changed`（或新建的 `created`），并登记“这个路径最近被自己写过的基线”；随后监视器对同一路径报来的事件，`lstat` 与该基线的 `mtimeMs + size` 一致就丢弃（是自己写入的回声），不一致就作为外部修改发出。不用时间窗口猜。
- **订阅**：远程事件 `changes`（过滤为空），先推 `{kind: "ready"}`，之后推 `{kind: "batch", events: [{type, path, source}]}`；监视出错或丢事件（`fs.watch` 的 `error`）推 `{kind: "resync"}`，订阅方据此重新列出已展开的目录。项目代次结束时订阅以内核的 `project-gone` 结束，迟到事件不投递（内核已保证）。
- 事件不持久化、不保证逐条可靠，订阅方按当前状态核对（Spec 原文）。

### 6. 浏览器文件客户端（`web/client.ts`）

- `filesKey` 的门面：`list(address)`、`read(address)`、`write(address, text, baseline)`、`watch(scheme, onEvent) → 释放函数`。按方案选合同，结果原样转成 `{ok, value} | {ok: false, code, detail}`；远程层的 `target-gone`、`project-gone` 等原样透出，不转成“空目录”。
- 同一窗口对同一方案只建一条远程订阅，`watch` 的多个使用方共享它；最后一个释放时退订。

### 7. 测试场地与样本（`testing/`）

- `files/testing/world.ts`：照 `settings/testing/world.ts` 搭服务端（状态根）、项目实例（`currentProjectKey` 指向真实临时目录）与浏览器窗口，三者经进程内链路连路由，帧走 JSON 编解码，装真实的 `nbook.files`。
- `scripts/files-sample.ts`：按参数生成约 3000 个 Markdown 文件、3–5 层目录、单章 5–30 KB 的样本项目（含一个带 `content.xml` 的 `lorebook.content/`），t68 用它验收“列出不读内容”，t72 用它测性能。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workspace/resources.md` | 本切片的范围：首批方案里 `project://`、`user://` 随 t68，其余方案、方案注册接口、glob 与 grep 标明随后续使用方；来源的取值按调用方身份确定；事件的 `ready`、`batch`、`resync` 三种推送；失败码表 |
| `docs/specs/workspace/folder-kinds.md` | 普通文件夹的排序规则（目录在前、名字的比较方式）；清单缓存与失效 |
| `docs/specs/workspace/files.md` | 读取的磁盘基线形状、文本与大小限制、条件写入（`baseline: null` 为新建）；项目控制目录 `.nbook/` 不列出、不可读写；`user://` 的根位置 |
| `docs/specs/README.md` 与 `docs/modules/` | `nbook.files` 插件登记（若模块边界表要求） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 2、3 节 | 资源地址与受根约束的原语 | `bun test`：路径规范化逐条、根外链接、`.nbook/` 拒绝、排他创建、替换写不留半截 |
| S2 | 第 4 节 | 列出（三类文件夹与清单投影）、读取与条件写入、`fast-xml-parser` 依赖 | `bun test`：清单的顺序、展示名、未列入与缺失、不合法回退；列出对 `chmod 000` 的文件仍成功（证明不读内容）；基线冲突 |
| S3 | 第 5 节 | 来源与变更事件、监视的开关与合并、自己写入的回声去重 | `bun test`：真实目录上外部写、自己写、删除、改名、新建子目录里的文件；订阅释放关监视 |
| S4 | 第 1、6、7 节 | 插件三个入口与两份远程合同、浏览器客户端、测试场地、产品清单、样本脚本 | 多实例场地：浏览器经路由读写项目与用户资产、来源为 `user`、项目代次结束后请求失败与订阅结束；`smoke:server` 与 e2e 不退化 |
| S5 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| resources 验收 1 的 `project://`、`user://` 读与列出；未注册的方案为“方案不存在” | S2、S4 |
| resources 验收 2：写作者与系统写入的来源正确，调用方不能冒充 | S3、S4（来源只由调用方身份决定，输入里没有来源字段） |
| resources 验收 5：经文件服务的写入事件带来源；外部改名为删除加新建 | S3 |
| resources 验收 6：项目代次结束后 `project://` 请求失败、订阅结束、迟到结果不投递 | S4 |
| resources 验收 7：列出 3000 个文件的根与任一层不读内容 | S2（`chmod 000` 法）、S4（样本） |
| folder-kinds：后缀识别、清单的顺序与展示名、未列入与缺失、不合法回退 | S2 |
| files 验收 4 的服务侧：过期基线保存得到冲突，不覆盖 | S2 |
| files 验收 5 的服务侧：外部修改收到通知；监视出错推 `resync` | S3 |
| files 验收 6 的服务侧：越界、`.nbook/`、根外链接拒绝，根外数据不变 | S1 |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑 typecheck。
- 收口：`test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`。
- 真实环境：测试场地用真实临时目录与真实监视；项目子进程里的入口由 `smoke:server` 与 e2e 的项目流程覆盖激活（本 Task 没有界面，浏览器侧的端到端在 t70）。
- 未验证边界：macOS 与 Windows 的递归监视（本机只有 Linux）；网络文件系统上 `fs.watch` 收不到事件。

## 不做与风险

- 不做：文件操作（t69）、界面（t70、t71）、性能修正（t72）；见“第 6 步分解”的推迟项。
- 风险：递归 `fs.watch` 在大目录（`node_modules` 一类）上的开销与事件洪水：第一版不加排除规则，样本项目上测事件量；需要时加忽略名单（`.git/` 等）。
- 风险：自己写入的回声去重依赖 `mtimeMs + size`：同一毫秒内外部又写了同样大小的内容会被当回声丢掉；概率低，订阅方在窗口重新获得焦点时可重新核对（t70）。
