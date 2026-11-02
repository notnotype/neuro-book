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
  - docs/specs/agent/resources.md
adrs: []
---

# 文件访问与改动记账

- 来源：w00032 t12（Agent 的基础工具）设计审查时发现 nbook.files 的读写接口不够服务端使用方用，开发者 2026-11-02 提出改为照 git 的思路记账（讨论与决定见 [t12 README](../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/README.md) 的“文件访问的架构讨论”，调研见 [file-history.md](../../.agents/works/w00032-agent-integration/tasks/t12-builtin-tools/research/file-history.md)）。
- 与既有提案的关系：改 [项目文件底座与 Files 竖切](project-file-foundation.md)（accepted）里“读写、列出、glob、grep、监视都经文件服务”这一条；该提案的其余决定（URI 方案、三类文件夹、带来源的变更事件、History 插件）不变。

## 问题

1. **nbook.files 的读写接口只适合浏览器编辑一个文档。** 读一次交整份 UTF-8 文本，写一次收整份文本，都有约 960 KiB 的上限（一条 RPC 消息 1 MiB），不能读写字节、不能分页、不能流式。服务端的使用方都用不上：
   - 作品统计要扫几千个文件，经 Files 读太重，已经改为订阅变更事件、直接读项目目录（`plugins/projects/project/stats-tracker.ts` 的注释）；
   - Agent 的 `read` 要分页读大文件、读图片字节，`grep`、`glob`、`shell` 要真实路径；`shell` 的全文日志可到几十 MB；
   - 以后的图生文插件要把生成的图片存进书里，导入、导出要写大文件与二进制。
2. **“所有访问都经文件服务”做不到。** shell、外部编辑器、`git checkout` 都直接写磁盘；给服务端使用方补字节、流式、分页接口，`projects://` 的文件在项目子进程里，跨进程同样受 1 MiB 消息上限限制。
3. **但要知道谁改了什么。** 用户（经网页）、Agent 会话、插件、外部工具改了哪个文件、改成什么，审查收件箱、每轮改动文件、旧版本与恢复都靠它（w00032 t13）；网页的文件资源管理器要实时看到变化。

## 目标与非目标

目标：

- 服务端各方（Agent 工具、插件、替浏览器保存的服务端）在本机直接读写文件，没有大小与格式限制；
- 经共享写入接口的写入，记下操作者与改动（文本按行，二进制只记“已更改”加前后哈希与大小），与写盘同在一把文件锁里完成；
- 不经接口的外部改动由文件监视发现，用账本保存的上一版算出改动，记为外部；
- 网页的文件资源管理器与编辑器照旧实时收到变更事件；
- 不引入系统 git 等外部依赖。

非目标：

- 安全边界：记账只对守约的写入方成立（与 [ADR 0027](../adr/0027-builtin-and-third-party-plugins-are-equal.md) 的“数据隔离只对守约插件成立”一致），不防恶意插件；
- 浏览器直接读写新方案（随对话界面另定）；
- 跨版本的差异压缩（先做单版本压缩，用真实数据复测后再定）；
- 外部改名的精确识别（照 git，看的时候按内容相似度推断）。

## 当前行为与证据

| 使用方 | 现状 |
|---|---|
| 编辑器（浏览器） | 经 RPC 读整份文本、按基线条件保存；超过约 960 KiB 按 Spec 不在文本编辑器打开 |
| 文件树（浏览器） | 列目录与文件操作（新建、改名、移动、复制、删除），不读内容 |
| Markdown、HTML 预览（浏览器） | 字节经 nbook.files 的 HTTP 字节路由，不经 RPC |
| 作品统计（项目子进程） | 订阅变更事件，直接读项目目录 |
| Agent（服务端，t08） | 资源视图经服务端文件服务读写，受同样的整份文本与 960 KiB 限制 |

