# t75 实施计划：书架页（书房）

## Context

- **为什么做**：新应用没打开项目时只有一个空工作台：用户不知道该做什么，看不到已有作品，也没有新建入口。开发者 2026-10-10 同意提案 [书架页](../../../../../docs/proposals/bookshelf.md) 的全部推荐：
  - “书房”方向：上半继续写作，下半书脊书架，另有列表视图；
  - 新作品默认放在用户设置的作品目录下，首次新建时询问并记住；
  - 第一版只显示今天与总字数；不做封面图；
  - Lab 静态稿作为实施的第一片（S1 已完成）。
- **必须回答的审查条目**：
  - 提案的合同缺口 P10–P14、F06、F07（t73 计划审查），见“合同的回答”；
  - 本计划的 omp 审查（[报告](evidences/plan-review.txt)）18 条，阻断 2 条，处理见“计划审查的处理”；
  - 修订后的 fable 复核（[报告](evidences/plan-rereview.txt)）7 条必须先改与 6 条建议，处理见同一节的 R 编号。
- **现状**：
  - `nbook.projects` 的远程合同只有 `list`、`register`；身份文件只独占创建 `{schema, id}`；登记表只有登记与路径更新；
  - `/` 是工作台自带的首页；
  - t74 已提供共享的 `countWords`（`src/shared/word-count.ts`）、宿主端口 `openExternal`、标题栏条目贡献点。
- **工作方式**：
  - worktree `.worktree/w00017-runtime-foundation`；每片自跑验证后单独提交、推送备份；
  - 测试用真实内核、真实临时目录、真实项目子进程与真实 Chrome，不用 mock、spy、假计时器、固定等待，时间用注入时钟；
  - 新组件带同名 `.md` 与 Lab 场景。
  - 按开发者 2026-10-10 定的并行做法，服务端两片（S2、S3）派给编码子代理，在独立 worktree 里做；主会话同时做页面两片（S4、S5），合同以 S0 交付的 Spec 与 `src/plugins/projects/shared/` 里的 TypeBox 合同为准（见“切片”的 S0 交付物）。

## 合同的回答

### 作品名（P14 与审查 P14）

- **书名**写在 `.nbook/project.json` 的可选字段 `title`；没有时显示登记表的短名。显示名一律经 `projectDisplayName`（`shared/shelf.ts`）。
- **短名**不变，仍是地址栏的句柄。
- **不改握手**：窗口绑定仍是 `{id, name, generation}`，不升 wire 版本。已打开窗口的标题栏显示短名；书名显示在书架与“打开项目”的列表里（它们经 `nbook.projects` 的业务合同取数）。书名同步到已打开窗口的标题栏另立后续。
- “打开项目”的列表改用书架的数据：显示名、路径、是否打开。标题栏的项目切换点开的就是它，这就是“共用一份列表”。

### 身份文件的元数据（P11，审查 P2、P3）

- **格式**：仍为 `schema: 1`，增加可选字段：
  - `title`：1 到 80 字；
  - `description`：0 到 500 字；
  - `color`：`#rrggbb`。
  - 旧的读取只看 `schema` 与 `id`，会忽略新字段，所以不升 schema。新字段不合规时，读取把该字段当作没有并记诊断，身份照常可用。
- **写入**：复用 `src/backend/locked-replace.ts` 的 `replaceLocked`。
  - 跨进程写入锁 `.nbook/locks/project.json.lock`（与 Files 的 `.nbook/locks/files` 不冲突）；`replaceLocked` 要求锁的父目录已存在，先建 `.nbook/locks/`。临时文件落在 `.nbook/` 内，文件监视器忽略，不触发统计；
  - 在锁内按当前字节解析，核对 `id` 与登记表一致（不一致为 `identity-conflict`）；
  - 只改给出的字段（省略不动，`null` 清除），保留 `id` 与不认识的字段；
  - 改名前核对文件身份，变了从新字节重做；临时文件沿用权限位；文件只读为 `read-only`。
  - 身份文件是符号链接时先解析到最终目标再替换（链接保留），悬空链接为 `identity-invalid`。
- **失败码**：`unknown-project`、`identity-invalid`、`identity-conflict`、`invalid-metadata`（带字段名）、`read-only`、`write-failed`。

### 统计（P12、P13、F06，审查 P1、P4–P7、P12、P13）

