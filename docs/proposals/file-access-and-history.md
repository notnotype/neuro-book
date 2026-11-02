---
schema: nbook.proposal/v1
status: draft
created: 2026-11-02
decided: null
supersedes: []
superseded-by: null
specs:
  - docs/specs/workspace/resources.md
  - docs/specs/workspace/files.md
  - docs/specs/workspace/folder-kinds.md
  - docs/specs/runtime/projects.md
  - docs/specs/agent/resources.md
adrs: []
---

# 文件访问与改动记账

- 来源：w00032 t12（Agent 的基础工具）设计审查时发现 nbook.files 的读写接口不够服务端使用方用，开发者 2026-11-02 提出改为照 git 的思路记账。讨论、调研、深入审查与三种写入方案的评估见 [t12 README](../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/README.md) 的“文件访问的架构讨论”、[file-history.md](../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/research/file-history.md)、[vscode-save.md](../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/research/vscode-save.md) 与该 Task 的 `evidences/`。
- 与既有提案的关系：改 [项目文件底座与 Files 竖切](project-file-foundation.md)（accepted）里“读写、列出、glob、grep、监视都经文件服务”这一条：读改为拿到本机路径后自己读，写仍只有文件服务一个入口，但由写入方先写好临时文件、拥有根的进程提交。该提案的其余决定（URI 方案、三类文件夹、带来源的变更事件、History 是默认启用但非启动必需的插件）不变。

## 问题

1. **nbook.files 的读写接口只适合浏览器编辑一个文档。** 读一次交整份 UTF-8 文本、写一次收整份文本，有约 960 KiB 的正文上限，不能读写字节、不能分页、不能流式。服务端的使用方都用不上：
   - 作品统计要扫几千个文件，经 Files 读太重，已经改为订阅变更事件、直接读项目目录（`plugins/projects/project/stats-tracker.ts` 的注释）；
   - Agent 的 `read` 要分页读大文件、读图片字节，`grep`、`glob`、`shell` 要真实路径；`shell` 的全文日志可到几十 MB；
   - 以后的图生文插件要把生成的图片存进书里，导入、导出要写大文件与二进制。
2. **“所有访问都经文件服务”做不到。** shell、外部编辑器、`git checkout` 都直接写磁盘。
3. **但要知道谁改了什么。** 用户（经网页）、Agent 会话、插件、外部工具改了哪个文件、改成什么，审查收件箱、每轮改动文件、旧版本与恢复都靠它（w00032 t13）；网页的文件资源管理器要实时看到变化。

## 目标与非目标

目标：

- 服务端使用方拿到本机路径后自己读，没有大小与格式限制；
- 写只有一个入口：写入方把新内容写进临时文件（流式、任意大小），再请拥有根的进程提交；提交在锁里拿到真实的改前内容，算出改动、记下操作者，与落盘一致；
- 不经接口的外部改动由文件监视发现，由账本用保存的上一版算出改动，记为外部（Agent 的 `shell` 执行期间的改动归给该会话、标“推断”）；
- 网页的文件资源管理器与编辑器照旧实时收到变更事件；
- History 仍是可选插件：它不在、出错时文件读写照常；
- 不引入系统 git 等外部依赖。

非目标：

- 安全边界：记账只对守约的写入方成立（[ADR 0027](../adr/0027-builtin-and-third-party-plugins-are-equal.md)），不防恶意插件；
- 浏览器直接读写新方案（随对话界面另定）；
- 跨版本的差异压缩（先做单版本压缩，真实数据复测后再定）；
- 外部改名的精确识别（照 git，看时间线时按内容相似度接起来）。

## 当前行为与证据

| 使用方 | 现状 |
|---|---|
| 编辑器（浏览器） | 经 RPC 读整份文本、按基线条件保存（由项目子进程执行）；超过约 960 KiB 按 Spec 不在文本编辑器打开 |
| 文件树（浏览器） | 列目录与文件操作（新建、改名、移动、复制、删除），由项目子进程执行，不读内容 |
| Markdown、HTML 预览（浏览器） | 字节经 nbook.files 的 HTTP 字节路由 |
| 作品统计（项目子进程） | 订阅变更事件，直接读项目目录 |
| Agent（服务端，t08） | 资源视图经服务端文件服务读写，受整份文本与 960 KiB 的限制 |

