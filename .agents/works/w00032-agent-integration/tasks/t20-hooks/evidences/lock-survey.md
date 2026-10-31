# 会话日志并发写入防护调研报告

调研对象：Claude Code、OpenAI Codex CLI、omp（oh-my-pi / pi-coding-agent）、opencode、Gemini CLI，以及可选的 pi-mono、Aider、Cline。
调研日期：2026-10-31。源码在 `/tmp/lock-survey/src/` 下浅克隆（`--depth 1`），下文行号以这些克隆为准。

核心问题：同一会话的日志被两个进程同时写入，各家怎么防。

---

## 1. OpenAI Codex CLI

源码：`/tmp/lock-survey/src/codex`（commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`，2026-10-31 克隆）。

**存放位置与格式**：会话 rollout 存在 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<时间>-<thread id>.jsonl`（`codex-rs/rollout/src/lib.rs:86` 定义 `SESSIONS_SUBDIR = "sessions"`；本机 `~/.codex/sessions` 下实际有 9 个 `.jsonl`）。格式是 JSONL，每行一个带 `timestamp`、可选 `ordinal` 的 `RolloutItem`（`codex-rs/rollout/src/recorder.rs:2140-2150` 的 `RolloutLineRef`）。另有 `state_db`（SQLite，`codex-rs/rollout/src/state_db.rs`）作为索引，不是会话正文。

**写入方式**：追加。`open_rollout_for_append` 用 `OpenOptions::new().read(true).append(true).open(...)`（`codex-rs/rollout/src/recorder.rs:2082-2105`，新会话的 `open_log_file` 在 `recorder.rs:1804-1808`）。每条记录是一次 `write_all(json + "\n")` 后 `flush`（`recorder.rs:2156-2161`）。写入由后台 `RolloutWriterTask` 串行完成（`recorder.rs:1031-1036` 的注释）。没有 fsync 的显式调用（本次只看了写入路径，未逐行核对是否有 sync，标注为“未核实”）。

**防并发写的机制：分两层。**

1. **普通会话的写入不加锁。** 正常的 `RolloutRecorder::new`（`recorder.rs:904-911`）调用 `new_inner(..., None)`，writer_lock 为 `None`，文件只靠 `O_APPEND` 追加。`codex-rs` 里对 `WriterLockCoordinator::acquire` 的调用只有一处：`codex-rs/app-server/src/request_processors/thread_goal_user_context.rs:23`（写“用户目标”到**未加载**的线程 rollout）。如果线程已在本进程加载（`thread_manager.get_thread` 成功），走的是内存里的线程，不走文件（同文件 `:14-19`）。所以“两个进程同时对同一个会话跑 agent”在 Codex 里**没有文件级互斥**。

2. **写者锁（只给“文件外”的写入路径用）。** `codex-rs/rollout/src/writer_lock.rs`：
   - 锁文件：`$CODEX_HOME/thread-writer-locks/<thread-id>.lock`（`writer_lock.rs:19` 的 `WRITER_LOCK_DIR`）。
   - 锁类型：Rust 标准库 `File::try_lock()`（`writer_lock.rs:67`），在 Unix 上是 `flock(LOCK_EX|LOCK_NB)`，在 Windows 上是 `LockFileEx`。这是内核建议锁，进程退出时由内核释放，不靠 pid 文件。
   - 协调锁：`.coordination.lock`（`writer_lock.rs:20`），同样用 `try_lock`，循环重试 30 秒（`writer_lock.rs:110-135`），用来串行化“取写者锁”“删除陈旧锁”“压缩发布”三类操作。
   - 陈旧锁：`remove_stale_thread_locks`（`writer_lock.rs:137-185`）每个 coordinator 只在第一次 `acquire` 时扫一遍目录，对能拿到 `try_lock` 的锁文件直接删掉（说明：拿得到锁就等于持有者已死，因为活着的持有者会一直持有 flock）。`Drop`（`writer_lock.rs:187-210`）里先关句柄再删文件，注释写明是为了 Windows。
   - 压缩发布：`compression.rs:927-934` 的 `try_acquire_for_publication` 在把 rollout 压缩替换原文件前取写者锁，拿不到就返回 `SkippedBusy`。