- **口径**：
  - 计入项目里所有非隐藏的 `.md` 文件（名字以 `.` 开头的目录与文件不计，含 `.nbook/`）。内容文件夹的 `index.md` 与活页夹的章节都是 `.md`，自然计入；清单是 XML，不计。
  - 字数用共享的 `countWords`。
  - “篇”是计入的文件数。书架上写“N 篇”，不叫“章”：章的编排随剧情插件。
- **计算者**：`nbook.projects` 新增的 `project` 位置入口 `stats`（`onStartup`，项目一打开就开始统计）。
  - 装配：`nbook.projects` 的 `locations` 加 `project`，`src/project/plugins.ts` 的定义表加它。
  - 它在项目实例里直接读项目目录（`currentProjectKey.root`），并订阅 `nbook.files/project` 的变更（同实例调用，走本地路径，不序列化）。
  - **初始状态**：以记录为初值。首扫完成前 `current` 报 `counting` 并给出记录里的快照；今天的基线与最近编辑沿用记录，首扫时核对最近编辑的文件还在，不在就清空。没有记录时从空开始。
  - **启动顺序**：先订阅变更、把事件缓冲起来，再扫描；扫完后按顺序结算缓冲的事件。
  - **事件分类**：`FileChange` 只有 `type/path/source`，不带种类。判据：路径是已计入的文件按文件处理；是已计入文件的上级目录按目录处理；都不是时 `lstat` 一次。文件就重读这个文件；目录（新建、移入、复制、删除、改名）或 `resync` 时标记需要重扫。同一时间至多一次扫描在跑，另外至多排一次。
  - 订阅 `ended`（根目录不在、提供方停止）后不再更新，`current` 报不新鲜，书架按 `stale` 呈现。
  - **扫描**：并发读至多 4 个文件；每读完一批让出一次执行权；正文读完只留字数与最后一段，不留全文。
  - 读不出的文件（权限、编码、过大）计入 `unreadable`，不按 0 字计。
- **今天**：按服务端所在机器的本地日期。
  - 运行中，跨午夜时由时钟定时先把基线换成当时的总字数，再计入之后的变化。
  - 项目打开时，记录里的日期是今天就沿用记录的基线；不是今天时，基线取记录里的总字数，离线期间外部修改的增量因此算进打开当天，Spec 写明。
  - 从没统计过的作品，第一次扫描完成时的总字数就是基线（扫描本身不算今天写的）。
- **最近编辑**：只由观察到的文件修改更新（经文件服务保存或外部修改都算），记地址、片段名、时间与该文件最后一个非空段落的前 120 字（去掉 Markdown 标记前缀；frontmatter 不算段落）。片段名第一版取文件名去掉扩展名（tracker 直接读目录，拿不到清单标题）。
  - 改名时跟到新地址；删除时清空。
  - 扫描不设最近编辑：Files 合同不给修改时间，不猜。重开后沿用记录里的最近编辑（见“初始状态”）。
- **持久化**：user 分区记录 `nbook.projects` / `project-stats`（`keyed: true`，资源 id 是项目 id，`locality: shared`）。记录定义放在 `src/plugins/projects/shared/stats-record.ts`：服务端的 `shelf` 读停止项目的记录也用它（`docs/specs/storage/persistence.md` 要求三端共用同一份定义）。
  - 值：快照 `{computedAt, words, files, unreadable, today: {date, baseline}, last}`（schema `ProjectStatsSnapshotSchema`；版本由记录定义带，记录里只有完整的快照，不另存 `complete`）。
  - 写入合并：变化后最多每 30 秒写一次。
  - **停止时的最后一次写入**：放在入口 `context.scope.register` 的资源释放里。依赖的 Storage 门面在入口登记的资源释放之后才释放，Storage 的代理调用不挂入口停止信号，所以这里还能写（`docs/specs/runtime/plugins.md` 输出 13）。此时 Files 订阅已经断开：
    - 整轮扫描还没完成：取消它，不写，保留旧记录；
    - 扫描已完成：在途的单文件重读至多再等 1 秒（注入时钟），然后用已有的值写一次。下次打开会重扫，这份记录只用于停止时的书架。
  - **写入协议**：按 revision 条件保存。
    - 冲突时重读：存着的 `computedAt` 晚于自己的就放弃这次写入，否则以新 revision 重写。
    - `unknown-outcome` 重读后按同样规则核对。
    - `busy`、`io-error`：保留旧记录、记诊断，下一轮再写。
    - `corrupt`、`unsupported-version` 用条件 `reset` 覆盖：它是可重算的缓存，原件进原件区并记诊断；原件区满时放弃写入，记诊断。
    - 两个服务端进程打开同一作品时，后完成计算的胜出。