不经 nbook.files 的应用数据（Storage 的 SQLite、设置文件、项目身份与登记表、Agent 会话日志、用户 Profile 的打包）各管各的根与写入策略，不在本提案范围。

现有的文件监视（`changes.ts`）：`fs.watch` 递归监视根目录、攒 75 ms 一批、每个路径 `lstat` 一次，报“修改”或“删除”；只有文件服务自己刚写过的路径才读内容算哈希，用来认出自己的回声。

[nb-history](../../packages/nb-history/README.md) 已经实现账本的大半（代写并记账、只补记账、观察型记账、对账、时间线、diff、恢复、误删找回、审查收件箱、会话未见变更、保留策略），还没接进新应用；限制是单进程单写者、二进制与超过 2 MB 只记哈希、没有压缩。

实测（2026-11-02，本机 Linux）：

- 服务端经 `{project}` 目标调项目实例的空载荷方法，p50 0.30–0.38 ms，p99 1.9–2.4 ms；
- 三种写入方案的每次保存读写量是同一量级（15 到 154 KB 的章节，3 到 4 ms，账本另外约 100 KB 的 SQLite 页放大）；“临时文件 + 刷盘 + 改名”比就地写多约 1.5 ms；
- 就地写的大文件在写入中途被监视读到半截（6 MB 慢速写入，80 次回调里 75 次读到半截）；临时文件加改名永远读到完整版本；
- 中文文本 zstd 压缩后约为原文的 50% 到 60%。

VS Code 保存时整份就地写（截断后写入），不做原子替换，靠“修改时间 + 大小”认出自己的保存；它不记账，读到半截文件只影响一次重载，我们要按内容记账，所以经接口的写入用原子替换。

## 方案

### 职责划分

| 部件 | 负责 |
|---|---|
| **nbook.files** | 地址：方案注册、挂载方案、地址与本机路径的换算（按方案的读授权）；写入的唯一入口：提交暂存的内容、文件操作（新建、删除、移动、复制、清单），都在拥有根的进程里、锁里执行；文件监视：检测哪些路径变了，推给浏览器，转告记账；浏览器的读写入口（现有 RPC，不变） |
| **写入接口**（nbook.files 交给服务端插件的按调用方服务） | 暂存与提交、文件操作、取本机读路径；操作者由内核签发的调用方身份决定 |
| **记账**（`nbook.history` 插件，用 nb-history 包） | 每个根一份账本：操作者、改动、每个版本的内容；时间线、diff、恢复、收件箱、会话未见变更。它向 nbook.files 登记一个记账回调；没装、出错或超时，文件读写照常，写诊断 |

### 一次写入（经接口）

以服务端的 Agent 改 `projects://book/第三章.md` 为例：

1. **暂存**：写入方经接口取得这本书 `.nbook/staging/` 下的一个暂存文件，在本机写入新内容（可以流式、任意大小、不持锁）。`.nbook/` 是控制目录，文件监视本来就不看它，暂存文件不会出现在文件树里。
2. **提交**：写入方调一次 `commit`，参数只有暂存文件、目标地址与期望（基线、“必须不存在”或“不论现状”），约 200 字节；项目文件经一次 RPC 交给项目子进程，`user://` 在服务端本进程内。
3. **拥有根的进程在锁里**：
   1. 核对期望，不符为 `conflict`，暂存文件删掉；
   2. 读出改前内容；与账面末态不一致时（中间有外部改动），先请记账补一条外部记录；
   3. 改名替换（原子）；
   4. 请记账记下这一次（操作者、改前与改后内容、改动）；记账失败不撤回落盘，只写诊断（之后对账记为外部）；
   5. 登记回声（新文件的 inode、修改时间、大小），以真实来源发出变更事件；
   6. 放锁，把新基线交回写入方。
4. 结果不确定（RPC 得 `unknown-outcome`）时，写入方比对目标的当前基线与自己暂存内容的哈希即可知是否提交；暂存文件还在就是没提交。

改动在锁里、在同一个进程里、用真实的改前内容算出，与落盘一致；没有跨进程的“先记账再改名”，也就没有要撤回的假版本。改名之后、记账之前进程崩溃时，下次对账记为外部：历史不断链，只丢操作者。

