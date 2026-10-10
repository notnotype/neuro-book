# t75 实施计划：书架页（书房）

## Context

- **为什么做**：新应用没打开项目时只有一个空工作台，用户不知道该做什么、看不到已有作品、没有新建入口。开发者 2026-10-10 同意提案 [书架页](../../../../../docs/proposals/bookshelf.md) 的全部推荐：
  - “书房”方向：上半继续写作，下半书脊书架，另有列表视图；
  - 新作品默认放在用户设置的作品目录下，首次新建时询问并记住；
  - 第一版只显示今天与总字数；不做封面图。
  - Lab 静态稿作为实施的第一片。
- **必须回答的审查条目**（t73 计划审查，[报告](../t73-lab-nb-ui-and-storage/evidences/design-review.txt)）：P10 继续写作的定位、P11 `project.json` 的更新、P12 统计的读写、P13 统计口径与新鲜度、P14 作品名的单一来源，F06 新鲜度呈现、F07 继续写作失败时可恢复。逐条见下面“审查条目的回答”。
- **现状**：
  - `nbook.projects` 远程合同只有 `list`、`register`（`src/plugins/projects/shared/contracts.ts`）；
  - 身份文件只独占创建 `{schema: 1, id}`（`src/server/projects/identity.ts`）；
  - 登记表只有登记与路径更新（`src/server/projects/registry.ts`）；
  - `/` 是工作台自带的首页（`src/plugins/workbench/web/plugin.ts` 的 `PageTable`）。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`；每片自跑验证后单独提交、推送备份；测试用真实内核、真实临时目录、真实项目子进程与真实 Chrome，不用 mock、spy、假计时器、固定等待，时间用注入时钟；新组件带同名 `.md` 与 Lab 场景。

## 审查条目的回答

### P14：作品名的单一来源

- **书名**写在 `.nbook/project.json` 的可选字段 `title`；没有时显示登记表的短名。
- **短名**不变，仍是地址栏的句柄（`/?project=<短名>`），不随书名改。
- `ProjectView` 增加 `title: string | null`。显示名一律是 `title ?? name`，由一个共享函数 `projectDisplayName` 给出，书架、t74 的项目切换与窗口绑定都用它。
- 窗口绑定结果（`WindowProject.project`、`CurrentProject`）增加 `title`，在握手或项目实例启动时读一次。
- 改名后已打开的窗口不即时刷新，下次加载时显示新名，Spec 写明。理由：改名只能在书架上做（没有项目的窗口），已打开的项目窗口同时存在的情况少。

### P11：`project.json` 的更新

- **格式**：仍为 `schema: 1`，增加可选字段 `title`（1–80 字）、`description`（0–500 字）、`color`（`#rrggbb`）。
  - 旧的读取只看 `schema` 与 `id`，会忽略新字段，所以不升 schema。
  - 新字段不合规时，读取把该字段当作没有并记诊断，不让整个项目失效；身份照常可用。
- **写入**：`updateProjectMetadata(path, expectedId, patch)`，先读后写：
  - 读当前文件，核对 `id` 与登记表一致，不一致为 `identity-conflict`；
  - 只改给出的字段，保留 `id` 与不认识的字段；写临时文件后改名替换；
  - 进程内按项目串行（与登记共用一个队列）；
  - 跨进程不加锁，后写的整份文件胜出。两个服务端进程同时编辑同一作品的信息是罕见情形，最坏结果是后写者覆盖前写者对同一份文件的修改，`id` 不会丢，因为每次都按读到的内容写回。Spec 写明。
- **失败码**：`unknown-project`、`identity-invalid`、`identity-conflict`、`invalid-metadata`（字段不合规，带字段名）、`write-failed`。

### P12 与 P13：统计的口径、所有权与读取

