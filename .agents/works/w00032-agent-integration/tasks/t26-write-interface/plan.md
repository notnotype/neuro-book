# t26 实施计划：写入接口（文件访问第 1 阶段）

第一稿（2026-11-02）。

## Context

t12 的基础工具要分页读大文件、读图片字节、流式写大结果，现有的服务端文件服务（`serverFilesKey`）一次交整份文本、上限约 960 KiB、不能写字节。开发者 2026-11-02 接受了 [文件访问与改动记账](../../../../../docs/proposals/file-access-and-history.md)（[ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md)）：读拿字节或本机路径自己读，写只有一个入口，写入方暂存、拥有根的进程提交。本 Task 做它的第 1 阶段，交出写入接口，作为 t12 的底座；不接 History、不改监视（第 2、3 阶段）。

依据：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 标 `(planned)` 的“写入接口”“写入接口的读”“暂存与提交”“文件操作”“操作分组”“记账槽”与验收 11–15；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 10 与验收 6；[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的提交、回声与控制目录；[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md) 的失败语义。

开发者已定、不再议：提案的决策记录各行；t12 README 第 13 条（用户自己建的链接，读时跟到目标）。

## 技术选型

| 问题 | 选用 | 理由 / 否决 |
|---|---|---|
| 暂存内容的哈希 | `Bun.CryptoHasher("sha256")` 边写边算 | 与 `hashOf` 同一算法、不用整份留在内存；否决写完再读一遍 |
| 跨进程锁 | 现有 `locked-replace.ts`（proper-lockfile） | 已有，跨进程 |

## 关键设计

### 拥有根的一侧：暂存与提交（`plugins/files/backend/staging.ts`，新增；`src/backend/locked-replace.ts`）

- `locked-replace.ts` 的决定多一种 `{adopt: 暂存文件路径}`：不写临时文件，而是把暂存文件当临时文件用：按原文件设权限位、`fsync`、改名前照旧核对锁与文件身份、改名替换。目标的硬链接数大于 1 时改为在锁里就地写（截断后从暂存文件拷入、`fsync`），链接保留。其余步骤（读当前字节、核对可写、身份变了重做、失败收尾）不变，配置层的调用方不受影响。
- `staging.ts` 按根建一个暂存管理器：
  - `prepare(path, {createParents})`：在锁外解析目标位置（`root.resolveSlot`，含控制目录与根外检查；父目录不存在且 `createParents` 时报出需要建，提交时再建，避免取消后留下空目录）；暂存目录与目标的真实父目录 `dev` 相同时放在暂存目录，否则放目标目录下、名字以 `.nbook-staging-` 开头；`wx`、`0o600` 建文件；登记 `token → {path, target}`，交回 `{token, path}`。
  - `commit(token, {expect, createParents, source, group})`：建父目录（`createParents`）→ `root.replace` 带 `{adopt}`，`decide` 里核对期望（基线比 `hashOf`，`absent` 要求不存在，`any` 不论）→ 登记回声 → 发事件 → 交记账槽 → 交回新基线。期望不符时删暂存文件、交 `conflict` 带当前基线。
  - `discard(token)`；调用方门面释放时丢弃它名下全部 token。
  - 打开根时删除暂存目录里 1 小时没有改动的文件。
  - 项目的暂存目录 `.nbook/staging/`；`user://` 的 `<状态根>/staging/user/`。
- **回声**：提交后的目标是暂存文件的 inode，登记现有的 `entry` 一类回声（dev、ino、birthtime、ctime），不读内容；大文件提交不再为回声读全文。浏览器保存的回声保持按内容哈希。
- **列出与监视**：`.nbook-staging-` 开头的名字在列出里隐藏、监视里忽略（与现有临时文件前缀同一处）。

### 项目合同（`plugins/files/shared/contracts.ts`，版本 7）

- 新增 `stage({path, createParents?, as?})` → `{token, path}`、`commit({token, expect, createParents?, as?, group?})` → `{baseline}`、`discard({token})`。只接受服务端的 `nbook.files`（同现有 `as` 的规则，别的调用方 `permission-denied`）。
- `realPath` 加 `read: true`：按读授权给最终目标的路径（跟随链接，根外也给；目标落在控制目录为 `protected-path`），供 `readPath`。
- 文件操作（`createContent`、`rename`、`convert`、`reorder`、`display`、`include`、`drop`、`move`、`copy`、`delete`）加 `as?` 与 `group?`，规则同 `write`、`create`。
- 变更事件加可选的 `group: {id, title}`；`user://` 合同同样升到版本 7。

### 服务端：写入接口（`plugins/files/shared/workspace-files.ts` 新增；`backend/workspace-files.ts` 取代 `server-files.ts`）

- 类型、服务键 `workspaceFilesKey`（`nbook.files/workspace`）、`baselineOf` 放 `shared/workspace-files.ts`，经 `shared/contracts.ts` 再导出（跨插件导入的规则）。`ServerFiles`、`serverFilesKey` 删除，调用方只有 `nbook.agent`。
- 按调用方门面，分派与现在的 `provideServerFiles` 相同（`user://` 进程内、`projects://` 经租约与项目合同、已注册方案经登记表）；`as` 照旧只认服务端的 `nbook.agent`，另可带 `entry`。
- `read`：先 `readPath`，再在本机读（超过 32 MB 为 `too-large`），基线用 `hashOf`；不经项目合同传内容。
- `stage(address, write, options)`：取暂存（本地或 `stage` 远程调用）→ 打开暂存文件 → 调 `write(sink)`，`sink.write` 写入并更新哈希 → `fsync`、关闭 → `commit`。`write` 抛错或 `signal` 触发：`discard`，交 `io-failed` 或 `cancelled`。`commit` 得 `unknown-outcome`：取目标当前基线与暂存哈希比，相同为成功，否则原样交 `unknown-outcome`。`projects://` 的租约从 `stage` 一直持到 `commit` 或 `discard` 结束。
- `write` 是一次 `stage`；`update` 读、改、写回，`conflict` 时重做，至多 3 次。
- 文件操作：`user://` 进程内调 `operations`、`batch`；`projects://` 经项目合同带 `as`、`group`；挂载方案只有 `create`，其余 `unsupported-capability`。
- `group(info, run)`：交给 `run` 一个带组号（`randomUUID`）与标题的门面，经它的调用都带 `group`。
- 挂载方案的写入改走同一个暂存流程（放目标目录、带前缀），`mounted.ts` 的 `write` 换成 `prepare`/`commit` 两步；挂载方案不发事件、不记账，照旧。

### 记账槽（`plugins/files/shared/ledger.ts` 新增）

- 贡献点 `files.ledger`，至多一个贡献者（第二个被拒，写诊断）；服务端与项目入口都接收。
- 记账者：`record(entry: LedgerEntry, signal): Promise<void>`。`LedgerEntry` 是 `{root: "project" | "user", path, op, before: {hash, bytes | null}, after: {hash, bytes | null}, source, group}`（`op` 为 `write`、`created`、`deleted`、`renamed` 带 `from`、`copied`；内容超过 32 MB 时 `bytes` 为 null）。在提交的锁里、发事件之后调用，2 秒为限；超时、抛错、撤回都只写诊断。形状第 3 阶段接 History 时可以改（还没有第三方贡献者），所以不进 SDK。

### Agent（`plugins/agent/shared/resources.ts`、`backend/resources.ts`）

- `SessionResources` 改为 `WorkspaceFiles` 的会话绑定版加 `expand`、`classify`、`call(ctx)`：每个方法先改写地址、按第 4 条判权限，再以 `as: {agent}` 调写入接口；`call(ctx)` 交回同样的门面，`as` 另带 `entry: ctx.callId`，并包在一个以工具名为标题的 `group` 里（工具可以在 `call(ctx, {title})` 里给）。
- 内核的资源接口（`SessionEnv.resources` 的 `read` 读文本）改为 `read` 后按 UTF-8 解码。
- t08 的 `resources.test.ts` 随新方法改写；行为不变的断言不改。

### SDK（`src/sdk/files.ts`、`src/sdk/entries.ts`、`plugin-sdk/README.md`）

- 照 `/storage` 新增 `@notnotype/nb-plugin-sdk/files`（服务端与项目实例可用）：`workspaceFilesKey`、`baselineOf` 与 `WorkspaceFiles`、`StagedSink`、`CommitOptions`、`ServerFilesResult` 等类型；`sdk.test.ts` 与 `pack.test.ts` 的导出清单加这一项。README 的子路径表加一行，并加一小节“读写书里的文件”。

## Spec 与文档改动

- `workspace/resources.md`：已写 planned 条目；本计划核对代码后已改三处（结果未知的判定、挂载方案只支持读写与新建、暂存残留按 1 小时清理）。锁的那一条等开发者定（见“待确认”）。
- `agent/resources.md`：已写输出 10 与验收 6。
- 实现完成后补两份 Spec 的实现合同与证据，晋升另请开发者批准。

## 切片

1. **拥有根的暂存与提交**：`locked-replace.ts` 的 `adopt`、`staging.ts`、回声、列出与监视的前缀、启动清理；项目合同版本 7 的 `stage`、`commit`、`discard`、`realPath(read)`、文件操作的 `as` 与 `group`、事件的 `group`。验证：`files/` 的测试（真实项目子进程）。
2. **服务端写入接口**：`workspace-files.ts`、分派、`read`、`stage`、`write`、`update`、文件操作、分组、结果未知的判定、挂载方案改走暂存；删 `server-files.ts`。
3. **记账槽**。
4. **Agent 迁移**：`SessionResources`、`call(ctx)`、内核资源接口、t08 测试。
5. **SDK 子路径**与 README。
6. **收口**：`test:affected --since <起点>`、`typecheck`、`governance:check`、`docs:check`；关键规则做变异检查；实现审查（后端，omp）。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `workspace/resources.md` 验收 11 | `files/workspace-files.test.ts`（真实项目子进程）：8 MB 二进制 `stage` 与文本 `write` 逐字节一致；浏览器订阅收到带来源的事件、没有外部回声；三种期望各自成立与冲突；写入函数抛错、取消后目标不变、暂存目录无残留 |
| 验收 12 | 同上：外部改动后旧基线提交得 `conflict`；浏览器保存与写入接口提交同一文件并发恰好一次成功 |
| 验收 13 | 同上：提交发出后结束项目子进程，判定与磁盘一致 |
| 验收 14 | `files/ledger.test.ts`：测试插件贡献记账者，收到的改前改后、来源、组与实际一致；抛错与超时时提交成功且有诊断；撤回后提交照常 |
| 验收 15 | `files/workspace-files.test.ts`：挂载方案里不露出的文件取不到；根外链接给目标路径；`read` 超过 32 MB 为 `too-large` |
| 暂存的硬链接与跨盘 | 同上：硬链接数 2 的目标写后链接仍在；暂存目录与目标不同 `dev` 时（用 `/dev/shm` 或 tmpfs 上的链接目标）走目标目录、名字带前缀、列出看不到 |
| `agent/resources.md` 验收 6 | `agent/resources.test.ts`：一次调用写两个、删一个，三条事件同一会话、同一条目 id、同一组 |
| 旧行为不变 | `files/` 与 `agent/` 现有测试照旧通过（浏览器保存、文件操作、挂载方案授权与寿命） |

## 验证

- 上面的测试都用真实插件宿主与真实项目子进程；`test:affected`、`typecheck`、治理与文档检查。
- 未验证：Windows 与 macOS 上的改名与跨盘（第 4 阶段）。

## 不做与风险

- 不做：History 与账本（第 3 阶段）；监视常驻、对账兜底、回声改比 stat 的其余部分、shell 的推断归属（第 2 阶段）；浏览器保存改走暂存（行为不变，第 2 阶段统一锁时再看）。
- 风险：项目合同与 `user://` 合同升版本 7，开着的旧窗口要刷新；`as` 扩到全部文件操作，要守住“只认服务端 `nbook.files`”。

## 待确认

1. **锁的范围**（与已接受的提案有出入）。提案与 Spec 草稿写的是“一个根的全部写入共用这个根的操作锁、按到达顺序串行”。读代码发现现有设计刻意不这样做：保存只取这个文件的锁（`rooted.ts` 按真实路径哈希建锁），操作锁只在内容树里的操作取，复制大目录时也不持锁，注释写明“大目录的复制不挡住其它操作”。全部串行之后，复制一个几百 MB 的素材目录期间，编辑器的保存和 Agent 的写入都要等。
   - 推荐：第 1 阶段沿用现有的锁（提交与保存取文件锁，文件操作照现有规则取操作锁），Spec 那一条改成这样；记账要的“锁里读到真实的改前内容”只要求同一个文件的写入互斥，文件锁已经满足。第 3 阶段接账本时如果发现文件操作与提交之间要定先后，再按路径加锁，不整根串行。
   - 另一种：照提案整根串行，接受大目录复制期间写入排队。