**同一会话被第二个进程打开时**：
- 两个进程都以 `O_APPEND` 打开同一个 rollout 时，Codex 不会报错；两边各自追加，行会交错。`O_APPEND` 保证每次 `write` 的写入位置是原子的到文件末尾，所以单条 `write_all` 通常不会和另一条撕裂，但会出现两条会话的记录交替（推断，未在多进程下实测）。
- 只有 goal 写入这条路径会因为 `try_lock` 失败而报 `WouldBlock`（`writer_lock.rs:67-72`，错误文案 “already has an active writer”）。

**崩溃后的陈旧锁**：内核 flock 随进程退出释放，不会遗留；`remove_stale_thread_locks` 只是清理锁文件本身。

**依据**：`writer_lock.rs` 全文、`recorder.rs:904-1036, 1804, 2082-2105, 2156-2161`、`thread_goal_user_context.rs:14-40`、`compression.rs:100-112, 915-935`。

另外 `codex-rs/app-server-daemon` 有自己的 `flock` 锁（`lib.rs:1241-1257`，`backend/pid.rs:669-721`），保护的是 daemon 实例（pid 文件与操作锁），与会话日志无关。

---

## 2. omp（oh-my-pi / pi-coding-agent）

源码：`/tmp/lock-survey/src/oh-my-pi`（commit `c29f7c56f`，2026-10-31，版本 18.14.1）；本机安装的是 18.12.3（`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js`）。下面的结论以源码为准，已用安装包核对了“发布锁”与“open-elsewhere”两段逻辑存在，但没有逐行核对“会话租约”的 Linux 实现在 18.12.3 里是否一致（标为推断）。

**存放位置与格式**：`~/.omp/agent/sessions/<cwd 编码目录>/<时间戳>_<session id>.jsonl`，本机共 39 个 `.jsonl`。JSONL，首行可能是固定宽度的 `title` 槽（`{"type":"title",...,"pad":...}`），随后是 `{"type":"session","version":3,"id":...}` 头，之后每行一个条目。`docs/session.md` 是数据模型的正文。

**写入方式**：两种。
- 追加：以 `O_WRONLY|O_CREAT|O_APPEND` 打开，通过已打开的描述符写一行（`src/session/session-storage.ts:27, 327, 356`）。注释写明“没有 fsync”（`docs/session.md:531`）。
- 整文件改写：先写到同目录的 `.<name>.<16 位十六进制>.tmp`，再 `rename` 覆盖（`session-storage.ts:33-36`，`:46-48`，`replaceSessionFileSync` 在 `:1328-1342`）。整文件改写只用于标题、回滚、压缩等少数路径。

**防并发写的机制：三层，全部是“进程级 OS 锁”，不靠 pid 文件。**

1. **会话租约（session lease），管“谁拥有这个会话”。** 键是会话 id（来自文件头），不是路径（`session-storage.ts:620` 起的 `sessionLeasePath`）。锁的实现是 `pi-utils` 的 `tryAcquireFileLock`（`packages/utils/src/file-lock.ts:37-45`），底层是 `pi-natives` 的 `FileLock`：
   - Linux：抽象 Unix 域套接字的 `bind`（`crates/pi-natives/src/file_lock/linux.rs:10-21`），进程退出后内核释放，不落盘。
   - Windows：命名互斥体（`windows.rs`，未逐行读）。
   - 其它 Unix（macOS 等）：`flock(LOCK_EX|LOCK_NB)` 作用在 `~/.omp/run/session-owners/<id>` 侧车文件上（`crates/pi-natives/src/file_lock/unix.rs:10-25`，`session-storage.ts:625-641`）。
   - 只有写路径才申请租约（`session-manager.ts:1117-1128` 的 `#claimSession`），查看（`omp share`、`--export`、`render`）不申请。
   - `docs/session.md:546-550` 有同样的描述。

