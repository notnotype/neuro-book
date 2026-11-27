# 实施计划：注册方案进浏览器与资源管理器

## Context

Agent 会往 `session://`、`tmp://`、`profile://` 写文件，用户在工作台里看不到，也打不开：资源管理器只有 `project://`、`user://` 两个根（`explorer/web/tree/model.ts`），浏览器的地址解析只认这两个方案（`files/shared/resource.ts`），编辑器打开别的方案时不拦，标签进了编辑组后每次渲染都抛错，整个编辑区卡死（[w00050 t05](../../../w00050-lyra-persona-and-prompts/tasks/t05-editor-open-virtual-scheme-crash/README.md) 查明的根因链）。

起因是开发者 2026-11-27 在会话里提的七个问题，这个 Task 处理其中的第 1、2、4 条（资源管理器显示、打不开 `session://`、工作空间入口）。

依据：

- [workspace/resources.md](../../../../../docs/specs/workspace/resources.md)：“浏览器访问已注册的方案”目前是 `(planned)`，这次实现它。
- [agent/resources.md](../../../../../docs/specs/agent/resources.md)：五个方案的根、挂载点与授权；单数地址的改写。
- [workbench/files-explorer.md](../../../../../docs/specs/workbench/files-explorer.md)、[workbench/editor.md](../../../../../docs/specs/workbench/editor.md)。

开发者已确认的决定（2026-11-27，见 Task README 的“决定”）：

1. 除 `projects://` 外，注册方案都在资源管理器里显示。
2. 挂载方案是真实目录，支持改名、删除、移动、复制、新建与监视。
3. 根固定，用全局地址；当前会话在 `sessions://`、`temps://` 里排第一并标出，当前 Profile 在 `profiles://` 里标出；切换对话时自动展开、定位，可在设置里关掉。根本身不跟着会话换。
4. 挂载点那一层（某个会话、某个 Profile 的目录本身）不能改名、删除；浏览器可以改 `home/` 下的全部文件，包括宿主写的 `attachments/`、`artifacts/`、`jobs/`。
5. 界面：三组根、默认展开、根的叫法、会话展开后露出什么、跟随的方式，按 Task README 的注意力排序一行；当前项用行尾强调色圆点，只读根用行尾锁，会话根按服务端给的全列、没有“显示更多”，临时文件为空写一行淡字。静态稿是 Lab 草稿区的 `drafts/w00058-t01/ExplorerRootsDraft`。

计划第 1 版经 Opus 审查（报告在本机 `.local/agent/works/w00058-…/t01-resources-design/reports/opus-review.md`，14 条全部核实属实），本版按它改写；omp `@review`（第 1 版与改写后的版本都读了，报告被它重写过几次，完整条目从会话记录恢复在同目录 `omp-recovered.md`）的 6 条也已核实并改进本版。

## 技术选型

无新的通用问题。文件监视沿用 `files/backend/changes.ts` 的递归 `fs.watch` 与回声登记，挂载点的打开、关闭沿用 `files/backend/mounted.ts`，不另引监视库。

## 关键设计

### 地址类型：不放宽 `Resource`，另加联合类型（`files/shared/resource.ts`）

现有代码大量写成“不是 project 就是 user”（`files/web/client.ts:88` 的合同选择、`contracts.ts:340` 的 `contractOf`、`contracts.ts:460` 的 `rawUrlOf`、`markdown/shared/targets.ts:70`、`markdown/web/parts/asset-urls.ts:69`、标签与行的根名）。把 `Resource.scheme` 放宽成 `string` 能编译通过，却会把 `sessions://<id>/home/a.md` 当成 `user://<id>/home/a.md` 读写，`create` 会真的在用户资产里建文件。所以：

- `Resource`、`Scheme`、`parseResource` 保持只认 `project`、`user`，未知方案照旧拒绝。
- 新增 `FileAddress = {kind: "local"; resource: Resource} | {kind: "mounted"; scheme: string; mount: string; path: string}` 与 `parseFileAddress(address)`：只校验写法，挂载方案的路径拆成挂载点与挂载点内路径。
- 凡是要接受挂载方案的地方改用 `FileAddress`，按 `kind` 穷举（`switch` 加 `never`），不留“否则走 user”的缺省。改到的地方在切片 3 开工时用 `grep` 列全（`Scheme`、`=== "project"`、`=== "user"`、`startsWith("user://")`），逐处写进 Task 记录；已知的有门面、`contractOf`、`rawUrlOf`、编辑器的文档存储、标签提示与面包屑、Markdown 目标分类与图片地址、资源管理器的 `session.ts`、`controller.ts`、`tree/rows.ts`、`tree/invalidate.ts`、Lab 的 `memory-files.ts` 与测试的 `world.ts`。
- 路由与类型放宽在同一片、同一个提交里完成，中间没有“放宽了但还没路由”的提交。