- **新鲜度**：服务端的 `shelf` 对每部作品：
  - 项目正在运行：经 `{project}` 目标调用项目实例的远程服务 `nbook.projects/stats` 取实时状态。服务端插件对运行中的项目可以无租约访问，访问本身不打开项目、不续宽限期。
    - 扫描完成为 `fresh`；
    - 还在扫描为 `counting`，显示上次的快照与“正在统计”；
    - 调用失败时退回记录，按 `stale` 显示。
  - 项目处于 `idle-grace`：服务端对这一代的无租约访问被拒（`src/server/projects/manager.ts` 的 `{project}` 访问规则），读记录，按 `stale` 呈现；记录最多比实际旧 30 秒（写入合并的间隔），Spec 写明。
  - 项目没在运行：读记录，为 `stale`，显示“统计于某时”。记录里有 `unreadable` 时另写“有 N 个文件读不出”。
  - 没有记录：`none`。
  - 一部作品取数失败不影响别的作品。

### 继续写作（P10、F07）

- **目标**：最近编辑的那个文件的末尾。“末尾”是稳定的位置；书架展示的片段也取自末尾，两者一致。
- **跨页传递**：“继续写作”整页导航到 `/?project=<短名>&open=<地址>&at=end`（经 `URLSearchParams` 编码）。编辑器插件读到参数后：
  - 立即用 `replace` 去掉这两个参数：刷新不会重复执行，失败也不会反复出现；
  - 地址必须是 `project://` 下的资源，否则只提示、不打开；
  - 等编辑器区建好（会话记录读完）后打开该地址（正式标签），记下这个标签。`area.open` 现在只返回 `{ok}`，改为成功时也给出标签 id；
  - 等到这个标签的文档就绪、它所在组的控件交出句柄，再调 `revealEnd`。这是一个可取消的过程：用户在此之前切到别的标签或组、窗口停止时取消，迟到的就绪不再移动光标与焦点；
  - 文档读取失败或文件不在时，在组顶部提示，不猜别的文件。
- **控件能力**：`EditorControlHandle` 增加可选的 `revealEnd()`：源码编辑器定位到最后一行行尾；Markdown 编辑器把选区放到文档末尾。
- `nbook.editor.open` 增加可选参数 `reveal: "end"`，地址参数与以后的 Agent 调用走同一条路径。
- **失败时**：文件已移动或删除时，组顶部提示“上次编辑的片段已不在原处”，项目照常打开，不猜测别的文件；控件不支持 `revealEnd` 时只打开文件。

### 新建、修改信息与移出书架（审查 P8–P10）

- **新建** `create {title, description?, parent?}`：
  - `parent` 省略时用作品目录设置 `nbook.projects/library`；两者都没有为 `no-library`。
  - 目录名由书名生成：
    - `/ \ : * ? " < > |` 与控制字符换成 `-`，去掉首尾空白与句点，至多 80 个字符；
    - 结果为空，或是 `.`、`..`、Windows 保留名时用“作品”。
  - 校验父目录：存在、是目录、可写、不在状态根之内；解析符号链接后再判断。
  - 分阶段执行：
    1. 排他新建目录：已存在为 `exists`，带路径，界面提示改书名或用“加入已有目录”；
    2. 写身份文件（含书名与简介）：失败时，若目录里只有本次写的东西就删掉目录，结果为 `write-failed`；
    3. 登记：失败时保留目录与身份文件，结果为 `register-failed`，带路径；“加入已有目录”按登记的幂等规则可以接着完成。
  - 结果未知时，界面重新取书架：路径已在书架上就算成功。
- **作品目录**：首次新建时经命令面板的路径输入（与“打开项目”同一种输入，标明是服务端上的路径）。新建成功后才写进设置；设置写失败单独提示，作品照常建成。
- **修改信息** `update {id, title?, description?, color?}`：见“身份文件的元数据”。
- **移出书架** `unregister {id}`：只改登记表。
  - 项目管理器按项目 id 把它和“打开”串行化：写表完成前不接纳同一 id 的打开。
  - 项目不在 `stopped`（`starting`、`running`、`idle-grace`、`stopping`）时拒绝为 `project-running`；关掉全部窗口后还有 5 分钟宽限期，界面写明。
  - 保证只限本服务端进程管理的代次，不声称全局停止。