2. **发布锁（publish lock），管“改名覆盖”与“追加”的互斥。** 同目录的 `.<文件名>.lock`（`session-storage.ts:746-748`），内容是 `pid:时间`，属于旧版协议。外面再套一层进程级 OS 门（`.<文件名>.lock.os`，`#withPublishLock` 在 `:756-770`，`#osGatePath` 在 `:863`，注释写明“不能删，否则 flock 会分裂”）。拿不到时在 500 毫秒内轮询，超时抛 `SessionLockError`（`:131-140`；`#acquireOsPublishLock` 在 `:842`，`#acquirePublishLock` 在 `:867`）。陈旧锁由 `#stealStalePublishLock` 处理（`#stealStalePublishLock` 在 `:946`，依据 pid 是否存活，`isPidAlive` 在 `:536`）。

3. **非持有者不写。** `#sessionOwnedElsewhere()`（`session-manager.ts:1137-1143`）发现会话被别的 omp 进程持有时，下一次写入不写原文件，而是把本会话“搬”到一个新 id 的兄弟会话（`#moveOffSessionFile("open-elsewhere")`，`session-manager.ts:1658, 1790, 1909, 1981`）。注释原话：“two processes never mix their entries in one journal”（`:1131-1133`）。

**同一会话被第二个进程打开时**：
- 第二个进程若要写，就分叉到兄弟会话（新 id），原会话的文件保持只归第一个进程写。
- 查看类操作不受影响，也不抢租约。
- 改标题这类“就地修改”的操作，若拿不到租约直接返回空（`session-manager.ts:3478-3480`，`renameSessionTitle`）。
- 较新的源码（18.14.1）在选择器里对重命名直接报错 “it is currently in use by another omp process”（`src/modes/controllers/selector-controller.ts:1851-1858`）。18.12.3 的 cli.js 里没有这句，所以安装版行为可能不同（未核实）。
- 额外的探测：`omp session lease --json -- <id>` 和 RPC `get_session_lease` 不取锁地查看租约（`session-storage.ts:650-690`，`docs/rpc.md:233`）。

**崩溃后的陈旧锁**：
- 租约：内核在进程退出（包括 SIGKILL）时自动释放，不存在陈旧租约。
- 发布锁的 pid 文件：有 pid 存活检查，死掉的 pid 可以被接管（`session-storage.ts:529-545, 880`）。
- 侧车文件 `.os` 与 `session-owners/<id>` 故意保留，不删除（`:620-641`）。

**依据**：`session-storage.ts` 的行号见上；`packages/utils/src/file-lock.ts`；`crates/pi-natives/src/file_lock/{unix,linux}.rs`；`session-manager.ts:1117-1143, 1658, 1790, 3478`；`docs/session.md:531, 546-550`；安装包 `dist/cli.js` 中可以搜到 `another writer holds the publish lock`、`open-elsewhere`、`session-owners`。

---

## 3. Claude Code

源码：闭源。本机版本 2.1.314，二进制 `/home/notnotype/.local/share/claude/versions/2.1.314`（Bun 编译的 ELF，约 298 MB，JS 被压缩在内）。依据只有文档与对二进制的字符串搜索。

**存放位置与格式**：`~/.claude/projects/<项目目录名>/<session-id>.jsonl`，JSONL（官方文档 https://code.claude.com/docs/en/sessions ，“Where transcripts are stored”一节）。本机 435 个 `.jsonl`，`projects` 下未见任何 `*.lock` 文件。

**写入方式**：追加（文档未写明；二进制里 `appendFileSync` 出现 17 次、`O_APPEND` 出现 15 次，但没能定位到转录写入函数，标为“推断为追加”）。

**防并发写的机制**：
- 转录文件本身没有锁。二进制中找不到 `session.lock`、`sessionLock`、`session-lock` 等字符串（固定字符串计数均为 0）。
- 有一个进程登记表：`~/.claude/sessions/<pid>.json`，本机 24 个文件，内容包含 `pid`、`sessionId`、`cwd`、`kind`、`startedAt`、`procStart` 等字段（例：`~/.claude/sessions/1280331.json`）。它记录“哪个进程正在跑哪个会话”，用于后台会话的发现；不是对转录文件的互斥。
- 二进制里“in use by live session”的字样出现在插件缓存的孤儿清理与重链逻辑中，与会话转录无关。

