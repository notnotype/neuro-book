---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.projects
owners:
  - application-runtime
  - nbook.projects
---

# 项目与项目实例

## 目标与非目标

服务端宿主管理“项目”：用户登记的作品目录，带不随路径变化的项目身份。每个打开的项目在一个子进程里运行一个 `project` 位置的内核实例（项目实例）；浏览器窗口按地址栏绑定一个项目实例的代次；服务端插件经宿主能力 `projectsKey` 列出、登记项目并取得项目租约；最后一个使用者离开后项目在宽限期满时关闭、子进程真实退出。内置插件 `nbook.projects` 提供“打开项目”的界面与给客户端的远程入口。

内核只提供通用的子实例与租约机制（[`runtime.application`](application.md)）、远程服务的绑定与路由（[远程服务与 RPC 协议](plugin-channel.md)）；“项目”的目录、身份、登记表、子进程与访问规则由本能力定义。

明确不承诺：

- 不防止两个服务端进程同时打开同一个项目目录（不加目录锁，见“边界与兼容”）。
- 项目子进程崩溃后不自动重启；绑定它的窗口由用户刷新后重新打开。
- 最近打开、重命名短名属于 `nbook.projects` 的后续范围。书架页本身由 [`workbench.bookshelf`](../workbench/bookshelf.md) 定义，本合同提供它的数据与操作：作品信息、新建、移出书架与统计（输出第 13–18 条，planned，随书架页实现）。
- 项目实例里的诊断先写各自的日志文件，不汇到服务端的诊断出口。
- Agent 会话的项目租约与 `projects://` 提供者随 nb-harness；项目内的 Storage 分区随 K4；`project://` 的文件提供者随 Files。
- 不兼容旧应用的项目目录与数据，不做迁移。

## 术语与参与者

- **项目**：用户登记的一个目录。项目身份是项目 id（UUID），写在项目目录的 `.nbook/project.json`；目录移动后再登记，按 id 认出是同一项目。
- **登记表**：状态根下的 `projects.json`，列出已登记项目的 id、短名与当前路径。
- **短名**：登记时由目录名生成、之后不变的名字，用在地址栏 `/?project=<短名>` 与界面上。
- **项目引用**：短名或项目 id；按引用解析时先比 id、再比短名。
- **项目实例**：某个项目的一次运行，即内核子实例的一个代次（键是项目 id）。同一项目的代次单调递增、不复用。
- **项目子进程与项目宿主**：服务端为每个项目实例起一个 Bun 子进程，里面的项目宿主入口建立 `project` 位置的运行实例，经进程间链路连到服务端的路由。
- **项目管理器**：服务端宿主里管理项目的部分：登记表、子实例、租约、访问核对与停止。
- **租约**：使用者对某个项目代次的使用登记；持有期间该代次不会因宽限期满而停止。租约的持有者是“实例 + 插件 + 入口 + 入口激活代次”（远程服务的调用方身份去掉委托代理，见“输出与可观察行为”第 8 条）。
- **绑定**：客户端实例一生绑定的那个项目代次（或不绑定），由握手取得（[远程服务与 RPC 协议](plugin-channel.md)）；绑定持有该代次的一份租约。
- **宽限期**：最后一个租约释放后到开始停止项目实例的等待时间，缺省 5 分钟。
- **`projectsKey`**：服务端宿主以本地能力提供给服务端插件的项目管理服务，按调用方门面提供。
- **`currentProjectKey`**：项目宿主以本地能力提供给项目实例里的插件的当前项目信息（键在 `src/shared/projects.ts`）。项目里的插件要项目目录时依赖它，不经插件工厂传入（[ADR 0026](../../adr/0026-plugin-definitions-as-constants.md)）。
- **`nbook.projects`**：内置插件，服务端入口把列出与登记包成远程服务，浏览器入口提供“打开项目”命令与当前项目的显示；随书架页增加项目实例里的统计入口与书架页（planned）。
- **作品信息**：身份文件里的可选字段：书名 `title`、简介 `description`、主题色 `color`。显示名取书名，没有时取短名（planned）。
- **统计**：项目实例算出的字数、篇数、今天净增与最近编辑，存在 user 分区的记录 `projects.stats` 里；书架只读这份缓存与运行中项目的实时状态，不为显示统计打开项目（planned）。
- **作品目录**：设置 `nbook.projects/library`（user 层字符串，缺省空），新建作品的缺省父目录；首次新建成功后由书架页写入（planned）。

## 输入与前置条件