- 远程合同 `nbook.projects/projects` 升到 `version: 2`，新增方法 `shelf`、`create`、`update`、`unregister`。旧页面调用时得到 `version-changed`，按现有规则提示刷新。

### 首页贡献点（审查 P15）

- 工作台新增贡献点 `workbench.home`，由 `nbook.workbench` 拥有并校验：
  - 声明 `{title}`，实现 `{load(): Promise<Component>}`；
  - 校验与 `ItemRegistry` 同一做法：workbench 激活时经 `context.declarations.list` 取声明（`src/plugins/workbench/web/plugin.ts`）；
  - 按已接受的声明数量裁决：0 个时显示空工作台；1 个时采用；多个时全部不采用，按 id 排序记诊断。结果与登记顺序无关。
- 没有绑定项目的窗口，`/` 页仍由工作台的首页组件渲染，文档根（主题、语言）与命令宿主照常挂着，只把外壳换成首页贡献的内容。
  - 每次渲染经当前句柄取实现；书架页不调 `layout.acquire()`（`home-page.ts` 的约定：只有外壳占用布局）；
  - 贡献撤回、入口停止、加载失败时退回空工作台并记诊断；入口恢复后再次采用。
- `/workbench` 是工作台的第二个内置页面：不打开作品、直接进入空工作台（用户资产）。书架上有入口。
- 绑定了项目的窗口不受影响：绑定由 `?project=` 决定、不看路径（`src/web/boot.ts`），所以 `/workbench?project=x` 与 `/?project=x` 相同，都是那部作品的工作台。

### 书架页的数据与交互（审查 P17、P18）

- 页面经 `shelf` 一次取得全部作品。
  - 刷新只在页面可见时进行：每 30 秒一次，窗口重新获得焦点时也刷新，两者合并。同一时间至多一个请求在途，迟到的旧响应丢弃。
  - 刷新失败保留上次的数据，顶部提示“书架没有更新”并带重试；只有第一次取数失败才显示整页出错。
- 列表视图与扉页一样显示新鲜度（`stale` 写“统计于某时”，`counting` 写“正在统计”）。
- 扉页跟随书架的选中项（点书脊或键盘移动），不随悬停变化。Enter 打开；Delete 请求移出书架。
- 移出书架后选中下一部（没有时上一部），焦点回到书架；书架空了时焦点到“新建作品”。

## 计划审查的处理