**文件操作**（新建、删除、移动、复制、内容文件夹的清单）同样在拥有根的进程里执行，执行后请记账记下。

**锁**：一个根里的全部写入（提交与文件操作）共用这个根的操作锁（现有 `operations.lock`，跨进程），在拥有根的进程里排队执行。一本书的写入频率很低，单次在毫秒级，串行不构成瓶颈；换来的是文件锁与目录锁不再分两把、不必定锁的先后。

**硬链接与链接目标**：目标的硬链接数大于 1 时，改名替换会断开链接；这种文件改为在锁里就地写（文件监视等锁放了再看，读不到半截）。目标的真实目录与 `.nbook/` 不在同一个文件系统（用户的链接指向别的盘）时不能跨盘改名，暂存文件改放在目标目录下、用固定的隐藏名前缀，文件监视按前缀忽略。

### 读

`readPath(地址)` 交回本机路径，按方案的读授权核对（挂载方案里不露出的文件取不到，用户自己建的链接目标当作书里的文件）。读由调用方自己做：分页、流式、字节、原生搜索都行。目录与虚拟根用 `list`。读不记账。

### 文件监视与外部改动

- 文件监视**只检测哪些路径变了**：每个路径 `lstat` 一次，推给浏览器，同时转告记账。认出经接口写入的回声改为比对 inode、修改时间与大小，不读内容。
- 锁被持着的文件（提交或就地写进行中）先不判定，锁放了再判定。
- 记账收到外部改动后，等这个文件安静 1 到 2 秒（期间不再变化）再读一次内容，与保存的上一版比，记一条外部记录；超过快照上限的文件不读内容，只记“已更改”与大小、修改时间。
- Agent 的 `shell` 执行期间，这个会话所在的根里出现的外部改动，记为该会话、标“推断（shell）”，进审查收件箱；同一时间别处的改动可能被误归给它。
- 监视由拥有根的进程常驻（不再只在有浏览器订阅时开），启动时对账一次（先比修改时间、大小与 inode，变了才读）。

### nb-history 要补的

1. 二进制与大文件在快照上限内存全量（可以恢复），超过只记哈希；判二进制照 git（前 8000 字节含 NUL）；
2. 快照用 Bun 自带的 zstd 单版本压缩；
3. 对账用的修改时间、大小、inode 缓存，处理同一时间戳内的二次写入；
4. 记账入口收“改前与改后内容”（提交时手里已有），不再自己推断改前值；
5. 操作者加 `plugin`（带插件 id），Agent 来源可带会话条目 id（t13 的“每轮改动文件”用）；
6. 外部改动的“安静期”与“shell 推断”的归属标记；
7. 驱动换成 `bun:sqlite`，写入进事务，库带格式版本；
8. 首次接入已有的书时建基线（见待定项 2）；排除规则（见待定项 3）。

### 接口形态（草案）

服务端插件在入口里依赖 `workspaceFilesKey`，拿到按调用方生成的门面，操作者由调用方身份决定（`user`：替浏览器写的服务端入口；`plugin`：插件自己）。`nbook.agent` 另有 `forSession({session, profile, entryId?})`，得到一个操作者固定为该会话的门面，不在每次调用里传。