**同一会话被第二个进程打开时**：官方文档原文：“If you resume the same session in two terminals without forking, messages from both interleave into one transcript.”（同上 URL，“Branch a session”一节）。即两个终端 `--resume` 同一会话不会被拒绝，两边消息会交错写进同一个 JSONL。避免的办法是 `--fork-session`。
- 例外：对**后台会话**，`claude --resume <session>` 会改为 attach 到正在运行的那个进程，而不是另开一份加载（文档 “Resume a running background session”，v2.1.285 起；早于此版本时会拒绝并提示 `claude attach`）。这是“按进程登记表转发”，不是文件锁。
- 第三方反馈：GitHub issue “claude --resume allows concurrent access to same session from multiple terminals”（https://claudeissues.com/issue/39151-claude-resume-allows-concurrent-access-to-same-session-from-multiple-terminals）；另一条 issue 指出 `--continue`/`--resume` 不检查已存在的 live 会话登记（https://claudeissues.com/issue/69364-continue-resume-doesnt-check-the-existing-live-session-registry-before-re-openin）。这两条是搜索摘要中的信息，未逐条打开核实。

**崩溃后的陈旧锁**：不适用（没有转录锁）。文档说明中断的工具调用恢复时不会重跑（同一文档 “What a resumed session restores”）。

**依据**：官方文档 https://code.claude.com/docs/en/sessions（已用 WebFetch 核对上述原文）；本机 `~/.claude/sessions/*.json`；二进制字符串搜索（`/usr/bin/grep -a -c -F`）。

---

## 4. opencode

源码：`/tmp/lock-survey/src/opencode`（commit `2d800e4742531957ed6cf536a909837f7ec805e1`，2026-10-30）。

**存放位置与格式**：SQLite 数据库，经 Drizzle + Effect 访问（`packages/core/src/database/database.ts`；会话表定义在 `packages/core/src/session/sql.ts`）。数据库文件放在 Global data 目录下；迁移代码里出现的文件名是 `opencode-next.db`（`packages/core/src/database/v1-migration.bun.ts:802`），是否为当前主库名未核实。

**写入方式**：SQLite 事务写入（WAL 模式，见下）。不是 JSONL，也不整文件重写。

**防并发写的机制**：
- 数据库连接参数：`PRAGMA journal_mode = WAL`、`synchronous = NORMAL`、`busy_timeout = 5000`（`database.ts:40-42`）。跨进程互斥由 SQLite 自己的文件锁完成，等待上限 5 秒。
- 进程内：`lockFor(filename)` 按文件路径给出一个 `Semaphore(1)`（`database.ts:57-70`），只用于“同一进程内两个实例同时做迁移与建表”（注释写明）。
- 会话级：`packages/core/src/session/run-coordinator.ts` 是按 key（会话）串行执行的协调器，接口注释描述的是“同一 key 同时只有一个执行”；从接口看是进程内的（推断，未读实现）。没有找到跨进程的会话所有权记录。
- `packages/util/src/effect-flock.ts` 是另一套 mkdir 锁（原子 `mkdir` 建锁目录，心跳与 `staleMs` 默认 60 秒判陈旧，`:123-240`），它用在凭据刷新（`packages/core/src/credential.ts:106`）和仓库缓存（`packages/core/src/repository-cache.ts:120-133`），不用于会话。

**同一会话被第二个进程打开时**：两个进程都能打开同一个 SQLite 库；写事务靠 SQLite 锁串行，写冲突时最多等 5 秒后报 `SQLITE_BUSY`。没有找到“会话只能被一个进程 resume”的检查（未找到）。

**崩溃后的陈旧锁**：SQLite 的锁随进程退出释放（WAL 的 `-shm`/`-wal` 由 SQLite 处理）。`effect-flock` 的 mkdir 锁靠心跳与 `staleMs` 判陈旧，但它不管会话日志。

**依据**：`database.ts:33-47, 57-70, 81-100`；`session/sql.ts`；`util/src/effect-flock.ts`。

---

## 5. Gemini CLI

源码：`/tmp/lock-survey/src/gemini-cli`（commit `6814e00d6b148c3a1d57244d5d7040f7c541009d`，2026-10-30）。