| 编号 | 结论 | 处理 |
|---|---|---|
| P1 内容文件夹被排除 | 成立 | 计入所有非隐藏的 `.md` |
| P2 元数据后写覆盖不同字段 | 成立 | 复用 `replaceLocked`，锁内按当前字节只改给出的字段 |
| P3 改名的只读、权限与链接 | 成立 | `replaceLocked` 已处理只读与权限；链接先解析到最终目标 |
| P4 统计写入与条件保存不相容（阻断） | 成立 | 写入协议：条件保存，冲突重读、较新的胜出，结果未知重读核对，坏记录条件 reset |
| P5 运行不等于新鲜 | 成立 | 运行中的作品经 `{project}` 目标问项目实例要实时状态；`counting`、`unreadable` 分开呈现 |
| P6 跨日首笔被吞 | 成立 | 午夜定时先换基线；打开时按记录日期沿用或取记录总数；离线增量算进打开当天，Spec 写明 |
| P7 最近编辑无时间来源、扫描与订阅无顺序 | 成立 | 先订阅缓冲再扫描；最近编辑只认本次观察到的修改；目录事件与 resync 触发重扫；删除清空、改名跟随 |
| P8 新建的目录命名与半成功 | 成立 | 目录名规则、父目录校验、分阶段结果与只删自己建的空目录 |
| P9 选作品目录的端口不存在 | 成立 | 用命令面板的路径输入；新建成功后才记住，设置写失败单独提示 |
| P10 移除与打开没有原子边界 | 成立 | 项目管理器按 id 串行化；拒绝包含宽限期等四种状态；保证限本进程 |
| P11 字数两套、项目切换无负责人 | 成立 | 用 t74 的 `countWords`；“打开项目”列表改用书架数据，标题栏的项目切换点开的就是它 |
| P12 资源上限 | 成立 | 并发 4、按批让出、单轮扫描加至多一次排队、读完即丢正文；S3 用 t72 的约 3000 个文件样本测打开耗时与内存 |
| P13 停止时最后一次写入 | 成立 | 停止时先取消扫描与读取，在 Storage 门面释放前只写完整的快照；不完整就不写，保留旧记录 |
| P14 握手加书名破坏协议（阻断） | 成立 | 不改握手；已打开窗口显示短名，书名同步到标题栏另立后续 |
| P15 首页贡献点的寿命与冲突 | 成立 | 见“首页贡献点” |
| P17 静态稿的键盘与扉页 | 成立 | 扉页跟随选中，不跟随悬停；去掉计划里的空格与 F2；补移出后的焦点 |
| P18 窄屏隐藏新鲜度、刷新失败 | 成立 | 列表显示新鲜度；刷新失败保留数据并提示 |
| P16 继续写作把“打开标签”当作“正文就绪” | 成立 | 定位是一个可取消的过程：等标签的文档就绪与控件句柄，用户切走或窗口停止时取消；参数一读到就去掉；只接受 `project://` 地址；e2e 覆盖慢读、文件不在、Markdown 与源码、用户切走 |
| F1 按统计状态筛选 | 不做 | 第一版作品数不多，排序已够；以后作品多了再加 |
| F2 继续写作失败的恢复入口 | 采纳 | 失败时项目照常打开并提示，见“继续写作” |
| R1 S0 交付物不具体，S2 与 S4 互相阻塞 | 成立 | S0 交付完整的 TypeBox 合同、`shelf.ts` 的新状态、统计记录定义与首页贡献点常量，都在 `shared/`；S4 先跑 Vitest，e2e 等 S2、S3 合入后跑 |
| R2 最近编辑在重开后消失 | 成立 | tracker 以记录为初值，首扫核对最近编辑的文件还在 |
| R3 停止时最后一次写入放在哪 | 成立 | 放在入口登记的资源释放里；只取消整轮扫描，在途的单文件重读有界等待后写 |
| R4 关窗后的新鲜度不可判定 | 成立 | `idle-grace` 按 `stale` 呈现、最多旧 30 秒，Spec 写明；e2e 用短宽限期，等书架报告作品已停止再看字数（停止时写入最后一次），不加新的启动参数 |
| R5 变更事件没有种类、`ended` 未处理 | 成立 | 按已计文件、上级目录、`lstat` 依次判定；`ended` 后不再更新，按 `stale` 呈现 |
| R6 项目实例装配未列入 | 成立 | S3 加 `locations: project`、项目定义表、`onStartup`；按 `runtime/projects.md` 输出 12 重测打开耗时与常驻内存 |
| R7 既有测试被“`/` 改成书架”打破 | 成立 | S4 把 `window.test.ts` 与以无项目打开外壳的 6 个 e2e 文件迁到 `/workbench` |
| R8 建议：`/workbench?project=x`、`area.open` 返回标签 id、片段名来源、锁目录、`busy` 与 `io-error`、首页声明的取法 | 采纳 | 分别写进对应小节 |

## 关键设计

### 1. 项目合同（`src/server/projects/`、`src/shared/projects.ts`、`src/plugins/projects/shared/`）

- `identity.ts`：
  - `readProjectIdentity` 返回 `{id, metadata}`；新字段不合规时去掉并带诊断；
  - 新增 `updateProjectMetadata(path, expectedId, patch)`（经 `replaceLocked`）；
  - 新增 `createProjectDirectory(parent, metadata)`，规则见“新建”。
- `registry.ts`：新增 `unregister(id)`。
- 项目管理器（`manager.ts`）与 `projectsKey`：
  - 新增 `create`、`updateMetadata`、`unregister`；
  - 按项目 id 的串行队列，覆盖“打开的解析与进入 starting”和“移除的检查与写表”。
