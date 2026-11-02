# 文件改动记账选型调研（2026-11-02）

供 t12 的文件访问架构讨论（README 的“文件访问的架构讨论”第 15–19 条）。调研子代理（Claude Sonnet）只读一手来源，本机 Bun 1.4.4、系统 git 2.56.0、Linux；GitHub 星数与推送时间来自 `gh api`，npm 版本来自 registry（当天读取）。“推断”是调研者的判断，“未查到”“未验证”是没有一手证据。实验产物留在本机 `/tmp/research-file-history/`，不入库。

## 0. nb-history 现状（基线）

- 存储：SQLite（`@libsql/client` ^0.17.4），四表 `operation_log`、`file_snapshot`、`session_cursor`、`file_acceptance`；快照主键 `sha256(原始字节)`，body 是未压缩 BLOB。
- 超过 `maxSnapshotBytes`（默认 2 MiB）或含 NUL（查整个文件）只记哈希、不存 body，之后不能 diff、不能恢复。无 delta、无压缩：100 版 30 KB 约 3.00 MB（README 实测）。
- 写路径靠进程内 Promise 队列串行，README 明说多进程同开一个库不支持；写前对账，磁盘与账面末态不一致就补一条 `external`；不含文件监视。libsql 在 Windows 上 close 后要强制 GC 释放句柄，NOTES 记着“只跑 Bun 时 `bun:sqlite` 更干净”。
- 对照需求的缺口：二进制与大文件不能恢复；多进程写；存储随版本数线性增长。

## 1. git 怎么做