- **登记的目录**：绝对路径；相对路径按服务端进程的工作目录解析后再校验。目录必须存在、是目录、当前用户可读写，且不在状态根之内。登记的是解析符号链接后的真实路径。
- **项目身份文件**：`.nbook/project.json`，内容 `{schema: 1, id: "<UUID>"}`，可带作品信息 `title`、`description`、`color`（第 13 条，planned）。登记时没有就创建（含 `.nbook/` 目录）；已有则读取并校验，不改写；只有修改作品信息会改写它。
- **登记表**：`<状态根>/projects.json`，内容 `{schema: 1, projects: [{id, name, path}]}`。文件不存在视为空表。
- **打开项目的入口**只有两个：客户端握手的 `bind`（[远程服务与 RPC 协议](plugin-channel.md)）与服务端插件经 `projectsKey` 的 `acquire`。Storage 读取、外部 HTTP 请求、`{project}` 目标的远程调用都不打开项目。
- **启动参数**（[`runtime.server-host`](server-host.md)）：`NBOOK_PROJECT_GRACE_MS`（宽限期，缺省 300000）、`NBOOK_PROJECT_START_MS`（项目子进程报告启动结果的截止，缺省 30000）、`NBOOK_PROJECT_STOP_MS`（每个项目子进程的停止截止，缺省 20000）。

## 输出与可观察行为

1. **登记。** `register(路径)` 校验目录、读取或创建身份文件，写入登记表，返回 `{id, name, path}`。
   - 短名：取目录名，转小写，非 `[a-z0-9-]` 的字符换成 `-`，合并连续的 `-` 并去掉首尾的 `-`；结果为空时用 `project`；与已登记的其它项目重名时依次加 `-2`、`-3`。短名登记后不变，项目移动也不变。
   - 身份文件里的 id 已在登记表中：原登记路径下已没有这个 id（项目移动了）时更新路径，返回原短名；原路径下仍是同一个 id（这是一份副本）时拒绝，原因 `identity-conflict`，说明删除副本里的 `.nbook/project.json` 后可作为新项目登记。
   - 同一真实路径重复登记：返回已有登记，不改动。这个路径已登记为另一个 id（身份文件被换过）时同样拒绝为 `identity-conflict`。
   - 已登记的目录丢了身份文件：按登记表里的 id 重建身份文件，仍是同一个项目。
   - 登记更新不影响正在运行的项目代次；新路径从下一个代次起生效。
2. **列出与解析。** `list()` 按登记顺序返回全部项目：`{id, name, path, state}`，`state` 为 `stopped`（没在运行）、`starting`、`running`、`idle-grace`、`stopping` 之一，后四种带代次。`resolve(引用)` 返回登记项或 `null`。
3. **打开。** 取得某项目的租约时：
   - 该项目没在运行：以新代次创建项目实例，先起子进程，等它报告启动结果；同一时刻到达的其它请求等同一个创建结果。
   - 处于 `running`：立即取得。处于 `idle-grace`：取消关闭计时，回到 `running` 并取得。
   - 处于 `stopping`：不复活这一代，等它退出后以新代次创建。
   - 创建失败：请求方得到 `create-failed`，附原因（启动超时、启动中退出带退出码、实例启动失败带失败入口）；子进程不残留。
4. **项目子进程。** 服务端用自己的 Bun 可执行文件运行项目宿主入口（打包产物的 `project.js`；开发模式与测试使用各自的源码入口），经 Bun 的进程间通信建立链路，帧与客户端链路使用同一 JSON 编码（[远程服务与 RPC 协议](plugin-channel.md) 的“进程间链路”）。项目宿主：
   - 建立远程节点，实例描述 `{id: "project:<项目 id>#<代次>", kind: "project", role: "project", project: {id, generation}, client: null}`；服务端路由只接受与此完全一致的描述。
   - 建立 `project` 位置的运行实例，装配清单中有 `project` 运行位置的入口，本地能力 `currentProjectKey` 提供 `{id, name, generation, root}`（`root` 是项目目录的真实路径），`clockKey` 与服务端相同。
   - 运行实例可用之后才报告“已启动”；启动失败报告“启动失败”与失败原因，然后按停止序列收口并退出。
   - 诊断写入每个项目自己的日志位置 `<状态根>/logs/projects/<短名>/`（诊断文件出口按位置持有授予，与服务端的 `<状态根>/logs/` 各自持有）；标准输出与标准错误由服务端逐行转发到自己的输出，每行加前缀 `[project <短名>#<代次>]`。
   - 收到服务端的停止请求，或与服务端的进程间链路断开（服务端已不在），即按停止序列停止：依赖逆序关闭插件，正常以 0 退出，停止中有步骤失败以 1 退出。