```ts
interface WorkspaceFiles {
    /** 地址 → 本机读路径（按方案的读授权）；不存在为 not-found。只供读：写一律经 stage/commit。 */
    readPath(address: string, options?: CallOptions): Promise<FilesResult<{path: string; kind: "file" | "directory" | "other"}>>;
    list(address: string, options?: CallOptions): Promise<FilesResult<Listing | VirtualListing>>;
    /** 一个文件当前的基线；不存在为 not-found。 */
    baseline(address: string, options?: CallOptions): Promise<FilesResult<Baseline>>;

    /** 取得暂存文件；await using 离开作用域时没提交就自动丢弃。 */
    stage(address: string, options?: CallOptions): Promise<FilesResult<Staged>>;
    /** 简写：整份内容一次写入并提交。 */
    write(address: string, content: Uint8Array | string, options: CommitOptions): Promise<FilesResult<{baseline: Baseline}>>;
    /** 读、改、按基线写回，冲突时重读重试（照 Obsidian 的 Vault.process）。只用于文本。 */
    update(address: string, edit: (text: string) => string, options?: CallOptions): Promise<FilesResult<{baseline: Baseline}>>;

    create(address: string, kind: "file" | "directory", options?: OpOptions): Promise<FilesResult<void>>;
    delete(address: string, options?: OpOptions & {recursive?: boolean}): Promise<FilesResult<void>>;
    move(from: string, to: string, options?: OpOptions): Promise<FilesResult<void>>;
    copy(from: string, to: string, options?: OpOptions): Promise<FilesResult<void>>;
}

interface Staged extends AsyncDisposable {
    /** 只收字节：文本自己编码（避免在多字节字符中间切块）。 */
    write(chunk: Uint8Array): Promise<void>;
    commit(options: CommitOptions): Promise<FilesResult<{baseline: Baseline}>>;
    abort(): Promise<void>;
}

interface CommitOptions extends OpOptions {
    /** 必填：给出基线是条件写；"absent" 只在不存在时新建；"any" 不论现状覆盖。 */
    expect: Baseline | "absent" | "any";
}
interface OpOptions extends CallOptions {
    createParents?: boolean;
}
interface CallOptions {
    signal?: AbortSignal;
}

/** 与文件服务同一算法（磁盘字节的 SHA-256），给已经自己读了文件的调用方。 */
declare function baselineOf(bytes: Uint8Array): Baseline;
```

- 结果沿用现有的 `FilesResult`（失败带 `code`、`detail`，冲突带 `current`，路由失败带 `cause`）；失败码沿用文件服务的码表，Spec 里给每个方法列出可能的码。
- 暂存文件写入的 I/O 失败在 `write` 时抛出（流式写入方通常这样处理），提交的结果一律经 `FilesResult` 交回。
- `move`、`copy` 不覆盖已存在的目标（与现有文件操作一致）。
- 写不经 `readPath` 拿到的路径：那样落盘照样被文件监视发现，但只能记为外部。

用法举例：

```ts
// Agent 的 read：拿到读路径后自己读
const at = await files.readPath("projects://book/第三章.md");
const text = await Bun.file(at.value.path).text();

// Agent 的 edit：按读时的基线写回，冲突时重读
const agent = files.forSession({session, profile});
await agent.write("projects://book/第三章.md", after, {expect: baselineOf(beforeBytes)});

// 图生文插件：流式存一张 8 MB 的 PNG
await using staged = (await files.stage("projects://book/插图/封面.png")).value;
for await (const chunk of image) await staged.write(chunk);
await staged.commit({expect: "absent", createParents: true});
```

### 备选与取舍

| 备选 | 放弃的原因 |
|---|---|
| 维持“读写都经文件服务”，给服务端补字节、流式、分页接口 | 劫持不了 shell 与外部工具；每类需求补一个接口，使用方仍会绕开 |
| 写入方自己写盘，先交账本、再改名（本提案第一稿） | 账本确认后改名失败或崩溃，会留下磁盘上从没出现过的版本，而账本只能追加；跨进程要传整份内容 |
| 写入方自己写盘，先改名、再交账本（评估里的方案 A） | 账本拿不到外部改动夹在中间时的改前内容，会把外部的改动算到写入方头上；文件锁的持有时间绑在另一个进程的 RPC 上 |
| 照 git，所有改动都由监视发现、账本提交，写入方只“认领”（评估里的方案 C） | 攒批窗口里两次写只见最后一版，归属记错，收件箱还原会抹掉别人的版本；允许就地写时会把写到一半的内容记成版本；大文件追加写时每批都读全文 |
| 在 `.nbook/` 下放隐藏 git 仓库 | 依赖系统 git、读用户的 `.gitignore`、每次记账一次进程；操作者与收件箱仍要另建一套 |
| isomorphic-git、libgit2 绑定 | 没有 gc 与差异压缩、Bun 下的成熟度没有一手证据；同样要另建操作者与收件箱 |

## 影响