### `packages/neuro-book/src/plugins/files/shared/`

- `schemes.ts`
  - `MountDeclaration` 加 `watch?: string`：挂载点里要监视的子目录，缺省监视整个挂载点。`sessions://` 声明 `watch: "home"`，`session.jsonl` 的追加和 `blobs/` 不在监视范围内。
  - 注册声明加 `presentation: {group: "agent" | "reference"; order: number}`，`schemes()` 按组与序号排；界面用的中文名由资源管理器的文案目录按方案名给，没登记的方案显示方案名、归“参考资料”组末尾。
  - `MountedSchemeSpec` 加 `watchRoot?(notify: () => void): () => void`：虚拟根的条目变了由注册方通知。
  - `SchemeOperation` 加 `delete`、`rename`、`move`、`copy-source`；授权回调能区分“删改一个目录项”与“写一个文件”。
- `contracts.ts`：新合同 `schemesFilesContract`（`nbook.files/schemes`，版本 1，provider `server`，callers `browser`、`tui`）。
  - `schemes()` 交回 `{name, description, capabilities, readOnly, group, order}[]`。
  - `list` 的输出是 `Listing | VirtualListing`：虚拟根保留条目的 `title` 与 `meta`（会话的 Profile、更新时间），浏览器按 `kind` 区分。
  - `read`、`write`、`create`、`rename`、`move`、`copy`、`delete`、`identify`、`cancel` 的输入在现有形状上多一个 `scheme`，结果同 `project://` 合同；活页夹与内容文件夹的方法不提供。
  - 失败码逐方法写进合同：在现有业务失败码之外加 `unknown-scheme`（方案撤回与请求交错时由提供方给出，现有合同只让客户端给）；挂载方案的 `unsupported-capability` 在出口换成现有的 `unsupported`；源与目标不在同一挂载点用现有的 `outside-root`（`invalid-input` 是运行时保留码，合同里不能声明）。
  - `realPath` 对挂载方案用不建目录的读路径：没写过东西的 Profile 笔记点“复制路径”不会建出目录，目录不在时报“不存在”。
  - 事件，三种订阅单位各一个事件，过滤条件都写进合同：
    - `changes`：过滤条件 `{scheme, mount}`，载荷同 `ChangesPayload`，路径相对方案根（带挂载点名）。只推这一个挂载点的变化，两个展开着的会话互不影响。
    - `roots`：过滤条件 `{scheme}`，载荷 `{kind: "changed"}` 或 `{kind: "ended", reason}`（方案撤回时）。服务端在这个方案有第一个根订阅时调注册方的 `watchRoot`，最后一个释放时撤掉。
    - `schemes`：不带过滤条件，方案集合变化（注册、撤回）时推送。
  - 浏览器的订阅登记（`files/web/client.ts` 的 `WatchRegistry`、`SchemeWatch`）现在按 `Scheme` 一个订阅，改成按订阅单位（本地根、挂载点、虚拟根）记；编辑器与资源管理器的订阅键、释放跟着改。
- `rawUrlOf`：挂载方案给 `/api/nbook.files/raw/scheme/<方案>/<路径>`，只读。

### `packages/neuro-book/src/plugins/files/backend/mounted.ts`

- **文件操作**：补 `rename`、`move`、`copy`、`delete`，走 `#run`。
  - 结构性保护，不靠各方案的授权：挂载点本身（挂载点内路径为空）、声明的 `ensure` 子目录与 `watch` 子目录（会话的 `home`）不能改名、移动、删除，得 `permission-denied`。`profiles`、`temps` 的授权对浏览器全部放行，靠这一条挡住“删掉整个笔记目录”。
  - 授权的位置：复制的源按 `copy-source`（读），目标按写；删除、改名、移动按目录项本身的位置判，不跟随最后一段链接（`home/` 里指向 `session.jsonl` 的链接，用户能删）。
  - 源与目标必须在同一挂载点，否则 `invalid-input`。
  - 这四个操作只给浏览器合同，不进 Agent 的写入接口：`workspace-files.ts` 对挂载方案保持 `unsupported-capability`，Spec 写明。这只是不给 Agent 的文件工具新开删改的路；Agent 的 shell 照旧能直接读写真实目录，包括 `attachments/`、`artifacts/`、`jobs/`，这是 `agent/resources.md` 已写的信任边界与已知限制，本 Task 不改。