5. **关闭。** 最后一个租约释放后进入 `idle-grace`，宽限期满进入 `stopping`：服务端请求子进程停止并等它真实退出；到 `NBOOK_PROJECT_STOP_MS` 仍未退出则强制结束，记为外部观察到的终止并写诊断。子进程以非 0 退出码结束时照常进入 `terminated`，同时写诊断 `project.stop.incomplete`（带退出码）。之后再打开得到新代次。
6. **崩溃。** 子进程在没有被要求停止时退出或进程间链路断开：这一代立即 `terminated`，全部租约失效（租约的 `revoked` 触发），路由关闭绑定这一代的客户端链路；退出码或信号在子进程真正结束后写进诊断 `project.exited`。不自动重启。
7. **客户端绑定。** 窗口以 `/?project=<引用>` 打开时握手带上绑定请求，项目管理器按第 3 条为它取得租约，握手结果带回 `{id, name, generation}`；窗口的链路关闭时释放这份租约。同一项目的多个窗口共用一个项目代次。重连时只在原代次仍是 `running` 或 `idle-grace` 时恢复原绑定（取得新租约、取消宽限期），原代次正在停止或已结束则拒绝（`project-gone`），绝不改投新代次。绑定过程中服务端开始停止：已取得的租约立即释放，握手以 `project-unavailable` 拒绝。客户端一侧的呈现见 [`runtime.browser-host`](browser-host.md)。
8. **`projectsKey`。** 服务端插件在入口依赖里声明 `projectsKey` 即可使用；每个调用方入口的每次激活得到自己的门面：
   - `list()`、`register(路径)`、`resolve(引用)`：同第 1、2 条。`register` 失败返回 `{ok: false, reason, detail}`。随书架页增加 `readMetadata(id)`、`create`、`updateMetadata`、`unregister`（第 13–15 条，planned）；`readMetadata` 读不出身份文件时的原因为 `unknown-project`、`registry-invalid`、`identity-invalid`、`identity-conflict` 或 `read-failed`（读盘出错）。
   - `acquire(引用)`：返回 `{status: "acquired", lease: {id, name, generation, revoked, release()}}` 或 `{status: "rejected", reason, detail}`，`reason` 为 `unknown-project`、`admission-closed`、`create-failed`。租约的持有者是门面所属的调用方（实例、插件、入口与激活代次）；调用方入口停止时门面释放，未释放的租约一并释放。经委托代理取得的租约同样记在原调用方名下，原调用方直接调用与经代理调用都按它核对；别的入口持有不到它。
9. **`{project}` 目标的访问。** 发往 `{project: id}` 的远程请求与订阅，只能到达这个项目当前运行的代次，访问本身不打开项目、不取得租约。路由按帧上的调用方身份询问项目管理器：
   - 调用方持有这一代的租约：放行；
   - 调用方没有租约，但它是服务端实例上的插件，且这一代处于 `running`：放行；
   - 其余（含这一代处于 `idle-grace`）：`denied`。因此 `idle-grace` 中到达的外部回调不会唤醒项目、不会取消宽限期。
   浏览器窗口只持有握手时为它取得的那份租约，平时用 `project` 目标；项目实例之间第一版不能互相取得租约。
10. **`nbook.projects`。**
    - 服务端入口依赖 `projectsKey`，提供远程服务 `nbook.projects/projects`（提供方位置 `server`，调用方 `browser`、`tui`）：`list` 返回短名、项目目录路径与运行状态；`register(路径)` 登记目录。
    - 浏览器入口提供命令 `nbook.project.open`（“打开项目”）：经命令面板的选择模式（[`workbench.quick-open`](../workbench/quick-open.md)）列出已登记项目（短名、路径、是否运行），选中即整页导航到 `/?project=<短名>`；输入一个目录路径并确认，先登记，成功后导航；登记失败时带着原因（标题里）重新打开选择，用户可以改了再试或取消；原因按失败码（`invalid-path`、`not-directory` 等）以当前显示语言给出，服务端返回的说明原文只进诊断。窗口绑定了项目时，工作台显示当前项目的短名（取自窗口的绑定结果，不另外调用服务）。
11. **服务端停止。** 服务端停止序列一开始就同步关闭项目管理器的接纳：之后的 `acquire` 与客户端绑定都以 `admission-closed`（客户端看到 `project-unavailable`，说明服务端正在停止）拒绝；内核停止时先停全部项目子进程并等真实退出，再关闭服务端插件（[`runtime.server-host`](server-host.md)）。
12. **资源占用。** 每个打开的项目常驻一个 Bun 子进程。2026-10-07 在本机 Linux、Bun 1.4.2 上用生产打包产物实测（`bun scripts/measure-project.ts`，冷启动 10 次）：从请求打开到取得租约 p50 约 55 ms、最大约 70 ms，就绪后常驻约 49 MB；当时项目实例里只有内核与 `nbook.diagnostics`，项目入口变多后需重测。只带 IPC 的空子进程约 26 ms 就绪、常驻约 30 MB，可作为下限参照。