- 远程合同 `nbook.projects/projects` v2：`shelf`、`create`、`update`、`unregister`；`ShelfItem` 的 schema 与作品信息、统计快照的 schema 都在 `shared/contracts.ts`，`shared/shelf.ts` 只转发类型并保留 `projectDisplayName`；`ShelfFreshness` 增加 `counting`，`ShelfStats` 增加 `unreadable`。S0 写出合同本身（方法、输入输出、错误码），S2 只实现。
  - 远程实现必须给全合同的方法，所以 S0 把现有的 v1 留作 `projectsRemoteContractV1`（服务端入口、“打开项目”与 `projects.test.ts` 暂用它），最终名 `projectsRemoteContract` 直接是 v2，S4 的新代码从一开始就用最终名。S2 让服务端入口改提供 v2、把这三处改回最终名并删除 V1；S4 在 S2 合入前不碰这三个文件。
- 新的远程合同 `nbook.projects/stats`：提供方 `project`，调用方 `server`，方法 `current` 返回本项目实例的统计状态。也在 S0 写出。

### 2. 统计（`src/plugins/projects/project/`、`src/plugins/projects/shared/stats-record.ts`）

- `stats-tracker.ts`：扫描、事件缓冲与结算、每个文件的字数表、今天的基线、最近编辑、写入合并与停止。时钟用 `clockKey`，测试用注入时钟。
- `shared/stats-record.ts`（S0 写出定义）：记录的 schema 与版本；写入协议在 `project/stats-writer.ts`。
- `plugin.ts` 的 `project` 入口：建 tracker，提供 `nbook.projects/stats`；`src/project/plugins.ts` 的定义表加 `nbook.projects`。

### 3. 首页（`src/plugins/workbench/`）

- `shared/contracts.ts`：`WORKBENCH_HOME_POINT` 与声明校验。
- `web/home-page.ts`：首页组件在没有项目时渲染首页贡献的内容；`PageTable` 增加 `/workbench`。
- 既有测试迁移：`src/web/host/window.test.ts` 里“页面表只有 `/`”的断言；以无项目打开 `server.url` 并期待外壳的 e2e（`workbench-shell`、`workbench-dnd`、`workbench-views`、`commands`、`state`、`projects`）改开 `/workbench`。

### 4. 书架页（`src/plugins/projects/web/`）

- S1 的组件接上真实数据：`shelf-page.ts` 负责取数、刷新、新建、修改信息与移出书架，并处理确认与对话框；`ProjectInfoDialog.vue` 供新建与编辑信息共用。
- “打开项目”的选择列表改用 `shelf` 数据（显示名、路径、是否打开）。
- 浏览器入口贡献 `workbench.home`。

### 5. 继续写作（`src/plugins/editor/web/`）

- `nbook.editor.open` 的 `reveal: "end"`；`area.open` 成功时返回标签 id；两种控件的 `revealEnd`；编辑器区就绪后读地址参数、执行、去掉参数；失败提示。

