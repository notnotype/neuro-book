# t26 实施计划：写入接口（文件访问第 1 阶段）

第二稿（2026-11-02）：按设计审查修订（[处理](evidences/design-review-disposition.md)）。与第一稿最大的不同：暂存不再经远程 `stage` 建，写入方直接在根的暂存目录里写、只发一次 `commit`；提交从 `replaceLocked` 拆成单独的函数，记账、回声与事件都在锁里；不再为硬链接就地写、不再在目标目录放暂存。

## Context

t12 的基础工具要分页读大文件、读图片字节、流式写大结果，现有的服务端文件服务（`serverFilesKey`）一次交整份文本、上限约 960 KiB、不能写字节。开发者 2026-11-02 接受了 [文件访问与改动记账](../../../../../docs/proposals/file-access-and-history.md)（[ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)）：读拿字节或本机路径自己读，写只有一个入口，写入方暂存、拥有根的进程提交。本 Task 做它的第 1 阶段，交出写入接口，作为 t12 的底座；不接 History、不改监视（第 2、3 阶段）。

依据：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 标 `(planned)` 的“写入接口”“写入接口的读”“暂存与提交”“文件操作”“操作分组”“记账槽”与验收 11–15；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 10 与验收 6；[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的提交、回声与控制目录；[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md) 的失败语义。

开发者已定、不再议：提案的决策记录各行；t12 README 第 13 条（用户自己建的链接，读时跟到目标）。

## 技术选型

| 问题 | 选用 | 理由 / 否决 |
|---|---|---|
| 暂存与旧内容的哈希 | `Bun.CryptoHasher("sha256")` 分块算 | 与 `hashOf` 同一算法、不用整份留在内存 |
| 跨进程锁（文件写入锁、暂存文件的活性锁） | 现有 `locked-replace.ts` 的 `holdLock`（proper-lockfile） | 已有；10 秒不刷新算残留，写入方崩溃后可回收 |
| “必须不存在”的原子新建 | `node:fs` 的 `link` 加删暂存 | 目标已存在即 `EEXIST`，不会覆盖并发新建的文件；Node 没有 `renameat2(RENAME_NOREPLACE)` |

## 关键设计

### 暂存与提交的流程

1. **写入方建暂存**：在根的暂存目录里排他建 `<uuid>.stage`（`0o600`），并对它持一把活性锁（`holdLock("<文件>.lock")`）；写入函数经 `sink` 写入，边写边算哈希；写完 `fsync`、关闭。暂存目录：项目 `<项目目录>/.nbook/staging/`（服务端从项目登记取项目目录），`user://` 与挂载方案 `<状态根>/staging/`。建目录时逐层 `lstat`，`.nbook`、`staging` 必须是根内的真实目录，是链接或别的就失败（`io-failed`），不跟随。
2. **一次提交**：`projects://` 在一次 `withProject` 里发项目合同的 `commit({stage, path, expect, createParents?, as?, group?})`；`user://` 与挂载方案在进程内调同一个提交函数。
3. **结算**：成功时暂存已被消费，写入方放活性锁；业务失败（`conflict` 等）时暂存没被消费，写入方删它、放锁；`unknown-outcome` 时写入方只放锁、不删（拥有根的进程可能还在消费），交 `unknown-outcome`；写入函数抛错或取消时不发提交，删暂存、放锁，交 `io-failed` 或 `cancelled`。
4. **清理**：拥有根的进程打开根时，枚举暂存目录里名字合格式的普通文件，非阻塞地取它的活性锁，取得到（写入方已不在）才删。

### 提交（`src/backend/locked-replace.ts` 新增 `commitStaged`）

`replaceLocked` 不动（配置层与浏览器保存照旧）。新函数与它共用 `holdLock`、身份比较与失败辅助：

1. 取目标文件的写入锁（锁名同 `rooted.ts` 现在的规则：已存在的按解析后的真实相对路径，不存在的按位置 `父目录真实路径/名字`，两者对同一文件一致，浏览器保存与提交互斥）。
2. 读目标状态；存在时分块算哈希（32 MB 内同时留下字节给记账），不是普通文件为 `not-a-file`。
3. 调用方核对期望；不符为 `conflict`，带当前基线，暂存不动。
4. 存在时核对可写，把暂存设成目标的权限位；不存在时设为 `0o666 & ~umask`（与“新建文件”一致）。
5. 改名前核对仍持锁、目标身份没变；变了从第 2 步重做（至多 3 次，暂存不动）。
6. 落盘：存在时 `rename(暂存, 目标)`；`absent` 时 `link(暂存, 目标)` 再删暂存，`EEXIST` 为 `conflict`，文件系统不支持硬链接时 `open(目标, "wx")` 拷入。`EXDEV`（跨盘，含 bind mount）时在锁里把暂存拷进目标目录的临时文件（`ChangeHub.temporaryPath`，同实例回声）再改名或链接。`createParents` 时先按段建父目录。
7. **锁内成功阶段**：`lstat` 目标得到替换后的状态，调用方的 `committed(after, before)` 依次交记账槽、登记回声、发事件；之后放锁。

回声登记现有的 `entry` 一类（dev、ino、birthtime、ctime），状态在锁里改名之后取，外部在放锁后的改写不会被当成回声。不再为硬链接就地写：与浏览器保存一样改名替换，链接断开（偏离提案，记待确认）。

### 拥有根的一侧（`plugins/files/backend/staging.ts` 新增；`rooted.ts`）

- `staging.ts`：暂存目录的安全建立与打开根时的清理；`commit(root, {stage, path, expect, createParents, source, group})` 解析目标（`root.resolve` 或 `resolveSlot`，控制目录与根外检查照旧）、核对暂存文件是本根暂存目录里名字合格式的普通文件（`lstat`，不跟随），再调 `commitStaged`。
- `rooted.ts` 新增 `resolveForRead(path)`：词法路径照旧核对控制目录与根身份；逐段解析，遇到链接跟到最终目标，**目标在根外也接受**；目标在根内时再核对控制目录（名字与 inode 别名）；悬空链接为 `not-found`。只供读路径用，写与浏览器的读不变。

### 项目合同（`plugins/files/shared/contracts.ts`，版本 7）

- 新增 `commit({stage, path, expect, createParents?, as?, group?})` → `{baseline}`。`realPath` 加 `follow?: true`（用 `resolveForRead`）。这两项只接受服务端的 `nbook.files`：在 `implementation(backend, consumer)` 里按调用方身份核对，别的调用方 `permission-denied`，不靠参数。不交回任何暂存路径。
- 文件操作（`createContent`、`rename`、`convert`、`reorder`、`display`、`include`、`drop`、`move`、`copy`、`delete`）加 `as?` 与 `group?`，规则同 `write`、`create`（`sourceFor`）。
- `ChangeSource` 的 Agent 来源加 `entry?`；变更事件加 `group?: {id, title, note?}`；事件、`as` 与 `ChangeSource` 用同一个 schema。`user://` 合同同样升到版本 7。

### 服务端：写入接口（`plugins/files/shared/workspace-files.ts` 新增；`backend/workspace-files.ts` 取代 `server-files.ts`）

- 类型、服务键 `workspaceFilesKey`（`nbook.files/workspace`）、`baselineOf` 放 `shared/workspace-files.ts`，经 `shared/contracts.ts` 再导出。`ServerFiles`、`serverFilesKey` 删除（调用方只有 `nbook.agent`）。
- 按调用方门面，分派同现在的 `provideServerFiles`；`as` 照旧只认服务端的 `nbook.agent`，可带 `entry`。
- `read`：按方案分派。真实文件：取读路径后本机打开，用打开的句柄核对身份、读字节（超过 32 MB 为 `too-large`）、算基线；`projects://` 与挂载方案的虚拟根交回提供者生成的文字的字节与它的基线。不经项目合同传内容。
- `readPath`：`projects://` 调 `realPath({follow: true})`，`user://` 用 `resolveForRead`，挂载方案用现有的 `realPath`（按真实路径授权，不跟到挂载点外）。
- `stage`、`write`、`update`：按上文“暂存与提交的流程”；`update` 读、改、按读到的基线写回，`conflict` 时重做至多 3 次，文字按严格 UTF-8 解码（复用 `decodeText`）。
- 文件操作：`user://` 进程内调 `operations`、`batch`；`projects://` 经项目合同带 `as`、`group`；挂载方案只有 `create`，其余 `unsupported-capability`。
- `group(info, run)`：交给 `run` 一个带 `{id: randomUUID(), title, note?}` 的门面，经它的调用都带 `group`。
- 挂载方案的写入改走同一个提交（暂存在 `<状态根>/staging/`，挂载点在别的盘时走 `EXDEV` 的拷入）；挂载方案不发事件、不记账，照旧。

### 记账槽（`plugins/files/shared/ledger.ts` 新增）

- 贡献点 `files.ledger`，至多一个贡献者（第二个被拒，写诊断）；服务端与项目入口都接收。
- 记账者 `record(entry: LedgerEntry, signal)`；`LedgerEntry` 是 `{id, seq, root: "project" | "user", path, op, before: {hash, bytes | null} | null, after: {hash, bytes | null} | null, source, group}`（`op` 为 `write`、`created`、`deleted`、`renamed` 带 `from`、`copied`；超过 32 MB 时 `bytes` 为 null；`seq` 是这个根里单调递增的序号）。在锁内成功阶段调用，Files 至多等 2 秒就继续并放锁，迟到的完成被忽略、写诊断；记账者按 `seq` 排序去重（第 3 阶段接 History 时实现）。形状第 3 阶段可以改，所以不进 SDK。
- 第 1 阶段只有文件写入（提交与浏览器保存）交记账槽；文件操作的记账随第 3 阶段（它们在 `commit.ts` 里各有锁的时机，要逐项定在哪里交）。

### Agent（`plugins/agent/shared/resources.ts`、`backend/resources.ts`、`backend/tools.ts`）

- `SessionResources` 改为 `WorkspaceFiles` 的会话绑定版加 `expand`、`classify`、`call(ctx, {title?, note?})`：每个方法先改写地址；只有写与文件操作按 `classify().write` 判（`denied` 为 `permission-denied`），读与列出按方案的读授权（读别的会话的 `session.jsonl`、`docs://`、虚拟根照旧可以）；再以 `as: {agent}` 调写入接口。
- `call(ctx)` 交回绑定一次工具调用的门面：`as` 另带 `entry: ctx.callId`；`ctx.signal` 合进每次调用的 `signal`；包在一个分组里，标题缺省为工具 id。`AgentTools` 构造资源视图时把工具 id 交进去（`services(context, toolId)`）。
- 内核的资源接口（`SessionEnv.resources.read` 读文本）改为 `read` 后用 `decodeText` 解码，`not-text` 照旧抛出。
- t08 的 `resources.test.ts` 随新方法改写；行为不变的断言不改。

### SDK（`src/sdk/files.ts`、`src/sdk/entries.ts`、`plugin-sdk/README.md`）

- 照 `/storage` 新增 `@notnotype/nb-plugin-sdk/files`（服务端与项目实例可用）：`workspaceFilesKey`、`baselineOf` 与 `WorkspaceFiles`、`StagedSink`、`CommitOptions`、`ServerFilesResult` 等类型；`sdk.test.ts` 与 `pack.test.ts` 的导出清单加这一项；README 的子路径表加一行，并加一小节“读写书里的文件”。
- 项目实例入口也提供 `workspaceFilesKey`（进程内，暂存在本项目的 `.nbook/staging/`）。

## Spec 与文档改动

- `workspace/resources.md`（随本稿改）：结果不确定一律交 `unknown-outcome`；暂存只放根的暂存目录，跨盘在锁里拷入，去掉目标目录的前缀回退；清理按活性锁；去掉硬链接就地写；`absent` 不覆盖并发新建；读路径只给服务端的 `nbook.files`；事件的分组带 `note`；Agent 来源带 `entry`；记账槽的超时语义与序号；第 1 阶段只有文件写入交记账槽。验收 11 去掉硬链接、加 `absent` 与新建并发；验收 13 改为“交 `unknown-outcome`，以原期望重试得到确定结果”。
- `agent/resources.md`：输出 10 补“只有写与文件操作按分类判”与 `call(ctx)` 注入 `signal`、缺省标题为工具 id。
- 实现完成后补两份 Spec 的实现合同与证据，晋升另请开发者批准。

## 切片

1. **提交与暂存**：`commitStaged`、`staging.ts`、`resolveForRead`；项目合同版本 7（`commit`、`realPath(follow)`、文件操作的 `as` 与 `group`、事件的 `group`、来源的 `entry`），`user://` 合同版本 7。验证：`files/` 的测试（真实项目子进程）。
2. **服务端写入接口**：`workspace-files.ts`、分派、`read`、`readPath`、`stage`、`write`、`update`、文件操作、分组；挂载方案改走提交；删 `server-files.ts`。
3. **记账槽**。
4. **Agent 迁移**：`SessionResources`、`call(ctx)`、`tools.ts` 交工具 id、内核资源接口、t08 测试。
5. **SDK 子路径**与 README。
6. **收口**：`test:affected --since <起点>`、`typecheck`、`governance:check`、`docs:check`；关键规则做变异检查；实现审查（后端，omp）。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `workspace/resources.md` 验收 11 | `files/workspace-files.test.ts`（真实项目子进程）：8 MB 二进制 `stage` 与文本 `write` 逐字节一致；浏览器订阅收到带来源的事件、没有外部回声；三种期望各自成立与冲突；写入函数抛错、取消后目标不变、暂存目录无残留；新建的权限位与“新建文件”相同 |
| 验收 12 | 同上：外部改动后旧基线提交得 `conflict`；浏览器保存与提交同一文件并发恰好一次成功；`absent` 提交与“新建文件”并发恰好一方成功、字节不被覆盖 |
| 验收 13 | 同上：提交发出后结束项目子进程，得 `unknown-outcome`；以原期望重试得到确定结果；再次打开项目后暂存目录被清理 |
| 验收 14 | `files/ledger.test.ts`：测试插件贡献记账者，收到的改前改后、来源、组与序号与实际一致；抛错与超时（忽略 `signal` 的记账者）时提交在约 2 秒内成功且有诊断；撤回后提交照常 |
| 验收 15 | `files/workspace-files.test.ts`：挂载方案里不露出的文件取不到；项目里指向根外的链接给目标路径、指向控制目录的被拒；浏览器调 `realPath({follow})` 与 `commit` 为 `permission-denied`；`read` 超过 32 MB 为 `too-large`；虚拟根的 `read` 得到文字 |
| 提交的边界 | `files/commit-staged.test.ts`（真实文件系统）：目标身份变了一次后重做成功、暂存不丢；`EXDEV`（暂存放在 `/dev/shm` 一类的另一个文件系统）走拷入；替换一个大文件时内存不随旧文件增长（以 32 MB 以上的旧文件与 `bytes` 为 null 核对）；`.nbook/staging` 是链接时建暂存失败、清理不进链接目标；另一个进程持着活性锁的暂存不被清理 |
| `agent/resources.md` 验收 6 | `agent/resources.test.ts`：一次调用写两个、删一个，三条事件同一会话、同一条目 id、同一组、组标题是工具 id；读别的会话的 `session.jsonl` 照旧成功；调用中途取消后目标不变 |
| 旧行为不变 | `files/` 与 `agent/` 现有测试照旧通过（浏览器保存、文件操作、挂载方案授权与寿命） |

## 验证

- 上面的测试都用真实插件宿主与真实项目子进程；`test:affected`、`typecheck`、治理与文档检查。
- 未验证：Windows 与 macOS 上的改名、`link` 与跨盘（第 4 阶段）。

## 不做与风险

- 不做：History 与账本（第 3 阶段）；文件操作交记账槽（第 3 阶段）；监视常驻、对账兜底、shell 的推断归属（第 2 阶段）；浏览器保存改走暂存（行为不变）。
- 风险：项目合同与 `user://` 合同升版本 7，开着的旧窗口要刷新；`as` 扩到全部文件操作，要守住“只认服务端 `nbook.files`”；两个实例互看对方的临时文件会被当作外部改动（现有行为，第 2 阶段处理监视时一并看）。

## 开发者的决定（2026-11-02）

1. 计划确认。锁的范围按推荐：第 1 阶段沿用现有的锁（提交与保存取文件锁，文件操作照现有规则取操作锁），Spec 已改；第 3 阶段接账本时如需定先后再按路径加锁，不整根串行。与提案“一个根的全部写入共用操作锁”的出入记在提案的决策记录。
2. 本 Task 在单独的分支上做；没有开发者允许不合并到 master。