下面第 13–18 条随书架页实现（planned）：

13. **作品信息。** 身份文件可带可选字段 `title`（去掉首尾空白后 1 到 80 个字符）、`description`（至多 500 个字符）、`color`（`#rrggbb` 小写）。
    - 读取仍只认 `schema` 与 `id`；可选字段不合规时当作没有并记诊断 `project.metadata.invalid`，身份照常可用。
    - `updateMetadata(id, patch)` 只改给出的字段：`null` 清除，省略不动；保留 `id` 与不认识的字段。写入经跨进程写入锁 `.nbook/locks/project.json.lock`（父目录先建）加原子替换：锁内按当前字节解析，核对文件里的 `id` 与登记表一致；改名前核对文件身份，变了从新字节重做；临时文件沿用权限位。身份文件是符号链接时解析到最终目标再替换（链接保留），悬空链接为 `identity-invalid`。两个进程分别改不同字段，两个字段都保留。
    - 失败码：`unknown-project`、`registry-invalid`、`identity-invalid`（含身份文件不存在：不重建）、`identity-conflict`（文件里的 id 与登记表不一致）、`invalid-metadata`（带字段名）、`read-only`、`write-failed`。
14. **新建。** `create({title, description?, parent?})`：
    - `parent` 省略时用作品目录设置（由 `nbook.projects` 的服务端入口读，宿主能力的 `create` 要求给出父目录）；两者都没有为 `no-library`，先于书名校验。父目录按第 1 条的目录校验，不过为 `invalid-parent`（带原因）。
    - 目录名由书名生成：`/ \ : * ? " < > |` 与控制字符换成 `-`，去掉首尾空白与句点，至多 80 个字符；结果为空，或是 `.`、`..`、Windows 保留名时用“作品”。同名目录已存在为 `exists`（带路径），不自动加后缀。
    - 分阶段执行：排他新建目录；写身份文件（含书名与简介），失败时只装着本次写的东西的目录删掉，结果 `write-failed`；按第 1 条登记，失败保留目录与身份文件，结果 `register-failed`（带路径），再登记该目录按幂等规则接着完成。成功返回 `{id, name, path}`。
15. **移出书架。** `unregister(id)` 只改登记表，不动目录与身份文件。项目管理器按项目 id 把它与打开（第 3 条）串行：写表完成前不接纳同一 id 的打开。项目不在 `stopped`（`starting`、`running`、`idle-grace`、`stopping`）时拒绝为 `project-running`（带状态）；只限本服务端进程管理的代次，不声称全局停止。移出后再登记该目录，按身份文件里的 id 得到同一 id 与新的短名登记。
16. **统计。** `nbook.projects` 的 `project` 位置入口 `stats`（`onStartup`，项目一打开就开始）在项目实例里统计本项目：
    - **口径**：项目目录里所有非隐藏的 `.md` 文件（名字以 `.` 开头的目录与文件不计，含 `.nbook/`）；字数用 [workbench.editor](../workbench/editor.md) 输出 27 的算法，frontmatter 不计；“篇”是计入的文件数。读不出的文件（权限、编码、过大）计入 `unreadable`，不按 0 字计。
    - **顺序**：以记录（`projects.stats`）为初值，首扫完成前状态为 `counting`；先订阅 `nbook.files/project` 的变更并缓冲事件，再扫描；扫完按顺序结算缓冲的事件。扫描并发读至多 4 个文件、每批让出一次执行权，只留字数与最后一段，不留全文。
    - **事件**：路径是已计入的文件按文件重读；是已计入文件的上级目录按目录处理；都不是时 `lstat` 一次判定。目录事件（新建、移入、复制、删除、改名）与 `resync` 标记重扫：同一时间至多一次扫描在跑，另外至多排一次。订阅 `ended` 后不再更新，状态为 `ended`。
    - **今天**：按服务端所在机器的本地日期。运行中跨午夜时先把基线换成当时的总字数，再计入之后的变化；打开时记录里的日期是今天就沿用基线，不是今天就以记录的总字数作基线（离线期间的外部修改算进打开当天）；从没统计过的作品，第一次扫完的总字数就是基线。
    - **最近编辑**：只由观察到的文件修改更新（经文件服务保存或外部修改都算）：地址、片段名（文件名去掉扩展名）、时间与该文件最后一个非空段落的前 120 字（去掉 Markdown 标记前缀，frontmatter 不算段落）。改名跟到新地址，删除清空；重开后沿用记录，首扫核对该文件还在。扫描不设最近编辑：文件合同不给修改时间，不猜。
    - **持久化**：user 分区记录 `projects.stats`（owner `nbook.projects`，按资源 id 寻址，资源 id 是项目 id，`locality: shared`，版本 1），值为快照 `{computedAt, words, files, unreadable, today: {date, baseline}, last}`。变化后最多每 30 秒写一次，按 revision 条件保存：冲突时重读，存着的 `computedAt` 更晚就放弃，否则以新 revision 重写；`unknown-outcome` 重读后同样核对；`busy`、`io-error` 保留旧记录、记诊断、下一轮再写；`corrupt`、`unsupported-version` 以条件 `reset` 覆盖（它是可重算的缓存），原件进原件区并记诊断，原件区满时放弃并记诊断。两个服务端进程打开同一作品时，后算完的胜出。
    - **停止**：在入口登记的资源释放里写最后一次（Storage 门面此时还在）：整轮扫描没完成就不写、保留旧记录；扫描已完成时在途的单文件重读至多再等 1 秒，然后写一次。