不经 nbook.files 的应用数据：Storage 的 SQLite（`<状态根>/storage/user.sqlite`、`<项目>/.nbook/storage.sqlite`）、设置文件、项目身份与登记表、Agent 会话日志、用户 Profile 的打包。它们各管各的根与写入策略，不在本提案范围。

[nb-history](../../packages/nb-history/README.md) 已经实现了账本的大半：代写并记账（`performWrite`）、只补记账（`registerWrite`）、观察型记账（`registerObservedWrite`，用账面末态当改前值）、对账（`reconcile`，吸收回声、补外部条目）、时间线、文本 diff、恢复与误删找回、审查收件箱、会话未见变更、保留策略。它还没接进新应用，已知限制是单进程单写者、二进制与超过 2 MB 只记哈希（不能恢复）、没有压缩。

实测（2026-11-02，本机 Linux，真实项目子进程）：服务端经 `{project}` 目标调项目实例的一个空载荷方法，p50 0.30–0.38 ms，p99 1.9–2.4 ms。

## 方案

### 职责划分

| 部件 | 负责 |
|---|---|
| **nbook.files** | 地址：方案注册、挂载方案、地址与真实路径的换算（`realPath`）；文件监视与给浏览器的实时变更事件；浏览器的读写入口（现有的 RPC 读、条件保存与文件操作，内部改用下面的写入接口） |
| **写入接口**（新增，nbook.files 交给服务端插件的按调用方服务） | 在本机写文件并记账：条件写、整份写、流式写（大文件、二进制）、新建、删除、改名；调用方的身份由内核签发，操作者由它定 |
| **账本**（nb-history） | 每个根一份：记下操作者与改动，保存每个版本的内容；时间线、diff、恢复、收件箱、会话未见变更 |

读不经接口：服务端使用方用 `locate` 取真实路径后在本机读（流式、分页、字节都由使用方自己做）。读不产生记录，账本不受影响。

### 接口形态（草案）

服务端插件在入口里依赖 `workspaceFilesKey`，拿到按调用方生成的门面；操作者由内核签发的调用方身份决定（`user`：替浏览器写的服务端入口；`plugin`：插件自己；`agent`：只有 `nbook.agent` 能经 `as` 注明代表哪个会话），不能自称别人。

```ts
interface WorkspaceFiles {
    /** 地址 → 本机绝对路径；不存在时给出将来的位置（exists: false），不建任何东西。读由调用方在本机自己做。 */
    locate(address: string, options?: {signal?: AbortSignal}): Promise<Result<{path: string; exists: boolean; kind: "file" | "directory" | null}>>;

    /** 整份写文本；给了 baseline 就是条件写，磁盘上不是这一版时得 conflict。 */
    writeText(address: string, text: string, options?: WriteOptions): Promise<Result<{baseline: Baseline}>>;
    /** 整份写字节（图片、导出文件）。 */
    writeBytes(address: string, bytes: Uint8Array, options?: WriteOptions): Promise<Result<{baseline: Baseline}>>;
    /** 大文件、边生成边写：commit 时才落盘并记账；abort 或出错时什么都不留。commit 之前一直持有这个文件的锁。 */
    openWrite(address: string, options?: WriteOptions): Promise<Result<FileWriter>>;

    create(address: string, kind: "file" | "directory", options?: OpOptions): Promise<Result<void>>;
    remove(address: string, options?: OpOptions): Promise<Result<void>>;
    rename(from: string, to: string, options?: OpOptions): Promise<Result<void>>;
}

interface WriteOptions extends OpOptions {
    baseline?: Baseline;
    createParents?: boolean;
}
interface OpOptions {
    signal?: AbortSignal;
    as?: {agent: {session: string; profile: string}};
}
interface FileWriter {
    write(chunk: Uint8Array | string): Promise<void>;
    commit(): Promise<Result<{baseline: Baseline}>>;
    abort(): Promise<void>;
}
```