## Spec 与文档改动（S0）

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/projects.md` | 非目标删去“书架页、新建、移除登记、重命名”；身份文件的可选元数据与更新规则；新建、修改信息、移出书架的输入、失败码与验收；`shelf` 与新鲜度；`nbook.projects/stats`；统计的口径、计算者、今天、最近编辑、持久化与写入协议 |
| 新建 `docs/specs/workbench/bookshelf.md` | 书架页：两种视图、继续写作、扉页与操作、键盘与焦点、窄屏、空书架、新鲜度呈现、刷新与失败、新建与作品目录、验收 |
| `docs/specs/ui/workbench-shell.md` | `workbench.home` 贡献点与 `/workbench` |
| `docs/specs/workbench/editor.md` | `nbook.editor.open` 的 `reveal: "end"`；控件的 `revealEnd`；地址参数 `open`、`at` |
| `docs/specs/README.md` | 登记新 Spec |
| `docs/proposals/bookshelf.md` | `status: accepted`，填上 `specs` |

## 切片

| 片 | 内容 | 谁做 | 自跑验证 |
|---|---|---|---|
| S1 | Lab 静态稿（已完成） | 主会话 | — |
| S0 | 上表 Spec；`src/plugins/projects/shared/` 里两份远程合同的完整 TypeBox 定义（方法、输入输出、错误码）、`shelf.ts` 的 `counting` 与 `unreadable`、`stats-record.ts` 的记录定义；工作台 `WORKBENCH_HOME_POINT` 与声明校验 | 主会话 | `docs:check`、`governance:check`、typecheck |
| S2 | 身份文件元数据、新建、修改、移出书架、`projectsKey`、远程合同 v2 的实现 | 编码子代理 | `identity.test.ts`、`registry.test.ts`、`manager.test.ts`、`projects-capability.test.ts`（真实临时目录与子进程） |
| S3 | 统计：tracker、写入协议、`project` 入口与装配、`nbook.projects/stats`、`shelf` 的新鲜度 | 编码子代理（S2 之后） | Bun：口径、事件顺序、跨日、停止、写入冲突、真实项目子进程；`scripts/measure-project.ts` 重测打开耗时与常驻内存，t72 样本测打开时的统计耗时与内存 |
| S4 | `workbench.home`、`/workbench`、既有测试迁到 `/workbench`、书架页接真实数据、新建与编辑信息、移出书架、“打开项目”列表 | 主会话（与 S2、S3 并行，接口以 S0 为准） | 先 Vitest 与工作台 Bun 测试；`e2e/bookshelf.e2e.ts` 等 S2、S3 合入后跑 |
| S5 | 继续写作 | 主会话 | 编辑器 Bun 与 Vitest；`bookshelf.e2e.ts` 补继续写作（S2、S3 合入后） |
| S6 | 合并、证据、omp 实现审查（不阻塞）、全量 e2e | 主会话 | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 元数据读写保留 `id` 与未知字段、坏字段降级、只读与链接、两个进程分别改不同字段都保留 | `identity.test.ts`（两个真实子进程写同一文件） |
| 新建：没有作品目录、目录已存在、身份写失败删掉空目录、登记失败保留并可加入 | `projects-capability.test.ts`、e2e |
| 移出书架：运行中与宽限期被拒、和打开并发时不出现半状态、停止后登记表少一项、目录不动 | `manager.test.ts`、`registry.test.ts`、e2e |
| 统计口径（普通文件、内容节点正文、活页夹章节、隐藏目录、读不出的文件） | `stats-tracker.test.ts` |
| 事件顺序（扫描期间的修改、目录移入与删除、resync）、最近编辑的改名与删除 | `stats-tracker.test.ts`（真实文件与变更流） |
| 今天：23:59 到 00:05 的首笔、当天重开、无变化跨午夜、离线跨日 | `stats-tracker.test.ts`（注入时钟） |
| 写入协议：两个写者冲突、结果未知、坏记录 | `stats-record.test.ts`（真实 Storage） |
| 停止：扫描未完成不写、完整时在门面释放前写成 | 真实项目子进程的 Bun 测试 |
| 新鲜度：运行中为 fresh 或 counting，停止后为 stale，没有记录为 none；单项失败不影响别的作品 | 真实项目子进程的 Bun 测试与 e2e |
| 没有项目时 `/` 是书架，主题与命令面板照常；`/workbench` 是空工作台；首页贡献两个时都不采用 | 工作台 Bun 测试与 e2e |
| 书脊键盘、扉页跟随选中、移出后的焦点、窄屏列表的新鲜度、刷新失败保留数据 | Vitest 与 e2e |
| 继续写作：打开并定位到末尾、刷新不重复、文件不在时提示、等待中切走不抢焦点 | 编辑器 Bun 测试（真实 Files 场地、扣住读取）与 `bookshelf.e2e.ts`（Markdown 与源码两种文件） |

## 验证

- 每片自跑上表命令；收口跑 `test:affected --typecheck`、全量 `bun run test:e2e`、`docs:check`、`governance:check`。
- 端到端用真实服务端与项目子进程（短宽限期，与 `projects.e2e.ts` 相同做法）：
  - 登记两个临时项目，打开其中一个写入文字后关闭；
  - 回到 `/`，等书架报告这部作品已停止（停止时写入最后一次统计），再看字数、片段与新鲜度；
  - 点“继续写作”，回到那个文件的末尾并能接着输入。
- 未验证的边界：Windows 与 macOS 的目录新建、权限与保留名。

## 不做

- 封面图、按天的写作量细条、云同步。
- 删除作品目录（只移出书架）。
- 书名同步到已打开窗口的标题栏。
- 活页夹的章编排与“章”的概念（随剧情插件）。
- 按统计状态筛选。

## 风险

- 统计扫描与编辑保存争同一项目进程的 CPU 与 I/O：S3 用 t72 的样本测打开耗时、内存与输入保存的延迟，超出 t72 的结果 20% 就先调并发与批量再继续。
- 子代理与主会话并行：只在 S0 定好合同后开始；合入时由主会话审查 diff、自己跑验证。