17. **书架与新鲜度。** 远程服务 `nbook.projects/stats`（提供方 `project`，调用方 `server`）的 `current()` 返回 `{status: "counting" | "complete" | "ended", snapshot}`。服务端的 `shelf()` 对每部作品返回登记项、作品信息与统计摘要（`ShelfItem`，schema 在共享合同里）：
    - 处于 `running`：经 `{project}` 目标调用 `current`（服务端插件对运行中的项目无租约访问，不打开项目、不续宽限期；至多等 2 秒，一个卡住的项目实例不拖住整张书架）：`complete` 为 `fresh`，`counting` 为 `counting`（带上次的快照），`ended`、超时或调用失败退回记录、为 `stale`；
    - 处于 `idle-grace`、`starting`、`stopping` 或没在运行：读记录，为 `stale`（宽限期里最多比实际旧 30 秒）；没有记录为 `none`；
    - 今天的字数只在快照的 `today.date` 是今天时给出（`words - baseline`，可为负），否则为 null；
    - 一部作品的身份文件或记录读不出只影响它自己：作品信息为 null、统计按 `stale` 或 `none`，并记诊断。
18. **合同版本 2 与书架页。** `nbook.projects/projects` 升到 `version: 2`，在第 10 条的 `list`、`register` 之外增加 `shelf`、`create`、`update`、`unregister`（对应第 13–15、17 条；作品信息的校验在服务端做，失败码带字段名）；旧页面调用得到 `version-changed`，按浏览器宿主的规则提示刷新。浏览器入口向工作台的 `workbench.home` 贡献书架页（[workbench.bookshelf](../workbench/bookshelf.md)）；“打开项目”的列表改用 `shelf` 的数据：显示名（书名优先，没有时短名）、路径、是否打开。

## 状态与转换

项目实例沿用 [`runtime.application`](application.md) 的子实例状态表（`creating → available → idle-grace → stopping → terminated`），`list()` 的 `state` 依次称为 `starting`、`running`、`idle-grace`、`stopping`、`stopped`。项目一侧的事件：

| 当前 | 事件 | 结果 |
|---|---|---|
| 没在运行 | 首次取得租约（绑定或 `acquire`） | 新代次 `creating`：起子进程，等启动结果 |
| `creating` | 子进程报告已启动 | `available`；等待者取得租约 |
| `creating` | 报告启动失败 | 请求子进程停止，等它退出（到停止截止则强制结束）；`terminated`，等待者得到 `create-failed` |
| `creating` | 启动截止到达，或启动中退出 | 强制结束（已退出则不必）；`terminated`，等待者得到 `create-failed` |
| `available` | 最后一个租约释放（窗口关闭、插件释放或入口停止） | `idle-grace`，开始宽限计时 |
| `idle-grace` | 新租约（新窗口、重连恢复原绑定、`acquire`） | 取消计时，回到 `available` |
| `idle-grace` | `{project}` 目标的无租约访问 | 不变；请求为 `denied` |
| `idle-grace` | 宽限期满 | `stopping`：请求子进程停止 |
| `stopping` | 子进程退出 | `terminated`；非 0 退出码另写 `project.stop.incomplete` |
| `stopping` | 停止截止到达 | 强制结束；`terminated`，记为外部观察到的终止 |
| `stopping` | 新租约 | 等本代次结束后以新代次创建；按代次恢复绑定的重连得到 `project-gone` |
| `available`、`idle-grace` | 子进程意外退出 | `terminated`；租约失效，绑定的客户端链路被关闭 |
| 任意 | 服务端开始停止 | 接纳关闭；存活的项目实例依次停止 |

登记表：未登记 → 已登记 → 已移出（第 15 条，planned），另有路径更新；不提供重命名短名。移出与打开按项目 id 串行，不出现“写表中被打开”的半状态。

## 副作用与数据