- **订阅**：
  - 订阅的借用与请求的借用分开计数：订阅不计入 `#inFlight`，`stop()` 不会因订阅而永远等下去。
  - 挂载点或监视目录还不存在时，订阅进入“等待”：不开监视，不报错。`MountedScheme` 自己建目录（第一次写、新建、取真实路径，含 `ensure`）之后，通知这个挂载点上等着的订阅：开监视、推 `resync`。新对话还没写文件时展开它的 `home/`，第一次写之后树上就出现文件。
  - `stop()`（方案撤回、入口停止）关闭全部挂载点，包括已摘下的，并对每个订阅推 `ended`（`ChangeHub.close` 加结束原因）。
  - `retire`（目录被整个换掉）时，旧挂载点上的订阅收到 `ended: root-gone`，由客户端重订；旧挂载点不再因订阅而留着。
  - 软上限 64 照旧计入订阅，超过时照开并写诊断。
  - 推给浏览器的事件逐条按字面路径判 `read`，不露出的路径不推。事件里的路径常已不存在，只判字面这一次，Spec 写明。
- **建目录时的根通知**：挂载点第一次建出目录时，对这个方案的根订阅推 `roots` 事件（`temps://` 的根因此在第一次写 `tmp://` 后立刻更新，不等容器监视）。
- **字节路由的读入口**：加 `withRoot(path, caller, operation, callback)`，在 `#run` 里完成授权与解析、借用期间交出打开着的根与挂载点内路径。字节路由（`raw-route.ts`）的挂载方案分支与现有的 `raw/project`、`raw/user` 同样做：只接 `GET`、`HEAD`；先用 `crossSite` 拒绝别的网页（403 `cross-site`）；路径解码与非法路径拒绝；用 `withRoot` 调现有的 `serveFile` 并带 `RAW_HEADERS`（`Content-Security-Policy: sandbox`，直接打开会话里的 HTML、SVG 不以应用源运行），ETag 与 `HEAD` 照旧。调用方按浏览器算（`agent: null`，来源 user），与浏览器合同同一套授权。

### `packages/neuro-book/src/plugins/files/backend/changes.ts`

- `ChangeHubOptions` 分开“路径基准根”（挂载点）与“监视目录”（`watch` 子目录）。`onRaw` 把相对监视目录的名字补成相对挂载点的路径，`classify` 与回声登记都用补好的路径：自己保存不再出现假的“删除”。
- 失同步恢复核对的是监视目录：它还在就重建监视并推 `resync`；它不在、挂载点还在时回到“等待”（见上一节），不留下已关的监视器；挂载点也不在时推 `ended: root-gone`。`startWatcher` 抛错时清空 `watcher`，不再只推一次 `resync` 就静默失效。
- 挂载方案的远程出口统一补 `<挂载点>/` 前缀，事件路径相对方案根。

### 新增 `files/backend/schemes-remote.ts`

按 `consumer` 构造 `SchemeCaller`：浏览器为 `{agent: null}`，来源 `{kind: "user", plugin}`；转给注册表里的 `MountedScheme`。照 `workspace-files.ts` 的现有接法装进 `plugin.ts`。

### `packages/neuro-book/src/plugins/agent/backend/schemes.ts`

- `sessions` 声明 `watch: "home"`，并实现 `watchRoot`：只在会话新建、改标题、归档、删除时通知，并合并成一批，不随每次运行的活动时间通知。列一次根要把每个会话的 `index.json` 依次读一遍（`nb-harness` 的 `jsonl-store.ts` 的 `list`），2000 个会话热缓存约 52 毫秒、200 个约 4 毫秒（2026-11-27 本机实测）；偶尔列一次没问题，跟着每次活动重列就会反复付这笔开销。通知挂在会话列表已有的变更来源上；是哪一条在切片 2 开工时先查（`runtime.meta` 只是候选，要核实它覆盖新建、归档与删除）。
- `profiles` 的 `watchRoot` 挂在 Profile 登记的变化上（增删、改名），不是笔记目录里的写入。
- `temps` 的根改为列出临时目录已存在的会话，条目的标题同 `sessions://`。Spec 原来写的是“无条目，只有说明”，一起改。根通知：`watchRoot` 被调用（有人订阅这个根）期间，对临时目录的容器开一个非递归的 `fs.watch`，只看第一层的新建、删除、替换，合并成一批后通知；shell 或外部程序在运行期建、删临时目录，根也会更新。`MountedScheme` 自己建目录时的通知照旧，最后一个根订阅释放时关掉这个监视。
- 注册声明的 `presentation`：会话 1、Profile 笔记 2、临时文件 3 归 Agent 组；Skill 1、文档 3 归参考资料组；表情（`stickers` 插件注册）是参考资料组 2。