- **改动检测**：index 存每个路径最近一次 `lstat` 的结果，比较时先 `lstat`，字段不同就判已修改、不读内容；同一时间戳内原地再改且大小不变（racy git）时，再比内容哈希（[racy-git.adoc](https://github.com/git/git/blob/master/Documentation/technical/racy-git.adoc)）。`core.fsmonitor` 用守护进程避免全量 `lstat`。可借鉴：保存上一版的 mtime、size、inode，不变就跳过读内容，并处理同时间戳二次写入。nb-history 现在对账要读整个文件算哈希。
- **对象存储**：新对象先是 loose（每个对象一个压缩文件、全量），`git gc` 打包时在窗口内找相似对象做 delta（`--window` 10、`--depth` 50）；超过 `core.bigFileThreshold`（默认 512 MiB）不做 delta（[git-repack](https://git-scm.com/docs/git-repack)、[gitformat-pack](https://git-scm.com/docs/gitformat-pack)）。实测（合成数据）：35.6 KB 文本 100 版、每版改 3 行，loose 3.52 MiB，`git gc` 后 159 KiB，约缩 22 倍；这是小改动的有利场景，真实小说要复测。
- **diff 算法**：myers（默认）、minimal、patience、histogram（[git-diff](https://git-scm.com/docs/git-diff)）。
- **二进制判定**：没设属性时看内容，前 8000 字节有 NUL 就输出 `Binary files differ`（`xdiff-interface.c` 的 `buffer_is_binary`）。nb-history 查整个文件。
- **textconv**：把二进制转成文本只用于显示 diff 与 log，不能用来 apply（[gitattributes](https://git-scm.com/docs/gitattributes)）。对应以后可选的 docx、pdf 文本提取，不是第一阶段需求。
- **Git LFS**：仓库里只存不到 1 KB 的指针（oid 与 size），大对象放别处；本机场景没有额外价值，nb-history 已是“内容寻址 + 记录里放哈希与大小”的形态。
- **多进程**：用 lockfile（如 `index.lock`）串行写 index 与 ref。

## 2. 复用 git 的几种方式

### 2.1 项目 `.nbook/` 下放隐藏 git 仓库，调系统 git

- 实测：`GIT_DIR` 与 `GIT_WORK_TREE` 分开时，用户的 `.git` 不会被跟踪；但隐藏仓库仍读取用户的 `.gitignore`（被忽略的文件要 `add -f` 或用 `hash-object` + `update-index` 绕过）。5000 个小文件首次 `add -A` 0.80 s，改一个后再 `add -A` 0.023 s，一次 commit 0.114 s（含进程启动）。
- 必须压住用户的全局配置（`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_NOSYSTEM=1`）与 `core.autocrlf`（否则哈希与磁盘字节不一致）。
- 覆盖：版本存储与 delta、取任意版本、文本 diff、恢复与误删找回都强；操作者四类与会话、收件箱、会话游标、保留策略（可达对象不会被 gc，裁历史要重写历史）仍要另建一个 SQLite 并与 git 保持一致（推断）。
- 风险：依赖系统 git，与外部命令行“只检测、不擅自安装”的策略冲突，没装时历史整体不可用；随产品打包 git 要履行 GPL-2.0 的分发义务（作为独立进程调用一般与 AGPL-3.0 不冲突，法律判断要开发者确认）；每次记账一次进程启动（本机 25–110 ms）。
- 封装：`simple-git` 4.0.2（MIT）；`dugite` 3.3.2（自带 git 二进制，平台说明很旧）。

### 2.2 isomorphic-git（纯 JS）

1.44.10，MIT，活跃（最近还在修亚秒级时间戳比较、index v3）。`statusMatrix` 有 stat 缓存，`dir` 与 `gitdir` 可分开。没有 gc、repack、diff，能读 delta 不能生成 delta（推断：loose 对象一直堆积，吃不到 git 最大的收益）；跨进程锁未查到；Bun 下未运行。

### 2.3 libgit2 绑定

- `nodegit`：稳定版停在 0.27.0（2020），基于 NAN；迁到 N-API 以支持 Bun 的 issue #2043 仍开放（推断：已发布的版本 Bun 下不可用）。
- `es-git`（napi-rs 包 libgit2）：0.7.0（2026-05），MIT，预编译覆盖三大平台；Bun 下是否有 CI 未查到。libgit2 是 GPL-2.0 加链接例外。

### 2.4 其它

- gitoxide：status、diff、textconv 已实现，写 pack 时还不能生成 delta；没有通用的 JS 绑定。
- Jujutsu：多数命令运行时自动把工作副本快照成提交，新增文件默认跟踪，`snapshot.max-new-file-size` 默认 1 MiB；有操作日志与 `undo`。可借鉴“外部改动一律自动成一条快照”和“新增大文件设阈值”；本身是外部二进制，不适合直接依赖。

## 3. 只复用组件

| 用途 | 候选 | 结论（推断） |
|---|---|---|
| 行 diff | `diff`（jsdiff）9.0.0，BSD-3，活跃，Myers，nb-history 在用；`fast-myers-diff` 近两年无发布；`diff-match-patch` 已归档（有 `diff-match-patch-es`、`@sanity/diff-match-patch` 移植）；histogram 没有成熟的 JS 实现 | 继续用 `diff` |
| 内容寻址存储 | 没有值得引入的独立库 | 自己写（nb-history 已有） |
| 压缩 | Bun 内置 `Bun.zstdCompressSync` | 单版本 zstd，零新依赖 |
| 跨版本 delta | `fossil-delta`、xdelta3 绑定与 WASM、`bsdiff-node`，维护都一般 | 暂缓；真要做就“每 N 版一个全量 + 中间存反向补丁” |

## 4. 文件监视

| 方案 | 现状 |
|---|---|
| `node:fs.watch`（Bun） | Linux 实测递归监视可用（深层新建、写、临时文件改名替换、删除都有事件），事件不合并，要自己批合并与回声过滤（与现状一致）。inotify 有 `max_user_watches`、`max_queued_events` 上限，溢出会丢事件；macOS FSEvents 要求收到 `MustScanSubDirs` 时全量重扫。Bun 有多条开放缺陷：Windows 递归监视看不到子目录事件（#47263）、删除被监视目录后空转（#47068）；macOS 嵌套监视丢事件（#44780、#44385）、写入方保持文件打开时不报写事件（#44051） |
| `@parcel/watcher` 2.6.0 | C++ 原生（N-API），各平台后端，事件在原生层合并，有快照与“自上次以来的变化”查询；有原生崩溃类 issue（Windows #262、macOS #271）；Bun 下安装成功、运行未验证 |
| `chokidar` 6.0.0（2026-10-19） | 纯 JS，重写为“后端回调只当失效信号，再 stat 确认后才发事件”，最终状态与文件系统一致；仍建在 `fs.watch` 上，继承 Bun 的缺陷；一年内两次大版本；Bun 下未运行 |

不论选哪个，都要保留定期全量对账兜底。

## 5. 评估与推荐

| 维度 | 继续做 nb-history | 隐藏 git（系统 git） | isomorphic-git | es-git |
|---|---|---|---|---|
| 需求覆盖 | 时间线、diff、恢复、收件箱、未见变更、保留策略都有；缺二进制与大文件恢复 | 版本、diff、恢复强；操作者、收件箱、游标、保留策略要另建 | 同左，另无 diff 与 gc | 同左，0.x |
| 多进程写 | 当前不支持；SQLite WAL 同机多进程可行，改为事务内读改写加 `busy_timeout`（推断） | lockfile，撞锁要重试（推断） | 跨进程锁未查到 | 未查 |
| 二进制与大文件 | 只记哈希；可改存全量并设上限 | 全量 blob | 无 delta 写入 | 同 git |
| 外部改动检测 | 对账读整文件，可加 stat 缓存 | 自带 stat 缓存 | 有 stat 缓存，仍在修 | 同 libgit2 |
| 实时通知 | 都不负责，另选监视器 | 同左 | 同左 | 同左 |
| 存储体积 | 无压缩无 delta，可加 zstd | gc 后约缩 22 倍（合成数据） | 无 gc 与 delta | 未查证 |
| 性能 | 单次记账 8.5–12 ms（README，Windows） | 每次一次进程，25–110 ms | 未测 | 未测 |
| 外部依赖风险 | 低 | 高（系统 git、GPL 分发） | 中 | 中高（原生模块） |

**调研者的推荐：在 nb-history 上继续做，不用隐藏 git 或 isomorphic-git 作主存储；借 git 的具体机制补缺口。** 理由：最有价值的部分（操作者、收件箱、会话游标、保留策略）git 都没有，用 git 作主存储要维护 SQLite 加 git 两套账本；隐藏 git 依赖系统 git；isomorphic-git 吃不到 git 的压缩收益；libgit2 绑定在 Bun 与 Windows 上的成熟度没有一手证据。

建议补的（推断，按优先级）：

1. 二进制与大文件可恢复：去掉“超限或二进制就不存 body”，改存全量并设上限与保留策略；判二进制借 git 的“前 8000 字节含 NUL”。
2. 存储压缩：先用 `Bun.zstdCompressSync` 做单版本压缩；跨版本 delta 暂缓，用真实小说的编辑序列复测再定。
3. 多进程写：写路径进 SQLite 事务（`BEGIN IMMEDIATE` 加 `busy_timeout`），评估换 `bun:sqlite`。
4. 外部改动检测：对账前加 stat 缓存（mtime、size、inode，处理 racy 情形）。
5. 监视器：先保留自己封装的 `fs.watch`（Linux 实测可用），Windows 与 macOS 上用 chokidar 6 或 `@parcel/watcher` 对照验证后再定；保留定期全量对账兜底。
6. 隐藏 git 只作可选的导出通道（检测到系统 git 才启用），不放主路径。

仍要验证：两个监视库在 Bun（尤其 Windows、macOS）下的实际运行；真实小说数据的压缩比；SQLite 多进程写的实际争用；许可证相容性（法律判断，交开发者确认）。