- **项目目录**：登记时可能创建 `.nbook/` 目录与 `.nbook/project.json`，这是用户能看到的改动；之后只有修改作品信息（第 13 条）改写身份文件，经 `.nbook/locks/project.json.lock` 与同目录的临时文件；新建作品（第 14 条）创建目录与身份文件。本能力不写项目目录里的其它文件。
- **user 分区**（planned）：统计记录 `projects.stats`（第 16 条）由项目实例写入；作品目录设置 `nbook.projects/library` 由书架页在新建成功后写入。
- **状态根**：`projects.json` 由服务端进程独占写入，进程内串行，写临时文件后改名替换；项目子进程的诊断日志写在 `logs/` 下。
- **进程**：项目子进程归服务端进程的项目管理器所有，随宽限期满、崩溃或服务端停止结束；服务端不结束自己没有创建的进程。
- **输出**：项目子进程的标准输出与标准错误逐行转发到服务端的输出。

## 失败与恢复

- **登记失败**，原因可区分：`invalid-path`（解析失败或不存在）、`not-directory`、`not-accessible`（不可读写）、`inside-state-root`、`identity-invalid`（身份文件存在但无法解析或结构不符，不改写它）、`identity-conflict`（见输出第 1 条）、`registry-invalid`、`write-failed`。失败时登记表不变。
- **登记表无法解析或结构不符**：不覆盖它；登记、列出、解析与按引用打开都以 `registry-invalid` 失败，服务端日志写出文件位置；用户修复或删除该文件后恢复。已在运行的项目代次不受影响。
- **按引用打开时项目未登记**：`unknown-project`；客户端握手得到 `project-unavailable`。
- **项目目录在运行中被移走或删除**：本合同不监视目录本身；项目实例里的插件按各自的合同处理文件错误。下次打开时目录校验不通过即 `create-failed`。
- **子进程创建失败、启动超时、启动中退出、实例启动失败**：都按 `create-failed` 收口，子进程不残留，诊断写明原因；同一项目可以再次尝试打开，得到新代次。
- **停止截止到达**：强制结束子进程，记为外部观察到的终止，不报为正常关闭。
- **服务端被强制结束**：项目子进程发现进程间链路断开后按停止序列自行退出；服务端不在时它不会继续运行。
- **作品信息修改失败**（planned）：按第 13 条的失败码；替换是原子的，身份文件不会被改坏。
- **新建失败**（planned）：按第 14 条分阶段的结果；结果未知时界面重新取书架，路径已在书架上就算成功。
- **移出被拒**（planned）：`project-running`，关掉全部窗口、等宽限期结束后再试。
- **统计记录坏了**（planned）：写入方以条件 `reset` 覆盖，原件进原件区；记录读不出的作品按 `none` 显示，别的作品不受影响。

## 边界与兼容

- **owner**：application-runtime（服务端宿主的项目管理器与项目宿主）；`nbook.projects`（界面与远程入口）。子实例与租约的机制归 runtime（[`runtime.application`](application.md)），绑定、`project-gone` 与 `{project}` 访问的协议归 [远程服务与 RPC 协议](plugin-channel.md)。
- **不加目录锁**：旧应用与早期设计里“防止两个服务端进程同时打开同一项目”的锁，保护的是项目实例独占的项目级持久数据。第一份这样的数据是 Storage 的项目分区：条件保存靠 SQLite 自己的锁，两个服务端进程同时打开同一项目时写入仍然正确，只是互相收不到对方写入的变更通知（[`storage.persistence`](../storage/persistence.md)）。以后的项目级数据同样优先用数据本身的机制（SQLite 的锁、库里的拥有者记录），不另加目录锁文件。同一个服务端进程里，多个窗口本来就共用同一个项目实例。
- **路径可见性**：用户登记的项目目录路径会经 `nbook.projects` 显示给用户，用来区分同名目录；状态根、安装目录等服务端内部路径不发给浏览器。第三方浏览器插件接入时，随 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 待定项 3 收紧 `nbook.projects/projects` 的调用方。
- **兼容**：身份文件与登记表带 `schema`，结构变化时提升；`.nbook/` 目录以后可能放其它文件，本能力只读写 `project.json`。项目子进程与服务端必须来自同一次构建（同一 Bun 可执行文件、同一产物目录）。
- **平台**：Bun 的进程间通信在 Windows 上未实测；macOS 未实测。

## 验收与 Smoke