**存放位置与格式**：`packages/core/src/services/chatRecordingService.ts`。会话文件名前缀为 `session-`，后缀 `.jsonl`（旧的 `.json` 会被改成 `.jsonl`，`:732-733`）。JSONL，每行一条记录，首行是会话元数据（`:805-820` 生成文件名，`:949` 追加）。

**写入方式**：两种。
- 追加：`fs.appendFileSync(this.conversationFile, line)`（`chatRecordingService.ts:949`）。
- 整文件改写：`rewriteConversationFile` 写临时文件后 `fs.renameSync` 覆盖（`:963-1009`，注释写明“temp file + rename”）。

**防并发写的机制**：会话文件没有锁。`chatRecordingService.ts` 中搜不到 `lock`、`flock`、`O_EXCL`。`doInitialize` 对恢复的会话只读取文件并继续写（`:713-725`），不检查是否已有别的进程在写。
- 唯一用 `O_CREAT|O_EXCL` 的是记忆提取任务：`packages/core/src/services/memoryService.ts:417-440` 的 `tryAcquireLock`，锁文件 `.extraction.lock`（`:48`），内容是 pid 与时间，陈旧判断见 `isLockStale`（`:440` 起，pid 存活检查），调用点 `:1146`、`:1478`。它只保护记忆提取，不保护会话。
- `packages/core/src/config/projectRegistry.ts` 用 `proper-lockfile` 保护项目注册表（`:11`、`:189`）。

**同一会话被第二个进程打开时**：没有检查，两个进程都会追加到同一个 JSONL；整文件改写的那一方会覆盖另一方在 rename 之前的追加（推断，未实测）。

**崩溃后的陈旧锁**：会话文件无锁，不适用。记忆锁靠 pid 存活检查清理陈旧锁。

**依据**：`chatRecordingService.ts:713-725, 732-733, 805-820, 949, 963-1009`；`memoryService.ts:48, 417-440, 1146`。

---

## 6. pi-mono（omp 的上游）

源码：`/tmp/lock-survey/src/pi-mono`（commit `35dfa757378bd7a8570670e99c2687bdd1039a06`，2026-10-30）。

- **存放位置**：`~/.pi/agent/sessions/<cwd 编码目录>/`（`packages/coding-agent/src/core/session-manager.ts:587-593`），JSONL。
- **写入方式**：`appendFileSync`（`session-manager.ts:668` 等处）；无原子改名的整文件改写路径未细查。
- **防并发写**：`session-manager.ts` 中搜不到 `lock`、`flock`、`O_EXCL`。会话文件无锁。`settings-manager.ts` 用 `proper-lockfile` 的 `lockSync`（`:7`、`:197-221`）保护设置文件，与会话无关。
- **同一会话被第二个进程打开**：无检查（推断，与 omp 的租约设计对照：omp 的租约正是在上游之后加上的，见第 2 节）。
- **依据**：上述行号。注：omp 第 2 节的设计是在 pi-mono 之上的改进，不能直接看作 pi-mono 的行为。

---

## 7. Aider

源码：`/tmp/lock-survey/src/aider`（浅克隆，未记 commit）。

- **存放位置与格式**：聊天记录是 Markdown 文本，默认文件名 `.aider.chat.history.md`（默认名未逐行核实）。
- **写入方式**：每次写入都用 `self.chat_history_file.open("a", ...)` 打开、写入、关闭（`aider/aider/io.py:1117` 起的 `append_chat_history`，内部 `with ... open("a")`）。
- **防并发写**：全仓库 `aider/**/*.py` 中搜不到 `flock`、`lockfile`、`fcntl`、`O_EXCL`、`.lock`（只有 `Gemfile.lock` 之类的文件名白名单）。不防。
- **同一会话被第二个进程打开**：Aider 没有“会话”的概念，两个进程写同一目录的历史文件会交错追加（推断）。
- **陈旧锁**：不适用。
- **依据**：`aider/aider/io.py:1117-1135`（函数体内 `open("a")`）；全仓库 grep 结果。

---

## 8. Cline

源码：`/tmp/lock-survey/src/cline`（commit `a6507a62a147db4a35e27f4294589742ccac5060`，2026-10-30）。源码主体在 `apps/vscode/src`。