- **口径**（写进 Spec，第一版）：
  - **计入的文件**：项目目录里的 `.md` 文件。不计：隐藏目录与文件（名字以 `.` 开头，含 `.nbook/`）、内容文件夹（`*.content/`）里的文件（那是设定与资料，不是正文）、清单文件。活页夹（`*.binder/`）里的章节文件是 `.md`，自然计入。
  - **字数**：汉字、假名、谚文每字计 1；连续的拉丁字母与数字（中间可含 `'`、`’`、`-`）计 1 个词；标点、空白与 Markdown 标记不计；开头的 YAML frontmatter 不计。
  - **篇数**：计入的文件数。书架上显示“N 篇”，不叫“章”：活页夹的章节编排随剧情插件，第一版说不出哪些是章。
  - **今天**：服务端所在机器的本地日期。今天字数是当前总字数减去今天第一次统计时的总字数（净增，可为负，显示为 0 以下时写“今天 −120 字”）。跨午夜后第一次统计时换基线。
  - **最近编辑**：最近一次被计入的文件发生变化（经文件服务保存或外部修改都算）的地址、时间，以及该文件最后一个非空段落的前 120 个字。
- **所有权**：统计由 `nbook.projects` 新增的 `project` 位置入口计算并写入。
  - 它经文件服务的远程合同 `nbook.files/project` 读文件、订阅变更（调用方允许 `project`，同实例调用不序列化），不另开文件监视。启动后先在后台扫描一遍，之后只重读变化的文件，保留每个文件的字数；变更流推 `resync` 时重扫；
  - 写进 user 分区的记录 `nbook.projects` / `project-stats`（`keyed: true`，资源 id 是项目 id，`locality: shared`）；
  - 写入合并：变化后最多每 30 秒写一次；入口停止时（项目关闭）写最后一次；
  - 每次写入都带计算时间与项目代次。同一项目只有一个运行代次，所以只有一个写入者；两个服务端进程打开同一项目时后写者胜出，Spec 写明。
- **读取**：书架经 `nbook.projects/projects` 的新方法 `shelf` 一次取得全部作品：登记项、元数据与统计摘要。
  - 服务端入口在本进程里读身份文件与记录，不为统计启动项目，不让浏览器逐个打开记录。
  - 摘要带新鲜度（F06）：
    - `fresh`：项目正在运行，统计随写入更新；
    - `stale`：项目未运行，显示“统计于某时刻”；
    - `none`：从没统计过，显示“尚未统计”。
  - 项目上一代次异常退出时，记录里的时间早于退出时间，显示为 `stale`，说明“下次打开时更新”。

### P10 与 F07：继续写作的定位

- **目标**：最近编辑的那个文件的末尾。“末尾”是稳定的位置，不需要段落锚点与内容指纹；书架展示的片段也取自末尾，两者一致。
- **跨页传递**：“继续写作”整页导航到 `/?project=<短名>&open=<地址>&at=end`。编辑器插件在编辑器区就绪后：
  - 打开该地址（正式标签）；
  - 文档就绪后让控件把光标放到末尾并滚动到可见；
  - 用 `replace` 去掉 `open` 与 `at` 两个参数，刷新不会重复执行。
- **控件能力**：`EditorControlHandle` 增加可选的 `revealEnd(): void`；源码编辑器与 Markdown 编辑器都实现（Monaco 定位到最后一行行尾；Tiptap 把选区放到文档末尾）。
- **失败时**（F07）：文件已移动或删除时，编辑器区顶部提示“上次编辑的《片段》已不在原处”，项目照常打开，不猜测别的文件；控件不支持 `revealEnd` 时只打开文件。
- 打开文件的命令 `nbook.editor.open` 增加可选参数 `reveal: "end"`，地址栏参数与以后的 Agent 调用走同一条路径。

## 关键设计

### 1. 项目合同（`src/server/projects/`、`src/shared/projects.ts`、`src/plugins/projects/shared/contracts.ts`）

- `identity.ts`：
  - `readProjectIdentity` 返回 `{id, metadata, extra}`；新字段不合规时去掉并带诊断；
  - 新增 `updateProjectMetadata`，见 P11；
  - 新增 `createProjectDirectory(parent, folderName, metadata)`：在给定父目录下排他新建目录，写身份文件（含书名），不建其它文件。