1. **登记。** 登记一个临时目录：生成身份文件与短名，登记表多一项；同一目录再登记返回同一项；移动目录后再登记，id 与短名不变、路径更新；复制目录后登记副本得到 `identity-conflict`；已登记目录的身份文件被删后再登记按原 id 重建；状态根内部、不存在、不是目录的路径与无法解析的身份文件各得到对应原因。两个目录名相同的目录得到 `name` 与 `name-2`。
2. **打开。** 窗口以 `/?project=<短名>` 打开：项目子进程启动，窗口就绪后的绑定带项目代次，项目实例里的插件读到 `currentProjectKey`。
3. **共用。** 两个窗口打开同一项目：得到同一代次，各自的实例与订阅独立；关闭一个，另一个照常。
4. **宽限期内重连。** 掐断窗口的链路后在宽限期内恢复：同一代次，订阅重建并收到 `onResync`。
5. **超过宽限期。** 关闭全部窗口、宽限期满：子进程真实退出；之前断开的窗口重连得到 `project-gone`，窗口转入“项目已关闭”；再打开得到新代次。
6. **崩溃。** 子进程意外退出：这一代结束，租约的 `revoked` 触发，绑定的窗口转入“项目已关闭”；再打开得到新代次。
7. **无租约访问。** 服务端插件不取得租约调用 `running` 的项目：成功；项目处于 `idle-grace` 时同样的调用得到 `denied`，宽限期照常结束，项目没有被唤醒。
8. **租约归属。** 插件 A 经 `projectsKey` 取得的租约，只有 A 这次激活（直接或经代理）能用来访问 `{project}`；A 的入口停止后租约释放；别的插件持有不到它。
9. **启动失败收口。** 启动截止到达、启动中退出、实例启动失败三种情形都得到 `create-failed`，子进程不残留；停止时以非 0 退出码结束的子进程写 `project.stop.incomplete`。
10. **服务端停止。** 停止开始后新握手与新的打开都被拒；绑定进行中的窗口得到 `project-unavailable`、已取得的租约被释放；项目子进程先于服务端插件退出；超过停止截止的子进程被强制结束并记为外部终止。
11. **“打开项目”命令。** 命令列出已登记项目（短名、路径、是否运行）；选中后整页导航到 `/?project=<短名>`；输入新目录路径先登记再导航；工作台显示当前项目短名。
12. **打包产物。** 生产打包产物能起项目子进程：登记临时目录，经 RPC 绑定，项目实例报告自己的身份。
13. **作品信息。**（planned）修改书名、简介与主题色后读回；`null` 清除；不认识的字段与 `id` 保留；两个真实子进程分别改不同字段，两个字段都在；身份文件只读得到 `read-only`；符号链接的身份文件改的是目标、链接仍在；坏字段读取时被忽略并记诊断。
14. **新建。**（planned）没有作品目录得到 `no-library`；同名目录已存在得到 `exists`；身份文件写失败（父目录只读）时目录被删掉；登记失败时目录与身份文件保留，再登记该目录按幂等规则完成；成功后书架上有它。
15. **移出书架。**（planned）`running` 与 `idle-grace` 的项目被拒为 `project-running`；宽限期满后移出成功，登记表少一项、目录不动；移出与打开并发时，要么先打开（移出被拒）、要么先移出（打开得到 `unknown-project`），没有半状态。
16. **统计。**（planned）普通 `.md`、内容文件夹的 `index.md`、活页夹章节都计入，隐藏目录与非 `.md` 不计，读不出的文件计入 `unreadable`；扫描期间的修改、目录移入与删除、`resync` 都反映到结果里；最近编辑随改名跟到新地址、随删除清空、重开后沿用；23:59 写的字算当天，00:05 写的字算次日的首笔；当天重开沿用基线，离线跨日后以记录总数作基线。
17. **写入与停止。**（planned）两个写者冲突时较新的 `computedAt` 胜出；结果未知后重读核对；坏记录被条件 `reset`、原件在原件区；扫描未完成就停止不写记录，完成后停止写成并能在书架上看到。
18. **书架。**（planned）运行中的作品为 `fresh` 或 `counting`，停止后为 `stale` 并带统计时间，没有记录为 `none`；`idle-grace` 里按 `stale`；一部作品的身份文件损坏不影响别的作品；打包产物里 `nbook.projects` 的 `project` 入口随项目子进程启动，打开耗时与常驻内存按第 12 条重测。

Smoke：场景 1 由登记表与身份的合同测试在真实临时目录上运行；场景 2–10 由服务端宿主的合同测试以真实子进程与真实 WebSocket 运行（宽限期与截止用注入时钟或短参数）；场景 2–6、11 另在本机 Chrome 上由 `e2e/projects.e2e.ts` 运行；场景 12 由 `bun run smoke:server` 运行。场景 13–18（planned）由 `identity.test.ts`、`manager.test.ts`、`registry.test.ts`、`projects-capability.test.ts` 与统计的合同测试以真实临时目录、真实项目子进程与真实 Storage 运行，另在本机 Chrome 上由 `e2e/bookshelf.e2e.ts` 运行。