- **存放位置与格式**：每个任务一个目录，内含 `ui_messages.json`、`api_conversation_history.json`（`apps/vscode/src/sdk/legacy-state-reader.ts:57-59`；`apps/vscode/src/dev/commands/tasks.ts:96, 119`）。JSON，不是 JSONL。
- **写入方式**：`fs.writeFile` 整文件写（`apps/vscode/src/dev/commands/tasks.ts:119`）；任务主持久化路径未逐行核实，标为未核实。
- **任务文件的防并发写**：未找到。`apps/vscode/src/core/storage/disk.ts` 中是普通 `fs.writeFile`（`:141, 180, 226, 251`），没有锁。
- **另有两种锁，作用对象不是任务日志**：
  1. `apps/vscode/src/core/locks/SqliteLockManager.ts` 用 `O_EXCL` 建 `${dbPath}.lock`（`:38-70`，`fs.openSync(lockFile, "wx")`），内容是时间戳，用于串行化数据库的创建与初始化；陈旧锁的清理在 `cleanupStaleLockSync`（`:90` 起，超时常量 `STALE_LOCK_TIMEOUT` 为 1 分钟，`:9`），冲突时带抖动重试。
  2. 同一文件里的 SQLite `locks` 表，`lock_type = 'folder'`，`INSERT OR IGNORE` 登记文件夹级锁（`:224-240`），持有者是实例（`instanceOwner`），用 `touchInstance` 心跳（`:157`），`cleanupOrphanedFolderLocks`（`:250`）清理孤儿锁。它锁的是工作区文件夹，不是会话日志。
- **同一会话被第二个进程打开**：未找到检查（未核实）。
- **依据**：`SqliteLockManager.ts:9, 38-70, 90, 157, 224-250`；`disk.ts:141-251`；`dev/commands/tasks.ts:96-119`。

---

## 9. 技术问题：打开文件本身会不会阻止另一个进程写同一个文件

结论：**在 Linux 和 macOS 上不会。在 Windows 上，取决于共享模式；Node、libuv 和 Rust 标准库的默认共享模式不阻止并发写。**

**POSIX（Linux、macOS）**
- `open(2)` 本身不加任何锁。两个进程都可以用读写模式打开同一个文件并写入。
- `write(2)` 的 O_APPEND 语义：POSIX 规定，设置了 O_APPEND 时，文件偏移在每次写之前设为文件末尾，“no intervening file modification operation shall occur between changing the file offset and the write operation”（https://pubs.opengroup.org/onlinepubs/9699919799/functions/write.html）。这保证的是“每次 write 写到当时的末尾”，并不保证多次写之间不交错。
- `flock(2)` 的手册原文：“flock() places advisory locks only; given suitable permissions on a file, a process is free to ignore the use of flock() and perform I/O on the file.”（https://man7.org/linux/man-pages/man2/flock.2.html）。即互斥只对主动调用 flock 的进程有效。
- Linux 的强制锁（mandatory locking）在现代内核上默认不生效；本次未专门查证其弃用时间线，只做此表述。