`Result` 沿用现有形状（`{ok: true, value}` 或 `{ok: false, code, detail}`），失败码沿用文件服务的码表。

用法举例：

```ts
// Agent 的 read：定位后自己读，分页、字节都行
const at = await files.locate("project://第三章.md");
const text = await Bun.file(at.value.path).text();

// Agent 的 edit：改完按基线写回，账本记下“Agent 会话 s1 改了哪几行”
await files.writeText(address, after, {as: {agent: {session, profile}}, baseline: hashOf(before)});

// 图生文插件：流式存一张 8 MB 的 PNG，账本记下“插件新建了二进制文件，大小与哈希”
const writer = await files.openWrite("project://插图/封面.png", {createParents: true});
for await (const chunk of image) await writer.value.write(chunk);
await writer.value.commit();
```

浏览器保存仍调现有的 RPC 方法，服务端用 `writeText(地址, 正文, {baseline})` 替它写，操作者记为用户。shell 等外部写入什么都不用做，由文件监视发现、记为外部。

### 写入的顺序

一次经接口的写入，在这个文件的锁里（跨进程，现有条件保存已在用）完成：

1. 读出当前内容（改前值）；带基线的条件写在这里比较基线，不一致为冲突；
2. 写同目录的临时文件（流式写在这里边写边算哈希），得到改后值；
3. 算改动：文本按行（npm `diff`），二进制只记前后哈希与大小（判二进制照 git：前 8000 字节含 NUL）；
4. 把记录（操作者、路径、前后哈希、改动、改后内容）交给这个根的账本，等它确认；
5. 改名替换到目标路径；失败时撤回这条记录；
6. 放锁。

记录在改名之前送达，文件监视随后看到的变化与账面末态一致，按回声吸收，不会再记一次外部。记录不挪到锁外：锁保证同一文件的记录按写入顺序到达，账本不用排序；实测本机 RPC 往返在毫秒以内。若以后实测锁内等待成为瓶颈，再改为锁外异步加“改前哈希、改后哈希、锁内序号”排序（记录格式不变）。

### 外部改动

文件监视报来的变化交给账本对账：与账面末态一致就当回声吸收；不一致就用账本保存的上一版算出改动，记为外部。对账前先比文件的修改时间、大小与 inode（照 git 的 index 缓存），不变就不读内容；同一时间戳内二次写入按 git 的做法再比内容。外部改名记为删除加新建，时间线按内容相似度接起来。

### 账本放在哪个进程

每个根一份账本，由拥有这个根的进程独占写：项目的账本在项目子进程里（库在项目的 `.nbook/` 下，随书移动），`user://` 的在服务端。服务端写项目文件时，第 4 步经 RPC 交给项目子进程的账本。这样 nb-history 仍是单进程单写者，不必先支持多进程同写一个库；两个服务端同时打开同一个项目的少见情形，靠 SQLite 事务（`BEGIN IMMEDIATE` 加等锁超时）兜底。

### nb-history 要补的

1. 二进制与大文件存全量（设大小上限，超过只记哈希并在时间线里标明），可以恢复；
2. 快照用 Bun 自带的 zstd 单版本压缩；
3. 对账前的修改时间、大小、inode 缓存；
4. 操作者加一类 `plugin`（插件自己的写入，带插件 id），Agent 来源可带会话条目 id（t13 已提）；
5. 驱动从 libsql 换成 `bun:sqlite`（NOTES 已记它在 Windows 上释放句柄更干净），写入进事务。

### 文件监视

保留现有的递归 `fs.watch`（Linux 实测可用）与批合并、回声过滤；Bun 的 `fs.watch` 在 Windows、macOS 有多条开放缺陷，到 Windows、macOS 验收时用 chokidar 6 或 `@parcel/watcher` 对照验证再定。保留定期全量对账兜底（inotify 队列溢出、FSEvents 要求重扫时）。

### 备选与取舍