## 实现合同

- **公开入口**：`nbook/shared/projects`（宿主能力 `projectsKey` 与 `ProjectsService`、`ProjectLease`、`ProjectState`，项目实例里的 `currentProjectKey`，窗口里的 `windowProjectKey`）；`nbook/plugins/projects/shared/contracts`（远程合同 `projectsRemoteContract` 版本 2、`projectStatsRemoteContract`、`ShelfItemSchema` 与作品信息、统计快照的 schema、作品目录设置 `librarySetting`、命令 `OPEN_PROJECT_COMMAND`）、`nbook/plugins/projects/shared/stats-record`（`PROJECT_STATS_RECORD`）、`nbook/plugins/projects/shared/shelf`（界面类型与 `projectDisplayName`）；插件定义 `projectsBackendPlugin`、`projectsBrowserPlugin`。项目管理器（`createProjectManager`）与项目宿主是宿主内部，插件只经 `projectsKey` 使用。
- **owner 与依赖方向**：服务端宿主的项目管理器建在内核的子实例与租约（[`runtime.application`](application.md)）与远程路由之上，经 Bun IPC 连项目子进程；项目宿主（`src/project/`）在子进程里装配 `project` 位置的插件并给出 `currentProjectKey`。`nbook.projects` 后端依赖 `projectsKey`、配置（作品目录）、Storage（统计记录）与时钟（今天的日期），浏览器入口依赖命令面板的 `quickPickKey`、整页导航的宿主能力、配置、Storage（书架偏好）与时钟（刷新间隔）；宿主的共用代码不引用插件，`ProjectMetadata` 在 `nbook/shared/projects` 与合同的 schema 各有一份、形状相同。
- **关键不变量**：
  - 身份在项目目录的 `.nbook/project.json`，登记表在状态根；移动目录后 id 与短名不变，复制出的目录得到 `identity-conflict`（场景 1）。
  - 项目代次单调、不复用；`stopping` 中的项目不复活，等子进程真实退出后以新代次创建（场景 5、6）。
  - 无租约访问只对服务端插件与 `running` 的项目放行，`idle-grace` 时得到 `denied` 且不唤醒项目；租约只归取得它的那次激活，入口停止即释放（场景 7、8）。
  - 服务端停止时先封闭新握手与新的打开，项目子进程先于服务端插件退出，超过截止的强制结束并记为外部终止（场景 10）。

## 证据

- 批准依据：[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 2、3、4、8 节与第 11 节 K3 行，[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)（2026-10-07 `accepted`）；开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中确认：进程间通信用 Bun IPC、宽限期缺省 5 分钟且崩溃不自动重启、身份写在项目目录 `.nbook/project.json` 而登记表在状态根、短名登记后不变、不加防双开的锁、项目管理由宿主实现并以能力 `projectsKey` 提供、无租约访问只对服务端插件与 `running` 的项目放行、“打开项目”列表带项目目录路径；项目里的插件经宿主能力取项目目录依据 [ADR 0026](../../adr/0026-plugin-definitions-as-constants.md)（2026-10-08）。书架页的数据与操作（第 13–18 条）依据 [书架页](../../proposals/bookshelf.md)（2026-10-10 `accepted`），取舍见 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 2026-10-10 的 t75 条目（按推荐先做，待开发者追认）。
- 实现入口：[`manager.ts`](../../../packages/neuro-book/src/server/projects/manager.ts)（另有同目录的 `registry.ts`、`identity.ts`、`ipc.ts`）、[`project/start.ts`](../../../packages/neuro-book/src/project/start.ts)、[`projects/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/projects/backend/plugin.ts)、[`projects/web/plugin.ts`](../../../packages/neuro-book/src/plugins/projects/web/plugin.ts)、[`shared/projects.ts`](../../../packages/neuro-book/src/shared/projects.ts)
- 合同测试：[`registry.test.ts`](../../../packages/neuro-book/src/server/projects/registry.test.ts)（场景 1）、[`manager.test.ts`](../../../packages/neuro-book/src/server/projects/manager.test.ts)、[`projects-capability.test.ts`](../../../packages/neuro-book/src/server/projects/projects-capability.test.ts)、[`server-projects.test.ts`](../../../packages/neuro-book/src/server/server-projects.test.ts)、[`window.test.ts`](../../../packages/neuro-book/src/web/host/window.test.ts)（场景 2–10）、[`projects.test.ts`](../../../packages/neuro-book/src/plugins/projects/projects.test.ts)（场景 11）
- Smoke：[`projects.e2e.ts`](../../../packages/neuro-book/e2e/projects.e2e.ts)（场景 2–6、11）、[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（场景 12，S7）；实测见输出第 12 条