**Windows**
- `CreateFile` 的共享模式：`FILE_SHARE_WRITE` 的说明原文是 “Enables subsequent open operations on a file or device to request write access. Otherwise, no process can open the file or device if it requests write access.”（https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew）。即第一次打开如果没有给 `FILE_SHARE_WRITE`，第二次请求写访问的打开会失败（`ERROR_SHARING_VIOLATION`）。这是真正会“靠打开文件来阻止”的机制，但需要第一个打开者主动设置共享模式。
- libuv（Node.js 的 `fs.open` 底层）：`src/win/fs.c:512` 默认 `share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`；仅当内部标志 `UV_FS_O_EXLOCK` 时 `share = 0`（`:505-512`，注释写明“We indiscriminately use all the sharing modes, to match UNIX semantics”）。所以普通的 Node `fs.open` 不会阻止别的进程写同一文件。`UV_FS_O_EXLOCK` 是否在 Node 的 `fs.constants` 里对外暴露，未核实。
- Rust 标准库：`library/std/src/sys/fs/windows.rs:220` 默认 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`，也不阻止并发写。
- Bun：本次未能取到 Bun 的 Windows fs 源码（`oven-sh/bun` 的 `src/sys.zig` 原始地址返回 404），未核实其默认共享模式。若要依赖它，需要在 Windows 上做实验。
- Windows 的 `LockFileEx`（Rust 文档写明 `try_lock` 在 Windows 上对应 `LockFileEx` 加 `LOCKFILE_EXCLUSIVE_LOCK`，`library/std/src/fs.rs:844-847`）是字节范围锁，对被锁区域的其他句柄的读写是强制生效的（不同于 Linux 的 flock 咨询锁）。因此把互斥锁放在独立的 `session.lock` 上，而不是锁住 JSONL 数据文件本身，可以避免阻塞读取方。

**对本项目的含义（推断，供参考）**：在 Linux、macOS、Windows 上，单纯“打开 JSONL”都不能互斥；需要显式的锁。选项是：(a) 对 `session.lock` 加 flock 或 LockFileEx（进程退出自动释放，适合当前设计）；(b) O_EXCL 建锁文件并写 pid，需要自己做陈旧判断（Gemini、Cline、omp 的发布锁都是这种，omp 为此又加了 OS 门）；(c) Windows 上对数据文件用共享模式 0，互斥的同时也会挡住读取方，代价较大。

---

## 10. 跨项目对比（结论）

| 项目 | 会话存储 | 写入方式 | 会话级互斥 | 同会话第二进程 | 陈旧锁 |
| --- | --- | --- | --- | --- | --- |
| Codex | JSONL（rollout） | 追加（O_APPEND） | 普通会话无锁；仅 goal 写入与压缩发布加 flock/LockFileEx 写者锁 | 两边交错追加（推断） | 内核释放，另清理锁文件 |
| omp | JSONL | 追加 + 临时文件改名 | 有：会话租约（abstract socket / 命名互斥 / flock），加发布锁（O_EXCL 式锁文件 + OS 门） | 第二进程分叉到兄弟会话，不写原文件 | 租约由内核释放；发布锁用 pid 存活检查 |
| Claude Code | JSONL | 追加（推断） | 无转录锁；进程登记表 `~/.claude/sessions/<pid>.json` 用于后台会话转发 | 官方：两边消息交错写进同一文件；后台会话则 attach | 不适用 |
| opencode | SQLite（WAL） | 事务 | SQLite 自身锁 + busy_timeout 5 秒；进程内 Semaphore | SQLite 串行，无会话所有权检查 | SQLite 释放 |
| Gemini CLI | JSONL | 追加（appendFileSync）+ 整文件改名 | 无；只有记忆提取用 O_EXCL 锁文件 | 无检查，交错追加（推断） | 记忆锁按 pid 判陈旧 |
| pi-mono | JSONL | 追加 | 无（会话）；设置文件用 proper-lockfile | 无检查（推断） | 不适用 |
| Aider | Markdown 追加 | open("a") | 无 | 交错追加（推断） | 不适用 |
| Cline | JSON 文件；SQLite | 整文件 writeFile；SQLite 表 | 无（任务文件）；SQLite 文件夹锁与 O_EXCL 初始化锁 | 未找到检查 | O_EXCL 锁 1 分钟超时；SQLite 表心跳清理 |

**与本项目设计的关系**：omp 是最接近我们方案的：它把“会话所有权”做成按会话 id 的 OS 锁（不靠 pid 文件），并在第二进程写入时分叉而不是混写。Codex 证明了“按线程的 flock 写者锁”可行，但它只用在旁路写入上。Claude Code、Gemini、pi-mono、Aider 基本都不防，交错写入是已知结果（Claude Code 官方文档承认）。

---

## 11. 未完成与未核实

- Claude Code 的转录写入函数未能在二进制中定位（字符串搜索成本过高，未深挖）。
- Bun 的 Windows fs 默认共享模式未核实。
- opencode 的 `run-coordinator.ts` 是否纯内存，只从接口推断。
- omp 的 Windows 命名互斥与 18.12.3（安装版）的 Linux 租约实现未逐行核对（以 18.14.1 源码为准）。
- Cline 任务主写入路径未逐行核实。
- 所有“同会话第二进程交错写”的结论都是读源码推断，没有做多进程实测。