- `registry.ts`：新增 `unregister(id)`，只改登记表。
- 项目管理器（`manager.ts`）与 `projectsKey` 增加三项：
  - `create`：新建目录，然后按登记的规则登记；
  - `updateMetadata`；
  - `unregister`：项目不在 `stopped` 时拒绝为 `project-running`，正在使用的窗口与租约不受影响的承诺因此不必另写。
- 远程合同 `nbook.projects/projects` 升到 `version: 2`，新增方法：
  - `shelf`：`ProjectShelfItem[]`，即登记项、元数据与统计摘要；
  - `create {parent?, title, description?}`：`parent` 省略时用作品目录设置；
  - `update {id, title?, description?, color?}`；
  - `unregister {id}`。
- **作品目录设置**：`nbook.projects/library`，user 层字符串，缺省空。首次新建时空，界面先让用户选一个目录，写进设置。

### 2. 统计（`src/plugins/projects/project/`，新的 `project` 位置入口）

- `stats-count.ts`：纯函数 `countWords(text)`、`lastParagraph(text)`、`counted(address)`（判断是否计入），Bun 测试覆盖口径表的每一类。
- `stats-tracker.ts`：初次扫描、变更合并、按文件的字数表、今天的基线、写入合并。时钟用 `clockKey`，测试用注入时钟。
- `stats-record.ts`：记录定义 `project-stats`（两端共用的 schema：`{version, computedAt, generation, total, files, today: {date, baseline}, last: {address, at, excerpt} | null}`）。

### 3. 无项目时的首页（`src/plugins/workbench/`）

- 工作台新增贡献点 `workbench.home`：没有绑定项目的窗口在 `/` 显示它的贡献，没有贡献时照旧显示空工作台。
  - 至多一个贡献，同时有两个时都不采用、记诊断，显示空工作台。
- 首页之外另有 `/workbench`：不打开作品、直接进入空工作台（用户资产）。书架上有入口。
- 绑定了项目的窗口不受影响。

### 4. 书架页（`src/plugins/projects/web/shelf/`）

- 组件：
  - `BookshelfPage.vue`：页面骨架，上半继续写作，下半书架，书架与列表切换；
  - `ContinueCard.vue`：书名、片段（宋体稿面）、今天与总字数、“继续写作”按钮；
  - `BookSpine.vue`：书脊；
  - `SpineShelf.vue`：书脊排布与键盘；
  - `ShelfList.vue`：列表视图；
  - `TitlePage.vue`：扉页，悬停或聚焦时展开，带简介、字数、篇数、最近编辑、路径与操作；
  - `ProjectInfoDialog.vue`：新建与编辑信息共用。
- **书脊**：
  - 竖排书名，用宋体；
  - 厚度随总字数按对数增长，夹在 28 到 64px；
  - 颜色取 `color`，没有就按 id 在主题色板里选一档；
  - 书架末尾是“新建作品”“加入已有目录”两根虚线书脊。
- **键盘**：书架是一个 `listbox`。左右键移动，Home 与 End 到两端，Enter 打开，空格或 F2 展开扉页，Delete 从书架移除（先确认）。
- **窄屏**（宽度不足 720px）：默认列表视图，不显示书脊视图的切换。
- **排序**：最近编辑（缺省）、书名、字数。选择记在 `nbook.projects` 的 user 记录 `shelf-preferences` 里。
- **数据**：页面经 `shelf` 一次取得。页面可见时每 30 秒取一次，或者在窗口重新获得焦点时取，不订阅。

## Spec 与文档改动（S0）

