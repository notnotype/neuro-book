# t64 实施计划：K6 配置插件 `nbook.settings`

## Context

- **为什么做**：K1–K5 交付了多实例内核、项目子进程、`nbook.storage` 与插件状态 store，“配置”（用户主动设定的偏好）还没有来源：界面语言写死为 `DISPLAY_LOCALE = "zh-CN"`（`packages/neuro-book/src/shared/localized-text.ts`，7 个文件在用），产品界面没有激活任何主题（只有 Lab 装了主题包），store 预留的读配置辅助函数是 planned（`docs/specs/state/store.md` 输出 19）。K6 做完后 K1–K6 一起验收，随后是工作台外壳。
- **依据**：[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 6、7、8、11 节与待定项 4（2026-10-07 `accepted`）；[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 6 节配置插件一行、第 11 节 K6 行；[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)、[ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)；VS Code 配置系统调研 [05](../../../../../docs/research/vscode/05-configuration-system.md)。
- **配套稿已定的**：三层合成（声明里的默认值、用户层、项目层），字段可声明只允许用户层；配置项经贡献点声明（键、TypeBox schema、默认值、中英标题与说明、允许的层、改后是否要重启、是否密钥）；所有已声明的项都可读、写入只限声明者，按键写、按键通知；用户编辑是另一条授权路径；界面语言是平台级设置、只允许用户层、客户端即时切换；用户自定义菜单与快捷键是用户编辑的文件；启动配置归宿主；不合法的键丢弃并记诊断、原文件保留；写盘失败不报已保存；多窗口即时同步。
- **开发者 2026-10-08 确认的设计轮决定**：
  1. 首版不做通用设置界面：给命令（“切换界面语言”“切换主题”）与可手改的 JSON 文件，文件被外部改动即时生效；设置界面等外壳之后单独做。
  2. 用户编辑不加内核机制：设置界面是 `nbook.settings` 自己的入口，拥有者只接受内核填写的调用方身份为 `nbook.settings` 的“用户编辑”；直接改文件即用户编辑；写入记诊断，密钥不记值。这条路径本期只写进 Spec，随设置界面实现。
  3. 密钥本期只定合同（只在服务端，客户端只见“已设置/未设置”、只写不读），存储方式等第一个使用者（模型提供商的 Key）时再定；旧应用“明文加打码”不沿用。
  4. 第一批使用者是界面语言与主题。
  5. 不做内存层、策略层；启动配置保持环境变量；引用文件跨设备同步不做。
  6. 旧应用的生效时机四档（`packages/neuro-book-legacy/server/config/registry.ts`）只留“即时生效 / 需要重启”；层间对象深合并（`merge: "deep-merge"`）不沿用，每个键整体覆盖。
- **推进方式**：开发者 2026-10-08 指定按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进到第 6 步 Files 竖切完成；计划经三个 omp 审查后按推荐修订（见“审查处理”），本该开发者确认的点记入 [待确认清单](../../pending-confirmations.md)。
- **现状**：
  - 每个实例只登记本位置的插件定义（`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts` 按 `descriptor.locations` 装配；浏览器引导 `src/server/browser-bootstrap.ts` 也只列有浏览器入口的插件）：服务端的目录里没有只有浏览器入口的插件（例如 `nbook.workbench`）。内核的登记把 `entries` 为空的定义拒为 `no-entries`（`packages/nb-runtime/src/plugins/registration.ts`），而 `runtime/plugin-manifest.md` 写的是“`entries` 可以为空（只含声明式贡献的插件）”，并把设置项列为顶层 `contributes` 的例子。
  - 贡献点支持 `implementation: "none"`（只有顶层声明），拥有者用 `context.declarations.list(点)` 读已接受的声明。
  - 跨实例数据的现成样板是 `nbook.storage`：服务端与项目入口各拥有一个分区并以远程服务交出，浏览器入口按调用方门面、经委托（`context.remote.on(调用方)`）转给拥有者，`delegatingPlugins`（`src/manifest.ts`）列出允许代理的插件。
  - 服务装配的静态环检测把可选依赖的边也算进去（`docs/specs/runtime/services.md`“依赖环”，`packages/nb-runtime/src/services/assembly.ts`），可选依赖不能用来打破环。
  - 远程订阅没有激活期截止：激活期调用上限只管方法调用（`packages/nb-runtime/src/remote/node.ts`）；建立失败的订阅不进重建集合，重连只重建仍有效的订阅（`runtime/plugin-channel.md` 输出 7）。
  - 插件之间运行时只能引用对方的 `shared/contracts.ts`（ADR 0026 决策 2，`src/architecture.test.ts` 机检）。
  - nb-ui 的主题是两条轴：主题包（`data-nb-theme`）与配色（明暗）；两套主题包都声明了 `defaultColorway.light/dark`。Lab 用无状态的装载与应用函数，自己管偏好（`src/plugins/lab/web/lab-theme.ts`），且 Lab 不读写产品配置（`docs/specs/ui/component-lab.md`）。产品首页（`src/plugins/workbench/web/empty-workbench.ts`）的文案是写死的中文，样式（`src/web/styles.css`）不消费主题 token。
  - 命令面板有选择服务 `quickPickKey`（`nbook.workbench` 提供），`nbook.projects` 的“打开项目”用它；选择请求的文字是字符串快照（`workbench/shared/contracts.ts` 的 `QuickPickRequest`）。内置命令 id 的域在词表里（`commands/shared/registry.ts`），没有 `workbench` 域。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交、提交后 push 本分支，只暂存本片文件；测试用真实内核实例、真实文件与 `fs.watch`、进程内链路与本机 Chrome，不用 mock、spy、假计时器、固定等待，等可观察的状态，时间相关的用注入时钟；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后三个 omp 只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 能力与 Spec

新 Spec `docs/specs/settings/configuration.md`（capability `settings.configuration`，`planned`）：声明、层与有效值、读取与变化、写入与授权、文件格式与外部修改、跨实例分发与就绪、失败码；密钥与用户编辑两节标 planned 的子条目。消费方：`state.store` 输出 19（读配置辅助函数）、`theme.system`（产品主题改由配置决定）。

### 2. 声明：写在插件描述里，每个实例都登记（`packages/nb-runtime/src/plugins/`、`packages/neuro-book/src/manifest.ts`）

- **为什么在描述里**：服务端要校验用户层文件、项目实例要校验项目层文件、每个窗口要知道默认值，都要知道全部插件的声明，包括只有浏览器入口的工作台。VS Code 同样从扩展清单（`contributes.configuration`）登记 schema，与扩展在哪里运行、是否激活无关（`configurationExtensionPoint.ts`）。描述（`plugins/<插件>/plugin.ts`）是内置插件的清单，所有宿主都读它。
- **内核**：`PluginDescriptor` 增加可选 `contributions`（只有声明、不需要实现的顶层贡献，例如设置项）。登记规则改为：定义里既没有入口、也没有顶层贡献与贡献点时才拒为 `no-entries`；只含顶层贡献的定义登记为插件汇总“可用”（与 `plugin-manifest.md` 输出 6 一致；`host.ts` 对没有本地入口的插件已汇总为可用，远程 `lookup`/`describe` 只看本地入口，不需要伪造入口）。
- **宿主装配，一条规则**：`src/manifest.ts` 新增 `pluginsAt(位置, 描述表)`：本位置有入口的插件，加上描述有 `contributions` 的插件；以及 `definitionAt(位置, 描述, 本位置定义 | undefined)`：有定义时把描述的 `contributions` 并到定义的顶层贡献里，没有时生成一份只含它们的定义（`entries: []`）。三个宿主的装配、浏览器引导的插件集合与修订号、浏览器的 `builtinBrowserPlugins` 与 `selectPlugins`、开发清单全部用这两个函数：浏览器引导因此也列出只有声明的插件（版本照常比较），只有服务端入口、没有声明的插件仍不进浏览器。“声明了本位置入口却缺定义或 id 不符”的装配失败保留。规则：顶层声明式贡献只写在描述里，插件定义不再写顶层 `contributions`（现在产品里没有这样写的）。
- **一份常量，三处使用**：`defineSetting({plugin, name, schema, default, title, description?, layers?, restart?})`（平台共享模块 `nbook/shared/settings`）返回 `SettingDefinition<T>`（`key`、`declaration`、`contribution`）。各插件把对外的配置定义写在自己的 `shared/contracts.ts`：描述取 `contribution`，读写取定义本身（类型 `T` 来自 schema），别的插件引用同一常量来读（ADR 0026 决策 2，不新增第二个公开入口）。
- **键**：`<插件 id>/<名>`，与服务 id、公开键同一规则；`<名>` 是以点分段的小驼峰（`appearance`、`editor.fontSize`），至多 128 个字符。文件里平铺写全键：`{"nbook.workbench/theme": "macos"}`。
- **点 `settings.properties` 的校验**（单条、纯函数）：键前缀是贡献方插件 id、名字合规则；`schema` 是可 JSON 序列化的 TypeBox schema；`default` 是严格 JSON 值（复用内核 `encodeJsonValue` 的规则：拒绝 `undefined`、非有限数、类实例、函数、循环）且通过 `Value.Check`；`layers` 是 `user`、`project` 的非空子集（缺省两层都允许）；`title` 中英两份，`description` 可选；`restart` 布尔；声明 `secret: true` 的项本期拒绝（原因写明密钥存储尚未实现，见第 9 节），不落成明文。
- **`restart` 的含义**：配置服务对所有项都即时给出最新值；`restart: true` 只告诉界面“改后要重启才完全生效”，由消费者决定只在启动时读取。本期三项都即时生效。
- **能改本机行为的项只允许用户层**：项目层文件可能来自别人的仓库（克隆、`git pull`）。会执行程序、指定网络地址或凭据、改变数据位置的配置项必须声明 `layers: ["user"]`；Spec 写成作者规则。VS Code 的对应做法是 `application`、`machine` 作用域不能写进 workspace，`restricted` 项在未受信任的工作区不读（`configurationRegistry.ts`）。

### 3. 层与文件（`packages/neuro-book/src/plugins/settings/backend/`）

- **落点**：用户层 `<状态根>/settings.json`，项目层 `<项目目录>/.nbook/settings.json`（可以进 Git，和 `.vscode/settings.json` 一样；`.nbook/storage.sqlite*` 仍应忽略）。文件不存在等于空层；读配置不创建文件或目录，首次写入时才创建。
- **格式**：JSON 对象，允许注释与尾随逗号（`jsonc-parser`，应用包 `dependencies`，只在服务端与项目子进程用）。读时去掉 UTF-8 BOM 再解析，必须检查解析错误（库在出错时仍返回部分对象）；根不是对象另行判定；重复键在语法树上检测（库取最后一个而不报错）。空文件与只有注释的文件等于空层。
- **单键编辑**：`modify` + `applyEdits`，缩进与换行从原文推断（制表符或空格及宽度、CRLF 或 LF），写回时恢复 BOM。编辑后的文本必须重新解析并通过与读取相同的检查、且目标键的值等于要写的值，否则不落盘、报 `write-failed`；库在删除最后一个带尾随逗号的键时会留下悬空逗号，编辑后用扫描器去掉紧跟在 `{` 或另一个逗号后的逗号再检查。保留范围写进 Spec：替换已有键的值不动其它文本；新增或删除键可能重排相邻的空白，删除键会带走紧邻它的注释。
- **层的拥有者**：服务端入口拥有用户层，项目入口拥有本项目代次的项目层（与 Storage 分区一致）。拥有者读文件、逐键校验、维护层快照、串行处理读写、监视外部修改，并以远程服务交出：`nbook.settings/user`（提供方 `server`，调用方 `browser`、`tui`、`project`）、`nbook.settings/project`（提供方 `project`，调用方 `browser`、`tui`）。同一文件的重读与写入在拥有者的同一个串行队列里，较早开始的重读不会在写入之后发布旧内容。
- **层快照**：`{status: "ok", revision, values, problems}` 或 `{status: "invalid", revision, detail, values}`。`values` 只含已声明、通过 schema、且本层允许的键，深冻结；`problems` 列出被丢弃的键与原因（不含值）。`revision` 是拥有者进程内单调递增的序号加启动标识（先比较启动标识相同，再比序号）。整份文件无法解析、根不是对象、同一键出现多次时层为 `invalid`：`values` 保留上一份有效内容（启动时即无效则为空），写入一律拒绝（`layer-invalid`），不在坏文件上再改；修好文件后恢复。`status`、`values`、`problems`、`detail` 任一有变化就发布新快照（层变坏、修好但值不变也要发布），全都没变（例如只改了注释）才不发布。没有声明的键（插件未装或已停用）原样留在文件里、不进 `values`、不报错。
- **写入**：远程载荷是 `{key, layer, op: "set", value}` 或 `{key, layer, op: "delete"}`（不靠 JSON 保留 `undefined`）。步骤：取文件锁 → 读当前文本并记下文件身份（设备、inode、大小、修改时间）→ 解析（坏文件即拒）→ 单键编辑并检查 → 写临时文件（沿用原文件的权限位）→ 改名前再核对文件身份，变了就从新文本重做（至多 3 次，仍冲突报 `write-failed`）→ 改名替换 → 释放锁。
  - **文件锁**：两个服务端可以同时打开同一个项目（`runtime/projects.md`），同一份项目层会有两个拥有者；进程内串行挡不住它们互相覆盖对方改的键。锁是目标文件旁的 `<目标>.lock`（排他创建，内容是持有者的 pid 与启动标识），只在读到改名之间持有；已存在时按注入时钟退避重试，持有者进程已不存在或超过 2 秒视为残留并接管；超过截止报 `write-failed`。外部编辑器不走锁，靠改名前的文件身份核对缩小窗口；这只缩小、不消除竞态，Spec 写明。
  - **符号链接**：`settings.json` 是符号链接时（dotfiles 仓库常见做法）用 `lstat` 区分：目标存在则解析到最终目标，在目标所在目录写临时文件、替换目标，链接保持不变；链接悬空时读为空层、写入拒绝（`write-failed`，detail 说明目标不存在），不替换链接。
  - **只读文件**：改名替换会绕过文件的只读位（实测 `0444` 文件被替换成功）。目标文件存在且当前进程不可写时拒绝（`write-failed`），原文件与快照不变。
  - 写完立即按新文本重算层快照、推给订阅者，并把新快照放进写入结果返回；随后监视器回传的同一内容比较后不再发布。
- **外部修改**：拥有者维护一个“协调”步骤：计算要监视的目录（配置文件路径上最近存在的那一级目录；是符号链接时再加目标路径上最近存在的那一级目录），关掉不再需要的监视、建上新的，然后重读。目录里与通往目标的下一级名字相关的事件、没有文件名的事件、监视器的 `error` 都触发协调；事件合并：最后一次事件后静止 50 毫秒再协调（VS Code 的用户配置同样以 50 毫秒合并 reload）。这样覆盖首次没有目录、`.nbook` 被删除后重建、链接改指向、目标被删除后重建。文件被删除等于空层。已知限制：网络文件系统、部分容器挂载上 `fs.watch` 可能收不到事件，此时外部修改到下次写入或重启才生效（Spec 写入限制）。
- **停止**：拒绝新的读写，已接纳的写入走完并结算，关闭监视与计时，删除残留的临时文件与自己持有的锁。
- **时钟**：50 毫秒合并、锁的退避与截止用宿主能力 `clockKey`（`nbook/clock`，新增；三个宿主提供 `systemClock`，测试场地提供 `ManualClock`），不另造计时。

### 4. 每个实例的有效值与服务（`packages/neuro-book/src/plugins/settings/{shared,backend,web}/`）

- **入口**：服务端入口（拥有用户层、提供 `settingsKey`）、项目入口（拥有项目层、提供 `settingsKey`）、浏览器有两个入口：`core` 提供 `settingsKey`，不依赖工作台；`commands` 依赖 `settingsKey` 与 `quickPickKey`，贡献“切换界面语言”。依赖链因此是单向的：命令与工作台依赖 `core`，`commands` 依赖工作台，不成环。
- **合成**：每个实例的 `nbook.settings` 入口订阅自己需要的层，在本地合成有效值：服务端只有默认与用户层（服务端不绑定项目；以后服务端按项目工作的功能要显式选定项目、在项目实例合成，不在服务端挂一个“当前项目”）；项目实例为默认、用户层（订阅服务端）、项目层（本地）；绑定项目的窗口为默认、用户层（服务端）、项目层（项目实例）；未绑定的窗口没有项目层。每个键取允许的层里最具体的那个值，没有则取默认值。
- **读取服务** `settingsKey`（三个位置各一份，按调用方门面提供）：

  ```ts
  interface SettingsService {
      /** 同步、不失败；值深冻结。在 @vue/reactivity 的 computed 或 effect 里读，值变化时重新求值。 */
      get<T>(setting: SettingDefinition<T>): DeepReadonly<T>;
      /** 有效值、来源层、默认值与各层的值，以及各层的状态（ok / invalid / unavailable）；层状态变化时也重新求值。 */
      inspect<T>(setting: SettingDefinition<T>): SettingInspection<T>;
      /** 本实例里有效值变化的键；同一次层更新只通知一次。层状态变化而值不变时不通知。 */
      onDidChange(listener: (keys: ReadonlySet<string>) => void): () => void;
      /** 只能写本插件声明的项。value 为 undefined 表示删除这一层里的这个键。layer 缺省为 "auto"：项目层有这个键的值就写项目层，否则写用户层。 */
      update<T>(setting: SettingDefinition<T>, value: T | undefined, options?: {layer?: "user" | "project" | "auto"}): Promise<SettingWriteResult>;
  }
  ```

  `layer: "auto"` 与 VS Code 主题选择器的 `findAutoConfigurationTarget` 一致：项目层覆盖了主题时，在这个项目里切换主题改的是项目层，否则改了也看不到效果。`update` 收到的值先按严格 JSON 规则复制一次（不合规为 `invalid-value`），之后调用方再改原对象不影响写入。
- **就绪**：入口激活时订阅各层，等每层“订阅建立并收到第一份快照”，各层有截止（3 秒，按 `clockKey` 计时；订阅本身没有截止，见现状）。按时收到：激活完成时 `get` 已是文件里的值。超时：该层记为 `unavailable`、按默认值继续并记诊断，订阅不取消，第一份快照晚到时照常应用并通知变化。订阅建立失败或建立后被结束：
  - 浏览器：原因是连接类（`unavailable`、`disconnected`、超时）时，该层记为 `unavailable`，在窗口连接下一次回到在线时重新订阅；宿主能力 `windowConnectionKey`（`nbook/window-connection`，新增：`state()` 与 `onChange`，浏览器宿主按远程会话的在线、离线提供）给出这个时机，不另造定时重试。`not-provided`、`denied` 记诊断不重试；`server-restarted`、`project-gone` 是宿主的终态，窗口整体失效，不重试。
  - 项目实例：订阅服务端用户层失败时记 `unavailable` 并按默认继续；服务端不可达时项目实例本身随之关闭，不重试。
  - 已建立的订阅在同一服务端进程、同一项目代次内断线重连，由内核重建并重推基线（`resync`）。
- **写入路径与授权**：门面按内核签发的调用方身份写。层在本实例时直接交给拥有者；不在时以调用方的身份经委托转给拥有者（浏览器的两层、项目实例的用户层），拥有者看到的调用方是原插件、`via` 为 `nbook.settings`。拥有者核对：键已声明、调用方插件是声明者、值通过 schema 与严格 JSON 规则、目标层允许；服务端插件写项目层为 `no-project`。`nbook.settings` 加入 `delegatingPlugins`；身份由内核签发、`via` 不可伪造（审查已用真实内核验证），所以代理不会让被代理的插件获得用户编辑的权限。
- **读到自己的写入**：写入结果带回写后的层快照，门面先把它应用到本实例（同一启动标识下序号更大才应用），再结算 `update`；所以 `update` 成功返回时，本实例至少已应用这次写入的层快照。并发写入时，返回时看到的可能已是别人更晚的值；写的是被更具体的层覆盖的层时，有效值不变而层的值已更新。其它实例经订阅收到。
- **结果码**：成功 `{ok: true}`；失败 `denied`（不是声明者）、`undeclared`、`invalid-value`、`layer-not-allowed`、`no-project`、`layer-invalid`、`write-failed`（不报已保存；锁超时、改名前冲突重试用尽、只读、悬空链接、编辑后检查不过、写盘错误，各有 detail）、`unavailable`、`unknown-outcome`（写请求已发出后被中断，可能已写入；不自动重发，以随后的快照为准）。
- **审计**：拥有者每次写入记一条诊断：键、层、调用方插件与 `via`、结果码，不记值；外部修改记变化的键；丢弃的键记键与原因，同一份文件内容只记一次。

### 5. store 的读配置辅助函数（`packages/neuro-book/src/shared/store/store.ts`）

- `StoreSetupContext` 增加 `setting<T>(definition): Readonly<Ref<DeepReadonly<T>>>`：值随配置变化更新；`create` 的选项增加 `settings?: SettingsService`，setup 里用了 `setting` 而没给时 `create` 抛错（与 `persist` 要求 `storage` 同一做法）。
- 布尔配置项不自动进入公开状态。配套稿第 5 节写的是以 `config.<键>` 进入公开状态，但 K5 定的公开键命名是 `<插件 id>/<名>`，由声明方插件贡献；要在 `when` 里用配置值的插件，在自己的 store 里读配置再 `publish`（记入待确认清单）。

### 6. 使用者一：界面语言

- `nbook.settings` 在自己的描述里声明 `nbook.settings/locale`：`"zh-CN" | "en-US"`，默认 `"zh-CN"`（保持现在的行为），只允许用户层；定义写在 `plugins/settings/shared/contracts.ts`。
- 删去 `DISPLAY_LOCALE` 常量；`nbook/shared/settings` 导出 `displayLocale(settings)`。
- **文字在显示时才选语言**：语言切换时已经打开的面板与提示也要换。
  - 命令面板（`WorkbenchCommandPalette.vue`）与面板宿主收一个响应式的 `locale` 输入：工作台从配置取；Lab 的命令场景传 Lab 自己的常量（Lab 不读产品配置）。组件同名 `.md` 同步。
  - 选择请求（`QuickPickRequest`）的标题、占位、空列表提示与候选说明接受 `LocalizedText`，面板渲染时按当前语言取；`nbook.projects` 的文案函数改为返回 `LocalizedText`（两种语言各格式化一次），不再折成字符串快照。
  - `nbook.commands` 的不满足原因（含缺声明、类型不对的默认原因）改为 `LocalizedText`，求值时按当前语言给出；已记下的诊断保留当时的文字。
  - 首页（`empty-workbench.ts`）的文案改为按当前语言渲染。
- 命令 `nbook.settings.switch-locale`（“切换界面语言”，`nbook.settings` 的浏览器 `commands` 入口）：参数可选 `{locale}`，严格 schema；给了参数直接写，不打开选择；没给时经选择服务列出两种语言。
- 切换后所有窗口即时换语言，不重新加载；工作台同步 `<html lang>`。

### 7. 使用者二：主题（`packages/neuro-book/src/plugins/workbench/`、`src/ui/theme/`）

- 工作台在描述里声明 `nbook.workbench/theme`（`"nbook" | "macos"`，默认 `"nbook"`）与 `nbook.workbench/appearance`（`"light" | "dark" | "system"`，默认 `"light"`），两层都允许；定义写在 `plugins/workbench/shared/contracts.ts`。配色取主题包 `defaultColorway[明暗]`，与 `theme/system.md` 的两轴一致；`system` 读 `prefers-color-scheme` 的当前值并监听变化，只改文档的明暗与配色，不把配置改写成 `light`/`dark`。
- 产品装 `nbook`、`macos` 两套主题包（`installThemePacks` 已处理与 Lab 的重复装载）。把 Lab 里写文档根的应用与清除函数抽到 `src/ui/theme/`，Lab 与工作台共用；偏好、系统明暗的监听与清理归各自页面，不共享当前状态。
- 主题由工作台渲染的页面应用：页面挂载时按配置写文档根、开始监听系统明暗，配置变化时重写，卸载时停止；不放在一直存活的插件激活作用域里。Lab 是 `reloadOnLeave` 的独立页面，自己管文档根；离开 Lab 整页加载，再由工作台按配置应用。
- 产品页面消费主题：首页与工作台根的背景、文字颜色与字体改用 nb-ui 的 token（宿主的启动与失败页保留自己的样式边界），切换主题后用户看得到变化，而不只是文档根属性变了。
- 命令 `nbook.settings.switch-theme`（“切换主题”）与 `nbook.settings.switch-appearance`（“切换明暗”），由工作台贡献（内置命令的域取 `settings`，域不等于插件 id）；参数可选，严格 schema；给了参数直接写，没给时经选择服务列出；写入用 `layer: "auto"`。

### 8. 三条设置命令的共同约定

- 声明 `effect: "write"`，Agent 暴露 `auto`（可逆、非破坏性；记入待确认清单），Agent 在 discuss、plan 模式下照命令系统规则得到 `read-only`。
- 结果转换：配置写入成功为 `{ok: true}`；`denied` → `denied`；`unavailable`、`no-project` → `unavailable`；`invalid-value` → `invalid-args`；其余（`write-failed`、`layer-invalid`、`unknown-outcome`、`undeclared`、`layer-not-allowed`）→ `execution-error`，`reason` 写明配置的失败码与 detail。用户在选择里取消为成功、无副作用。

### 9. 写进 Spec、本期不实现的两条路径

- **密钥**：声明 `secret: true` 的项只在服务端有值；任何接口不把值发往客户端，客户端只能看到“已设置/未设置”、只能写入或清除；无法解密时读取为 `secret-unreadable`（沿用 `runtime/plugin-api.md` 已定的语义）。存储方式（系统钥匙串或其它）随第一个使用者定；在那之前登记拒绝 `secret: true` 的声明。
- **用户编辑**：拥有者的远程服务增加独立的用户编辑方法，可写任何已声明项的允许层，只接受内核填写的调用方是 `nbook.settings` 自己且没有经过代理的请求；按 schema 与层校验，记审计。随设置界面实现。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/settings/configuration.md`（新建，`planned`） | 第 1–9 节的行为合同；密钥与用户编辑标 planned 子条目；已知限制（`fs.watch` 收不到事件的文件系统、与外部编辑器之间的竞态只缩小、删除键可能带走相邻注释） |
| `docs/specs/runtime/plugin-manifest.md` | 内置插件的描述是清单，顶层声明式贡献写在描述里，每个实例（含浏览器引导集合）都登记 |
| `docs/specs/runtime/plugins.md` | `no-entries` 只拒绝既无入口、也无顶层贡献与贡献点的定义 |
| `docs/specs/runtime/plugin-channel.md` | 输出 7 补一句：订阅建立与首个事件不受激活期方法调用上限约束，把首个快照当作启动前提的消费者自己定截止与恢复 |
| `docs/specs/runtime/plugin-api.md` | 删去 `ctx.config`、`ctx.secrets` 两行与相关条款，改为 `nbook.settings` 的服务（可读全部已声明项、只写自己的）；密钥条款指向新 Spec |
| `docs/specs/runtime/browser-host.md` | 宿主能力 `windowConnectionKey`；引导集合含只有声明的插件 |
| `docs/specs/runtime/server-host.md`、`docs/specs/runtime/projects.md` | 宿主能力 `clockKey`（与浏览器宿主相同） |
| `docs/specs/state/store.md` | 输出 19 定形状（`setting`）与 `create` 的 `settings` 选项 |
| `docs/specs/storage/boundaries.md` | “Config”一行与正文改指新 Spec，删去“Global Config 与 Project Config”的旧说法 |
| `docs/specs/theme/system.md` | 事实源与运行时流程改为新应用：配置两项、工作台页面应用、产品页面消费 token、Lab 独立 |
| `docs/specs/workbench/commands.md` | 三条设置命令进命令表（effect、暴露、参数、结果转换）；不满足原因按当前界面语言给出 |
| `docs/specs/workbench/quick-open.md` | 选择请求的文字接受 `LocalizedText`、按当前语言显示；打开中的面板随语言切换 |
| `docs/specs/README.md` | 注册表加新 Spec |
| `docs/modules/monorepo-boundaries.md` | 改掉“不能在运行时 import 其它插件模块”的过时说法，指向 ADR 0026 |
| `packages/neuro-book/AGENTS.md` | 插件对外的配置定义写在 `shared/contracts.ts` |
| 组件同名 `.md`（`WorkbenchCommandPalette.md` 等） | `locale` 输入 |
| `docs/proposals/plugin-data-model.md` | 只追加决策记录：本计划里与正文不同的几处（布尔不自动公开、密钥、设置界面、键名） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档改动 | 上表 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 2 节内核与宿主装配；宿主能力 `clockKey`、`windowConnectionKey` | `PluginDescriptor.contributions`、`no-entries`、`pluginsAt`、`definitionAt`、三个宿主与浏览器引导 | `bun run --cwd packages/nb-runtime test`、两包 `typecheck`、受影响的宿主与引导测试 |
| S2 | 第 2、3 节的纯部分 | `defineSetting`、点校验、层文本的解析与逐键校验、单键编辑与编辑后检查、合成；`jsonc-parser` 依赖 | 新增单元测试；`bun install` 后核对锁文件只多 `jsonc-parser` |
| S3 | 第 3 节拥有者 | 文件读写、锁、符号链接、只读、监视协调与合并、串行队列、停止、远程合同、服务端与项目入口 | 真实临时目录与 `fs.watch` 的合同测试，`ManualClock` |
| S4 | 第 4 节 | 各实例的订阅与合成、就绪截止与恢复、按调用方门面、委托写入、读到自己的写入、浏览器两个入口 | 多实例场地（服务端、项目、两个窗口，进程内链路） |
| S5 | 第 5 节 | store 的 `setting` | `store.test.ts` 增补 |
| S6 | 第 6、8 节 | 界面语言、显示时选语言、命令、删去 `DISPLAY_LOCALE` | 受影响的组件测试与 Bun 测试 |
| S7 | 第 7、8 节 | 主题、两条命令、主题应用函数抽取、产品页面消费 token | 组件测试；Lab 现有 e2e 不变 |
| S8 | — | e2e 与 smoke | `e2e/settings.e2e.ts`；`smoke:server` 增加 S9 |
| S9 | — | Spec 实现合同与证据、Task 证据、三个 omp 实现审查与修正 | `bun run test:affected --typecheck`、e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 只有浏览器入口的插件的声明在服务端与项目实例也登记；只有服务端入口的插件的声明在窗口也登记，浏览器引导列出它并比较版本；只含顶层贡献的定义登记为可用；空定义仍拒；声明了入口却缺定义仍失败 | S1：`plugins.test.ts` 增补、三个宿主与引导的装配测试 |
| 声明校验：键前缀、名字、schema 可序列化、默认值是严格 JSON 且合 schema（`undefined`、`NaN`、`Date`、`Map` 被拒）、层、`secret` 被拒；两个插件声明同一键两条都拒 | S2：`declarations.test.ts` |
| 文件解析：注释与尾随逗号、BOM、空文件与只有注释、根不是对象、重复键（含嵌套）、非法值丢弃且不含值、未声明键忽略、只允许用户层的键出现在项目层被丢弃 | S2：`layer.test.ts` |
| 单键编辑：替换值保留注释、其余键、BOM、CRLF、制表符缩进；删除首、中、末键与唯一带尾随逗号的键后仍是合法文本；空文本新增；删除不存在的键无副作用；编辑后检查不过不落盘 | S2：`edit.test.ts` |
| 写入走临时文件改名；符号链接目标被改、链接保留；悬空链接拒写且链接不动；只读文件与只读目录各为 `write-failed` 且快照不变；坏文件拒写且不改动；两个拥有者（两个真实进程）同时改不同键，两键都保留；改名前文件被外部改动时重做后两边的键都在 | S3：`owner.test.ts`（真实临时目录、真实子进程；只读用例要求非 root） |
| 外部修改：编辑器式改名替换与原地覆写都生效；先截断再写入时经过一次空内容重读、最终值正确；文件删除回到默认；`ok → invalid → ok`（值不变）时快照状态依次变化；目录一开始不存在后被创建、`.nbook` 删除后重建再修改、链接 A 改指 B 后修改 B 都生效；50 毫秒内的连续事件只重读一次（注入时钟推进 49、50 毫秒）；自己写入后监视回传不重复发布（以随后的一次外部修改作为屏障，再数发布次数）；停止后不再有事件与临时文件 | S3：`owner.test.ts`，等可观察的快照，不按时长等待 |
| 合成：服务端不含项目层；绑定窗口与项目实例含项目层；未绑定窗口没有；`inspect` 给出来源层与各层状态，层变坏时其它实例的 `inspect` 也变 | S4：`settings.test.ts`（多实例场地） |
| 授权：非声明者 `denied`；未声明 `undeclared`；值不合 schema 或不是严格 JSON 为 `invalid-value`；层不允许 `layer-not-allowed`；服务端写项目层 `no-project`；委托时拥有者看到原插件；读到的对象值改不动（深冻结），两个消费者互不影响 | S4 |
| 读到自己的写入：`update` 返回时本实例已应用这次写入；另一窗口经订阅收到；两窗口同时写同一键与不同键，最终两边一致；写结果晚于更新的快照到达时不倒退；写被项目层覆盖的用户层时层值更新、有效值不变 | S4 |
| 就绪与降级：激活完成时已是文件里的值；首个快照超过截止时按默认继续、晚到的快照照常生效；订阅建立失败后窗口回到在线时重新订阅并收到非默认值；快照先于订阅返回到达、订阅建立期间被结束两种顺序；写请求发出后断线为 `unknown-outcome` | S4（注入时钟） |
| 浏览器两个入口不成环：工作台、命令与设置命令都能激活 | S4 |
| `layer: "auto"`：项目层有值写项目层，否则写用户层；只允许用户层的键总写用户层 | S4 |
| store 的 `setting` 随配置变化；没给 `settings` 时 `create` 抛错 | S5：`store.test.ts` |
| 切换语言后：已打开的命令面板与“打开项目”选择保留输入与选中项、所有可见文字换语言；不满足原因、首页文案、`<html lang>` 即时变化；Lab 命令场景不受影响 | S6：组件测试；S8：e2e |
| 三条设置命令：带有效参数直接写不弹选择；非法参数 `invalid-args` 且不写；Agent 在 plan 模式 `read-only`；写失败转换为命令失败并带配置失败码；取消无副作用 | S6、S7：命令测试 |
| 主题与明暗写到文档根，首页背景、文字颜色与字体随主题变化（计算样式）；`system` 跟随系统明暗变化、切到显式明暗后不再跟随；Lab 显示期间产品配置变化不写文档根，离开 Lab 后按最新配置应用 | S7：组件测试；S8：e2e |
| 两个窗口：一处切换语言，另一处即时变化；刷新后保持；`settings.json` 里预先写的注释保留 | S8：`e2e/settings.e2e.ts` |
| 外部改 `settings.json` 后窗口主题变化；项目层覆盖主题时，绑定该项目的窗口与未绑定窗口各自正确，“切换主题”在绑定窗口里改项目层、在未绑定窗口里改用户层 | S8：`e2e/settings.e2e.ts` |
| 打包产物：状态根里有带注释的 `settings.json`，以客户端身份写一个键后注释保留；文件损坏时服务端照常启动并记诊断 | S8：`smoke:server` S9 |

## 验证

- 每片：上表的自跑验证；类型改动影响新应用时跑 `bun run --cwd packages/neuro-book typecheck`。
- 收口：`bun run test:affected --typecheck`、`bun run --cwd packages/neuro-book test:e2e`（含新 e2e）、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查。
- 真实环境：开发服务下两个窗口，改语言、改主题、手改 `<状态根>/settings.json` 与项目的 `.nbook/settings.json`，观察即时生效与诊断；截图（两套主题 × 明暗）存证据。
- 明确留下的未验证边界：网络文件系统与容器挂载上的监视；Windows、macOS 上改名替换与监视的行为（目前不是目标平台）；TUI 客户端（还没有）；与不走锁的外部编辑器之间的竞态（只缩小）。

## 不做

- 通用设置界面、用户编辑的实现、密钥存储、用户自定义菜单与快捷键文件（另起 Task）。
- 内存层、策略层、语言或资源级覆盖（VS Code 的 `[markdown]`）、多套用户配置（VS Code 的 Profile）。
- 启动配置文件；跨设备同步。
- 第三方插件读写配置的异步写法（随第三方插件 API 设计）。
- 内核层面的订阅超时（本期在 `nbook.settings` 内定截止；以后有第二个需要的消费者再考虑进内核）。

## 风险

- 内核放开 `no-entries`、浏览器引导集合变化：只含声明的定义进入每个实例的目录。S1 先跑全量内核测试与宿主测试，再接入配置。
- 同步读取只限内置插件（`runtime/plugin-api.md` 的选用规则）：`get` 是同步的，第三方的读取写法随第三方 API 再定。
- 浏览器激活要等远程快照：服务端慢时首屏最多推迟 3 秒，之后按默认值显示、快照到了再切换。
- 文件锁的残留判断依赖 pid 与时长：持有者异常退出后最多 2 秒内其它拥有者写入要等待；跨机器共享目录上 pid 不可靠，按时长接管。

## 审查处理

2026-10-08 三个 omp（默认模型）交叉审查：通读并对照 VS Code（12 条）、架构与授权的对抗审查（8 条）、文件层实验与使用场景（12 条）。报告存为 [evidences/plan-review-vscode.txt](evidences/plan-review-vscode.txt)、[evidences/plan-review-arch.txt](evidences/plan-review-arch.txt)、[evidences/plan-review-scenarios.txt](evidences/plan-review-scenarios.txt)，实验脚本留在审查者的临时目录。主 Agent 逐条对照代码核实，全部成立，已并入上文：

| 问题（几位审查者提出） | 处理 |
|---|---|
| 可选依赖仍算静态环，窗口启动失败（3） | 浏览器拆 `core` 与 `commands` 两个入口（第 4 节） |
| 首个快照的等待没有截止，激活期调用上限不管订阅（3） | 各层 3 秒截止、超时降级、晚到照常应用；`plugin-channel.md` 补说明（第 4 节、S0） |
| 订阅建立失败后重连不会补建（3） | 新宿主能力 `windowConnectionKey`，回到在线时重新订阅；终态不重试（第 4 节） |
| 按值去重吞掉层变坏与修好（3） | 状态、值、问题任一变化都发布（第 3 节） |
| 两个拥有者或外部编辑器交错写入丢键（2） | 目标旁的写入锁 + 改名前文件身份核对重做（第 3 节） |
| 符号链接改指向、目录缺失或删除重建后监视失效（3） | 监视“协调”步骤，监视最近存在的目录并按事件重建（第 3 节） |
| 改名替换绕过只读文件（2）；悬空链接没有定义（2） | 写前核对可写、临时文件沿用权限；`lstat` 区分悬空链接并拒写（第 3 节） |
| 删除最后一个带尾随逗号的键写出坏文件（1） | 编辑后重新解析检查、去掉悬空逗号；保留范围写明（第 3 节） |
| 两条主题命令用了未登记的 `workbench` 域，Agent 暴露与结果转换没定（2） | 改为 `nbook.settings.switch-theme`、`switch-appearance`；第 8 节共同约定 |
| `shared/settings.ts` 违反跨插件只引用 `shared/contracts.ts` 的规则（3） | 定义写进各插件的 `shared/contracts.ts`（第 2 节） |
| 浏览器引导只列有浏览器入口的插件，声明目录各实例不一致（1） | `pluginsAt` 一条规则覆盖装配与引导（第 2 节） |
| 读到的对象值可被改动，绕过只写自己的授权（2） | 深冻结、`DeepReadonly`；写入值先复制（第 4、5 节） |
| schema 合格的值不一定能无损落盘（1） | 默认值与写入值走严格 JSON 规则；删除用显式操作（第 2、3、4 节） |
| 打开中的选择与面板不随语言变、Lab 共享面板缺语言输入、首页文案与样式没接入（2） | 文字显示时才选语言、面板收 `locale` 输入、首页翻译并消费 token（第 6、7 节） |
| “不重复发布”、50 毫秒合并、先截断再写的测试缺少可观察的边界（3） | 注入时钟 `clockKey`；以后续外部修改作屏障；验收逐条改写 |
| 拥有者停止、重读与写入的顺序没有写（1） | 同一串行队列；停止步骤（第 3 节） |
| `restart` 的消费者义务不清（2） | 第 2 节写明 |

审查对三项待确认的判断都是“支持按建议”，三项按建议定并记入[待确认清单](../../pending-confirmations.md)，连同本轮按推荐定下的 Agent 暴露、首快照截止时长、删除键可能带走相邻注释。