### 工具结果记下改写后的全局地址（`agent/backend` 的内置写入工具）

浏览器端拿不到写入那一刻的会话与 Profile：`changeProfile` 之后、`fork` 之后，按当前会话改写 `profile://`、`session://` 会指到错的目录。所以改写放在知道事实的地方：

- 内置写入工具（`write`、`edit` 与产生文件改动的工具）的结果里，每个改动的文件同时记下改写后的全局地址（写入接口本来就拿到展开后的地址）。nb-agent-ui 的文件改动标签优先用它打开。切片 3 开工时先核对现有结果里有没有，没有再加。
- 没有记录的旧消息与回复正文里的链接，按消息所属会话与当前 Profile 改写，Spec 写成已知限制（`changeProfile` 之后可能打开另一份笔记，`fork` 出的会话里沿用来的 `session://` 指向新会话的 `home/`）。
- `project://`：消息所属会话的作品与窗口绑定的作品不同时，不打开，提示“这个文件属于另一部作品”。
- 改写表是纯函数，放 `agent/shared/`，前后端共用一份；`bot://` 等 `bots://` 实现时随它加。

### `packages/neuro-book/src/plugins/files/web/client.ts`

- 门面按 `FileAddress.kind` 穷举选合同：`local` 照旧，`mounted` 走 `schemesFilesContract`。浏览器入口（`files/web/plugin.ts`）的 `remoteDelegates` 加上 `schemesFilesContract`，否则以调用方身份转发会被运行时按 `denied` 拒绝。
- 激活时取一次 `schemes()`，随 `schemes` 事件重取；撤回的方案在门面上报 `unknown-scheme`。
- `watch(address)` 对挂载方案按挂载点订阅。

### `packages/neuro-book/src/plugins/editor/web/`

- `area.ts` 的 `open()`：语法不合法的地址拒绝；语法合法的都可以进编辑组，不等方案表。方案表到了且明确没有这个方案时才拒绝。这样窗口刚加载时恢复出来的 `sessions://` 标签不会被误拒。
- 标签记录与最近打开（`tabs-record.ts`、`recent-record.ts`）的地址格式只收 `project`、`user`，挂载方案的标签存不下来；放宽到合法的挂载方案地址。
- 文档存储（`documents/store.ts`）按订阅单位（本地根或挂载点）归组订阅、补读与 `ended`；未知方案读得 `unknown-scheme`，按“文件不存在”显示，不抛错。标签提示、面包屑同样不抛错。这三条合起来就是 w00050 t05 的“不卡死”。
- 根名：标签提示与面包屑对挂载方案用资源管理器同一份中文名。

### `packages/neuro-book/src/plugins/markdown/`

- 目标分类（`shared/targets.ts`）：挂载方案的地址归“文件”一类并带地址（不再是“其它、没有地址”）；相对目标按所在文件的方案与挂载点解析，`sessions://<id>/home/` 里的文档引用同目录的图，解析成同一挂载点下的地址。
- 图片地址（`web/parts/asset-urls.ts`）按 `FileAddress` 取字节地址，按订阅单位订阅变化。

### `packages/neuro-book/src/plugins/explorer/web/`

- `tree/model.ts`：根由 `project`、`user` 加 `schemes()` 的结果组成，去掉 `projects`；按组排，组间画分隔线。
  - 根的状态多一种只读，行尾画锁。
  - 挂载方案的订阅按展开的挂载点开、收起即关；单个挂载点的 `ended` 只影响它下面的条目（按“不存在”处理、重列父目录），不改根的状态。根本身随 `roots` 事件重列，方案集合随 `schemes` 事件更新。
  - 现在的 `watches: Map<Scheme, …>` 改成按订阅单位记。