| 备选 | 放弃的原因 |
|---|---|
| 维持“读写都经文件服务”，给服务端补字节、流式、分页接口 | 劫持不了 shell 与外部工具；`projects://` 跨进程受 1 MiB 消息上限，大文件与 20 MB 图片要分块搬；每类需求补一个接口，使用方仍会绕开 |
| 在 `.nbook/` 下放隐藏 git 仓库，调系统 git | 存储与压缩最强（合成数据 100 版 3.52 MiB 压到 159 KiB），但依赖系统 git（与外部命令行“只检测不安装”冲突）、读用户的 `.gitignore`、每次记账一次进程（25–110 ms）；操作者、收件箱、会话游标、保留策略仍要另建一套 SQLite，两套账本要保持一致 |
| isomorphic-git、libgit2 绑定 | isomorphic-git 没有 gc 与差异压缩、没有 diff；`nodegit` 在 Bun 下大概率不可用，`es-git` 是 0.x；同样要另建操作者与收件箱 |
| 写盘之后异步报账 | 记录与写入的顺序要靠哈希链加序号排序，账本逻辑更复杂；实测锁内同步的代价很小 |
| 写入方只报“操作者 + 改后哈希”，由账本读文件算改动 | 账本读文件时内容可能又变了，中间版本与改动可能对不上；在锁里算出改动更准，且只有接口一份实现 |

## 影响

- **数据**：项目多一个 `.nbook/history.sqlite`（含全文快照，属于作品，随书移动；诊断导出不得带它）；`user://` 的账本在状态根下。
- **接口**：nbook.files 新增服务端的写入接口；t08 做的服务端文件服务里的写方法改由写入接口实现，读的使用方改用 `realPath`；浏览器的 RPC 合同不变。
- **使用方**：Agent 的 t12 工具直接建在写入接口与 `realPath` 上；作品统计不用改（已经是“订阅事件 + 直接读”）；以后的图生文、导入导出插件用流式写。
- **安全**：不是安全边界（非目标）；shell 与外部工具的写入照旧记为外部。
- **依赖**：不新增；zstd 与 SQLite 都是 Bun 自带。
- **迁移与回滚**：账本是新增数据，没有旧格式要迁；回滚即停用账本，文件本身不受影响。

## 对 Spec 的预期改动

- `workspace/resources.md`：文件服务的职责改为地址、监视与变更事件、浏览器读写入口；服务端写入接口（条件写、整份写、流式写、新建、删除、改名，写入顺序与操作者）；服务端读用 `realPath`；去掉“读写都经文件服务”的总括。
- `workspace/files.md`：保存与文件操作改由写入接口实现，对浏览器的行为不变。
- 新建账本的 Spec（`workspace/history.md` 或随 t13 定名）：记录的形状、操作者、文本与二进制的改动、外部改动的对账、回声吸收、时间线、恢复、收件箱、未见变更、保留策略。
- `agent/resources.md`：资源视图的写经写入接口、读经 `realPath`。

## 待定项

无（2026-11-02 开发者按推荐定了四项，见决策记录）。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-11-02 | 开发者 | 不再让 nbook.files 劫持所有文件访问；照 git 的思路记账：各方经共享接口在服务端直接读写，接口在写入时算出改动连同操作者交给账本；外部改动由文件监视发现；读写需求只在服务端 |
| 2026-11-02 | 开发者 | 写入时在锁内同步把记录交给账本（实测本机 RPC 可接受）；改名、二进制照 git 处理；评估 git 复用与开源实现后，再定是否在 nb-history 上继续做 |
| 2026-11-02 | 开发者 | 四个待定项按推荐：账本放项目的 `.nbook/history.sqlite`；Agent 会话目录与临时目录不记账（只发变更事件），`user://` 记账；写入接口是 nbook.files 提供的按调用方服务；文件监视库先不换，到 Windows、macOS 验收时再对照验证 |