- **数据**：项目多一个 `.nbook/history.sqlite`（含全文快照，属于作品，随书移动；诊断导出不得带它）与 `.nbook/staging/`（暂存，启动时清掉残留）；`user://` 的账本在状态根下。
- **接口**：nbook.files 新增服务端的写入接口（取代 t08 的服务端文件服务里的读写方法，挂载方案与授权保留）；浏览器的 RPC 合同不变；`nbook.history` 向 nbook.files 登记记账回调。
- **使用方**：Agent 的 t12 工具建在 `readPath` 与写入接口上；作品统计不用改；以后的图生文、导入导出插件用 `stage`。
- **进程**：项目子进程常驻文件监视，承担这本书的全部写入与记账；服务端写项目文件是一次几百字节的 RPC。
- **安全**：不是安全边界；shell 与外部工具的写入记为外部或推断。
- **依赖**：不新增；zstd 与 SQLite 都是 Bun 自带。
- **迁移与回滚**：账本是新增数据，没有旧格式要迁；停用 History 插件即停止记账，文件本身不受影响。

## 对 Spec 的预期改动

- `workspace/resources.md`：文件服务的职责（地址、写入唯一入口、监视与事件、浏览器入口）；服务端写入接口（暂存与提交、文件操作、期望、操作者、失败码）；读路径与读授权；去掉“读写都经文件服务”的总括；验收补暂存提交、外部改动夹在中间、结果不确定的核对。
- `workspace/files.md`：保存与文件操作改由提交与操作锁实现，对浏览器的行为不变；回声改为比对 inode、修改时间与大小。
- `workspace/folder-kinds.md`：清单的写入经同一条提交路径、同一把操作锁。
- `runtime/projects.md`：项目子进程常驻监视、承担写入与记账；`.nbook/history.sqlite` 与 `.nbook/staging/`。
- `agent/resources.md`：资源视图的写经写入接口、读经 `readPath`；`shell` 的推断归属。
- 新建账本的 Spec（`workspace/history.md` 或随 t13 定名）：记录的形状、操作者、文本与二进制的改动、外部改动的安静期与对账、回声、时间线、恢复、收件箱、未见变更、保留策略、记账失败与插件不在时的行为。

## 待定项

1. **同一本书被两个服务端同时打开**（`runtime/projects.md` 允许）。两个进程同写一个 `history.sqlite` 实测会频繁报忙。推荐：一本书同时只有一个记账者，先打开的项目实例持有账本的写锁，后开的只读、不记账，并写诊断；写入照常（操作锁是跨进程的）。
2. **首次接入已有的书怎样建基线。** 没有基线的文件第一次被外部改动时拿不到改前内容。推荐：项目第一次打开时在后台给快照上限内的文本文件建基线（实测 2000 个文件、60 MB 约 1.4 秒，账本约 37 MB）；建好之前的外部改动只记“已更改”。
3. **哪些文件不进账本。** 推荐固定一份缺省排除：`.nbook/`、`.git/`、`node_modules/`、编辑器的交换与备份文件（`*.swp`、`*~`、`.DS_Store` 等）；以后再给用户一个设置。
4. **原子替换的代价。** 改名会换掉 inode，Windows 上目标被别的程序占用时改名失败。推荐：硬链接数大于 1 的文件就地写（见上）；Windows 上改名失败时短暂重试，仍失败为 `busy`；Windows 与 macOS 上的监视可靠性到对应平台验收时验证。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-11-02 | 开发者 | 不再让 nbook.files 劫持所有文件访问；照 git 的思路记账；读写需求只在服务端 |
| 2026-11-02 | 开发者 | 改名、二进制照 git 处理；评估 git 复用与开源实现后，在 nb-history 上继续做 |
| 2026-11-02 | 开发者 | 账本放项目的 `.nbook/history.sqlite`；Agent 会话目录与临时目录不记账（只发变更事件），`user://` 记账；写入接口是 nbook.files 提供的按调用方服务；文件监视库先不换，到 Windows、macOS 验收时再对照验证 |
| 2026-11-02 | 开发者 | Agent 用 `shell` 改的文件归给该会话、标“推断” |
| 2026-11-02 | 开发者 | 第一轮深入审查与三种写入方案（A、B、照 git 的 C）的评估之后，采用 B+：写入方写暂存文件，拥有根的进程在锁里提交、记账、发事件；外部改动由文件监视发现、记账在文件安静后读一次；文件监视只检测变化。取代此前“锁内同步交账本再改名”的写入顺序 |