- 会话根按服务端给的全列（至多 200 个），不截断、没有“显示更多”；树本来就是虚拟滚动。
- 当前会话：读 public state `nbook.agent/focusedSession`，值为 `{session, profile} | null`。
  - 排序：`sessions://`、`temps://` 里把它排第一、行尾强调色圆点，`profiles://` 里标出它的 Profile。排序只在浏览器端做。
  - 跟随：值变了且设置“跟随当前对话”开着时，展开 `sessions://<id>/` 与它的 `home/`，只把它滚进视野；不收起别的目录，拖动、改名、内联输入中不跳。设置项加在资源管理器现有的设置里，缺省开。
- 菜单：按方案的能力和只读状态隐藏不可用的项；挂载点那一层与 `home` 不出现改名、删除；活页夹相关项对挂载方案不出现。
- 拖动与粘贴：挂载方案里“同一个根”按挂载点算，跨挂载点、跨根在界面上就不放行（`workspace/files.md`：不跨根搬运）。

### `packages/neuro-book/src/plugins/agent/web/`

- 发布 public state `nbook.agent/focusedSession`：最近获得焦点的那个对话位置的会话与它的 Profile；没有就是 `null`。
- 文件改动标签与消息里的链接按上面“工具结果记下改写后的全局地址”一节打开。

## Spec 与文档改动

- `workspace/resources.md`：浏览器访问已注册方案从 `(planned)` 改成正式条目：新合同、`list` 的虚拟根输出、事件（路径相对方案根、按字面路径过滤）、按挂载点订阅与等待目录出现、订阅的结束（撤回、`root-gone`）、字节地址、`realPath` 不建目录；挂载方案的文件操作与结构性保护；`MountDeclaration.watch`、`presentation`、`watchRoot`；挂载方案的四个文件操作不进写入接口。
- `agent/resources.md`：`temps://` 根的条目；浏览器调用方的授权；`sessions://` 只监视 `home/`；工具结果记下全局地址；没有记录时的改写与已知限制。
- `workbench/files-explorer.md`：根的组成、分组与顺序、只读标记、当前会话的排序与跟随、挂载点那一层与 `home` 不可改、菜单按能力显示、跨挂载点不放行。
- `workbench/editor.md`：入口只拒绝语法不合法与明确没有的方案；未知方案按“文件不存在”显示。
- `workspace/markdown-dialect.md`：目标分类加挂载方案。
- `agent/conversation.md`：文件改动标签与消息里的链接怎么打开。
- w00050 t05：实现合入后标为被本 Task 取代。

## 切片

1. **编辑器不卡死**：`Resource` 不动，`area.ts` 的 `open()` 在入口拒绝认不出的地址并说明原因，对话侧打开失败时弹出原因。这一片的规则与方案表无关；“语法合法的都能进编辑组、未知方案按不存在显示”要改编辑器里十几处直接解析地址的地方，与第 3 片的 `FileAddress` 迁移是同一批改动，挪到第 3 片做。单独提交。
2. **服务端**（files/shared 的合同与声明、`mounted.ts`、`changes.ts`、`schemes-remote.ts`、字节路由、agent/backend 的声明与根通知）：用真实的 `MountedScheme`、真实目录与真实 `fs.watch` 测试。
3. **地址类型与浏览器**（`FileAddress` 与全部调用方、门面、文档存储、Markdown、工具结果的全局地址、对话侧的打开）：类型放宽与路由同一个提交。
4. **资源管理器**（根、分组、只读、按挂载点订阅、菜单、拖放规则）。
5. **当前会话**（agent/web 的 public state，explorer 的排序与跟随）。
6. **Spec 晋升与收口**。

每片：`bun run test:affected --since master`，加该片列出的 e2e 文件。

## 验收映射

先把上面的 Spec 改动写成编号条目，再逐条映射。下表是计划层面的对应：