| 文件 | 改什么 |
|---|---|
| `docs/specs/runtime/projects.md` | 非目标删去“书架页、新建、移除登记、重命名”；身份文件的可选元数据字段与更新规则；新建、修改信息、移出书架的输入、失败码与验收；`ProjectView` 的 `title` 与显示名规则；统计口径与新鲜度、统计记录的所有权 |
| 新建 `docs/specs/workbench/bookshelf.md` | 书架页：两种视图、继续写作、扉页与操作、键盘、窄屏、空书架、统计缺失与过期、各种失败的提示、验收 |
| `docs/specs/ui/workbench-shell.md` | `workbench.home` 贡献点与 `/workbench` |
| `docs/specs/workbench/editor.md` | `nbook.editor.open` 的 `reveal: "end"`；控件的 `revealEnd`；地址参数 `open`、`at` |
| `docs/specs/README.md` | 登记新 Spec |
| `docs/proposals/bookshelf.md` | `status: accepted`，`specs` 填上 |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | Lab 静态稿：书架页各组件用固定数据挂进 Lab（多本、一本、空书架、统计缺失与过期、窄屏、四主题 × 双配色）；截图给开发者 | Vitest 组件测试；`lab:shot` 截图 |
| S0 | 上表 Spec（S1 的稿定下视觉后写） | `docs:check`、`governance:check` |
| S2 | 身份文件元数据、新建、修改、移出书架；`projectsKey` 与远程合同 v2 | `identity.test.ts`、`registry.test.ts`、`projects-capability.test.ts`（真实临时目录） |
| S3 | 统计：口径纯函数、追踪器、记录、`project` 入口、`shelf` 摘要 | Bun：口径表、注入时钟的合并与跨日、真实项目子进程写入后 `shelf` 读到 |
| S4 | `workbench.home`、`/workbench`、书架页接真实数据，新建与编辑信息、移出书架 | Vitest；`e2e/bookshelf.e2e.ts` |
| S5 | 继续写作：`open` 的 `reveal`、两种控件的 `revealEnd`、地址参数、失败提示 | 编辑器 Bun 与 Vitest；`bookshelf.e2e.ts` 补继续写作 |
| S6 | 证据、omp 实现审查与修正、全量 e2e | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

S1 先于 S0：提案要求先出静态稿再定稿。开发者对外观的意见按 [待开发者确认](../../pending-confirmations.md) 的做法不阻塞后续切片。

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 元数据读写保留 `id` 与未知字段、坏字段降级、两次并发修改串行 | `identity.test.ts` |
| 新建：作品目录为空时要求选目录、目录已存在被拒、成功后已登记 | `projects-capability.test.ts`、e2e |
| 移出书架：运行中被拒、停止后登记表少一项、目录不动 | `registry.test.ts`、e2e |
| 统计口径（各类文件、字数算法、frontmatter、跨日基线） | `stats-count.test.ts`、`stats-tracker.test.ts` |
| 运行的项目写统计、关闭时写最后一次、`shelf` 读到且新鲜度正确 | 真实项目子进程的 Bun 测试 |
| 没有项目时 `/` 是书架、`/workbench` 是空工作台、绑定项目的窗口不变 | e2e |
| 书脊键盘、扉页、排序记住、窄屏为列表 | Vitest 与 e2e |
| 继续写作：打开并定位到末尾、刷新不重复、文件不在时提示 | `bookshelf.e2e.ts`（Markdown 与源码两种文件） |

## 验证

- 每片自跑上表命令；收口跑 `test:affected --typecheck`、全量 `bun run test:e2e`、`docs:check`、`governance:check`。
- 端到端：e2e 用真实服务端与项目子进程：
  - 登记两个临时项目，打开其中一个写入文字后关闭；
  - 回到 `/`，看书架的字数与片段；
  - 点“继续写作”回到那个文件的末尾并能接着输入。
- 未验证的边界：两个服务端进程同时修改同一作品信息（只在 Spec 写明后写者胜出）；Windows 与 macOS 的目录新建与权限。

## 不做

- 封面图、按天的写作量细条、云同步。
- 删除作品目录（只移出书架）。
- 已打开窗口在改名后即时刷新标题。
- 活页夹的章编排与“章”的概念（随剧情插件）。

## 风险

- 初次扫描大项目（t72 的约 3000 个文件样本）的耗时与内存：放在后台、分批读，S3 用 t72 的样本测一次并写进证据。
- 竖排书名在四个主题字体下的效果：S1 静态稿先看。