| 行为 | 覆盖 |
|---|---|
| 打开 `profile://`、`sessions://` 不卡死；方案表未到时恢复的标签不被拒 | `editor` 的 dom 测试，`agent-conversation.e2e.ts` 点 `profile://` 改动标签 |
| `sessions://` 的读写不触达 `user://` | `resources.test.ts`（真实服务端，断言用户资产目录没有新文件） |
| 挂载方案的改名、删除、移动、复制；删 `profiles://<key>`、`temps://<id>`、`sessions://<id>/home` 被拒；复制源按读判；删指向 `session.jsonl` 的链接成功 | `files/schemes.test.ts` |
| 订阅只报 `home/`；自己保存不出外部事件；删掉并重建 `home/` 后仍收到事件 | `files/changes.test.ts`、`files/schemes.test.ts`（真实目录、真实 `fs.watch`） |
| 先订阅不存在的 `home/`、Profile 笔记、临时目录，再第一次写，订阅收到事件 | `files/schemes.test.ts` |
| 订阅期间挂载点不因空闲被关；撤回方案时订阅收到 `ended`；`stop()` 不因订阅卡住 | `files/schemes.test.ts`（注入时钟） |
| 字节路由：别的网页来的请求 403；响应带 `sandbox`；受保护的路径拒绝；ETag 与 `HEAD` | `files/raw-route.test.ts` |
| 新合同经浏览器入口以调用方身份转发成功；撤回与请求交错得 `unknown-scheme`；不支持的操作得 `unsupported`；跨挂载点得 `outside-root` | `resources.test.ts`、`files/schemes.test.ts` |
| 两个会话同时展开，只改其中一个的 `home/`，另一个的树与文档不重列 | `files-explorer.e2e.ts` |
| 运行期用 shell 新建、删除临时目录，`temps://` 根随之更新 | `resources.test.ts` |
| 事件不露受保护的路径 | `files/schemes.test.ts`：测试注册一个监视范围覆盖受保护子路径的方案（真实 `MountedScheme`），先断言不过滤时受保护路径的事件会出现，再断言过滤后不出现 |
| 浏览器经新合同读写，来源为 user；虚拟根带标题与 meta | `resources.test.ts` |
| 第一次写 `tmp://x` 后 `temps://` 根出现该会话 | `resources.test.ts` |
| 文件改动标签打开写入当时的全局地址（`changeProfile` 之后仍打开原 Profile 的文件） | `agent/shared` 单测、`agent-conversation.e2e.ts` |
| 会话里的 Markdown 引用同目录的图能显示；外部改了打开着的 `sessions://` 文档，编辑器重读 | `markdown` 的单测、`agent-conversation.e2e.ts` |
| 资源管理器显示各根、分组、只读标记、展开即订阅；跨挂载点拖放不放行 | `ExplorerTree.dom.test.ts`、`files-explorer.e2e.ts` |
| 新对话先展开 `home/`、Agent 再第一次写 `session://x`，树上出现 `x`；删一个展开着的会话，别的会话照常 | `files-explorer.e2e.ts`（真实服务端，测试工具写入） |
| 当前会话排第一、切换对话时跟随、设置关掉后不跟、拖动中不跳 | `files-explorer.e2e.ts` |

## 验证

- 单测与合同测试：`bun run test:affected --since master`。
- e2e 合入前跑一次：`files-explorer.e2e.ts`、`agent-conversation.e2e.ts`、`lab-explorer.e2e.ts`，共 3 个文件。开工前先在起点上各跑一遍记作基线。
- 实施中只重跑改动覆盖到的文件和失败项。
- 交付前在开发服务上点一遍：对话里点 `session://` 文件、资源管理器展开会话、改一个文件看对话侧的改动、在新对话里展开 `home/` 再让 Agent 写文件。
- 未验证边界：几百个挂载点同时订阅时 inotify 的用量，只在切片 2 量 64 个挂载点同时订阅的情形；Bun 的递归 `fs.watch` 每个监视器占几个 inotify 实例，同样在切片 2 量。

## 不做与风险

- **不做**：`bots://` 与 `bot://`（随 neurobot 实现；bot 的文件现在在 `user://bots/<id>/`，已经看得到）；Composer 的 @ 跨方案、拖到 Composer、Agent 用链接引用文件，另开 Task；跨根与跨挂载点的移动与复制（例如把会话里的稿子挪进作品）；挂载方案的文件操作进 Agent 的写入接口。
- **同一文件两个地址**：`skills://<id>` 与 `user://skills/<name>` 指向同一目录，`skills://` 只读，编辑器里会是两份文档。这次不处理，写进 Spec 的已知限制。`bots://` 实现时也会碰上，到时一起定。
- **旧消息的改写**：没有记录全局地址的旧消息按当前会话与 Profile 改写，`changeProfile`、`fork` 之后可能打开错的文件，写进 Spec 的已知限制。
- **监视量**：每个展开的挂载点一个递归监视。用户展开很多会话时占用会上升，靠收起即关和软上限 64 的诊断来控制。
