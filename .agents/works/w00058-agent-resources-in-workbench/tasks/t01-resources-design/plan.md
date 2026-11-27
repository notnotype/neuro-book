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
5. 界面：三组根、默认展开、根的叫法、会话展开后露出什么、跟随的方式，按 Task README 的注意力排序一行；当前项用行尾强调色圆点，只读根用行尾锁，会话根按服务端给的全列、没有“显示更多”，临时文件为空写一行淡字（评审板第 1 轮与其后两行决定）。静态稿是 Lab 草稿区的 `drafts/w00058-t01/ExplorerRootsDraft`。

## 技术选型

无新的通用问题。文件监视沿用 `files/backend/changes.ts` 的递归 `fs.watch` 与回声登记，挂载点的打开、关闭沿用 `files/backend/mounted.ts`，不另引监视库。

## 关键设计

### `packages/neuro-book/src/plugins/files/shared/`

- `schemes.ts`：`MountDeclaration` 加 `watch?: string`，是挂载点里要监视的子目录，缺省监视整个挂载点。`sessions://` 声明 `watch: "home"`，这样 `session.jsonl` 的追加和 `blobs/` 不产生事件。这是从结构上减少监视读的东西，不是事后按路径过滤。
- `schemes.ts`：`MountedSchemeSpec` 加 `watchRoot?(notify: () => void): () => void`。虚拟根的条目（会话列表、Profile 列表）由注册方生成，不在磁盘上，变了由注册方通知。
- `contracts.ts`：新合同 `schemesFilesContract`（`nbook.files/schemes`，版本 1，provider `server`，callers `browser`、`tui`）。
  - `schemes()` 交回 `{name, description, capabilities, readOnly}[]`，按注册顺序排列。
  - `list`、`read`、`write`、`create`、`rename`、`move`、`copy`、`delete`、`identify`、`cancel`、`realPath` 的输入在现有形状上多一个 `scheme`，结果与失败码同 `project://` 合同。
  - 活页夹、内容文件夹的方法（`convert`、`reorder`、`display`、`include`、`drop`、`createContent`）不提供：挂载方案不维护清单。
  - 事件 `changes` 的过滤条件是 `{scheme, mount}`，载荷同现有的 `ChangesPayload`；事件 `roots` 的过滤条件是 `{scheme}`，载荷 `{kind: "changed"}`。
- `resource.ts`：`Resource.scheme` 放宽成 `string`，只校验写法。另留 `LocalScheme = "project" | "user"` 给只对这两个根成立的地方（上传、`project://` 的字节地址、`tab-hints` 的根名）。方案在不在，由客户端按 `schemes()` 判断。
- `rawUrlOf`：挂载方案给 `/api/nbook.files/raw/scheme/<方案>/<路径>`，只读。图片查看器和 Markdown 里的图因此能显示会话里的图。

### `packages/neuro-book/src/plugins/files/backend/`

- `mounted.ts`：补 `rename`、`move`、`copy`、`delete`，和现有的 `write`、`create` 一样走 `#run`。授权按 `write` 对源与目标各判一次，`move`、`copy` 的源与目标必须在同一挂载点。
- `mounted.ts` 的订阅：
  - 一个订阅持有一次挂载点的借用，挂载点不会因空闲 5 分钟被关掉。
  - 软上限 64 照旧计入订阅；超过时照开，并写诊断。
  - 变更中心按声明的 `watch` 子目录开监视。
  - 推给浏览器的事件逐条按 `read` 授权过滤，与 `list` 过滤子项同一个判据，免得事件泄露不露出的文件名。
- 新增 `schemes-remote.ts`：按 `consumer` 构造 `SchemeCaller`，浏览器为 `{agent: null}`，来源 `{kind: "user", plugin}`；转给注册表里的 `MountedScheme`。照 `workspace-files.ts` 的现有接法装进 `plugin.ts`。
- 字节路由：在现有 raw 路由旁加 `scheme/` 分支，按 `read` 授权。

### `packages/neuro-book/src/plugins/agent/backend/schemes.ts`

- `sessions` 声明 `watch: "home"`，并实现 `watchRoot`：只在会话新建、改标题、归档、删除时通知，并合并成一批，不随每次运行的活动时间通知。列一次根要把每个会话的 `index.json` 依次读一遍（`nb-harness` 的 `jsonl-store.ts` 的 `list`），2000 个会话热缓存约 52 毫秒、200 个约 4 毫秒（2026-11-27 本机实测）；偶尔列一次没问题，跟着每次活动重列就会反复付这笔开销。复用会话列表已有的变更来源，不另造；是哪一条在切片 2 开工时先查（`runtime.meta` 只是候选，没核实过它是否覆盖新建与归档）。
- `profiles` 实现 `watchRoot`：Profile 目录变化时通知。
- `temps` 的根改为列出临时目录已存在的会话，条目的标题同 `sessions://`。Spec 原来写的是“无条目，只有说明”，要一起改。
- 授权：浏览器（`caller.agent === null`）照现有规则，挂载点那一层不可写，因为 `sessionRule` 的 `path === ""` 已经拒写。

### `packages/neuro-book/src/plugins/files/web/client.ts`

- 门面按方案选合同：`project`、`user` 照旧，其余走 `schemesFilesContract`。
- 激活时取一次 `schemes()`，之后随 `roots` 事件重取。
- `watch(address)` 对挂载方案按挂载点订阅。
- 认不出的方案在门面直接交回 `unknown-scheme`，不发请求。

### `packages/neuro-book/src/plugins/explorer/web/`

- `tree/model.ts`：根由 `project`、`user` 加 `schemes()` 的结果组成，去掉 `projects`。
  - 根的状态多一种 `readOnly`，行上标只读。
  - 挂载方案的订阅按展开的挂载点开、收起即关；根本身随 `roots` 事件重列。
  - 现在的 `watches: Map<Scheme, …>` 改成按订阅单位（根或挂载点）记。
- 会话根按服务端给的全列（至多 200 个），不截断、没有“显示更多”；树本来就是虚拟滚动。
- 监视的范围：只有展开着的挂载点开监视（会话是它的 `home/`），没展开的会话不监视；会话根本身不靠文件监视，跟着 `roots` 事件重列。
- 当前会话：读 public state `nbook.agent/focusedSession`，值为 `{session, profile} | null`。
  - 排序：`sessions://`、`temps://` 里把它排第一、加标记，`profiles://` 里标出它的 Profile。排序只在浏览器端做，不改服务端的列表。
  - 定位：值变了且设置“跟随当前对话”开着时，展开并定位到 `sessions://<id>/home/`，复用 `controller.reveal`。设置项加在资源管理器现有的设置里，缺省开。
- 菜单：按方案的 `capabilities` 和只读状态隐藏不可用的项。活页夹相关项对挂载方案不出现。
- 跨根的拖动、粘贴照现有规则拒绝（`workspace/files.md`：不跨根搬运）。

### `packages/neuro-book/src/plugins/agent/web/`

- 发布 public state `nbook.agent/focusedSession`：最近获得焦点的那个对话位置的会话；没有就是 `null`。
- `openAddress(address, session)`：先按消息所属的会话改写单数地址，`session://` 换成 `sessions://<id>/home/`，`tmp://` 换成 `temps://<id>/`，`profile://` 换成 `profiles://<这个会话的 Profile>/`，再交给编辑器。
  - 改写是纯函数，与服务端同表，放 `agent/shared/`，前后端共用一份。
  - `bot://` 等 `bots://` 实现时随它加。

### `packages/neuro-book/src/plugins/editor/web/area.ts`

- `open()` 入口先解析地址，并问 files 门面方案在不在，不在就交回 `{ok: false, reason}`，不把标签放进编辑组。这就是 w00050 t05 的第 1 点。
- 恢复出来的标签，方案不在（插件没装、会话已删）时按“文件不存在”显示，不抛错。

## Spec 与文档改动

- `workspace/resources.md`：浏览器访问已注册方案从 `(planned)` 改成正式条目，写进合同、事件、按挂载点订阅、事件按授权过滤、字节地址；挂载方案的文件操作；`MountDeclaration.watch` 与 `watchRoot`。
- `agent/resources.md`：`temps://` 根的条目；浏览器调用方的授权；按消息所属会话改写单数地址；`sessions://` 只监视 `home/`。
- `workbench/files-explorer.md`：根的组成与顺序、只读标记、当前会话的排序与跟随、挂载点那一层不可改、菜单按能力显示。
- `workbench/editor.md`：入口拒绝认不出的方案；恢复出来的标签方案不在时的显示。
- `agent/conversation.md`：文件改动标签与消息里的链接按消息所属会话打开。
- w00050 t05：实现合入后标为被本 Task 取代。

## 切片

1. **编辑器入口拦截**（editor 一节的第 1 点）：先止住卡死。dom 测试加“打开认不出的方案得拒绝、编辑组不变”。单独提交。
2. **服务端合同**（files/shared、files/backend、agent/backend）：合同、文件操作、订阅、事件过滤、`watchRoot`、`temps://` 根、字节路由。用真实的 `MountedScheme` 与真实目录跑测试。
3. **浏览器门面与编辑器**（files/web、editor 的第 2 点、agent/web 的改写）：从对话里打开 `session://` 能编辑、保存，外部改动有回声。
4. **资源管理器**（explorer）：根、只读、按挂载点订阅、菜单。
5. **当前会话**（agent/web 的 public state，explorer 的排序与跟随）。
6. **Spec 晋升与收口**。

每片：`bun run test:affected --since master`，加该片列出的 e2e 文件。

## 验收映射

先把上面的 Spec 改动写成编号条目，再逐条映射。下表是计划层面的对应：

| 行为 | 覆盖 |
|---|---|
| 认不出的方案被拒、编辑区不卡 | `editor` 的 dom 测试，`agent-conversation.e2e.ts` 点 `profile://` 改动标签 |
| 挂载方案的改名、删除、移动、复制，挂载点那一层被拒 | `files/schemes.test.ts` |
| 订阅只报 `home/`、不报 `session.jsonl`；事件不露受保护的文件名 | `files/schemes.test.ts`（真实目录、真实 `fs.watch`） |
| 订阅期间挂载点不因空闲被关 | `files/schemes.test.ts`（注入时钟） |
| 浏览器经新合同读写，来源为 user | `resources.test.ts` |
| 单数地址按消息所属会话改写 | `agent/shared` 单测（与服务端同表）、`agent-conversation.e2e.ts` |
| 资源管理器显示各根、只读标记、展开即订阅 | `ExplorerTree.dom.test.ts`、`files-explorer.e2e.ts` |
| Agent 写 `session://x` 后树上出现 | `files-explorer.e2e.ts`（真实服务端，测试工具写入） |
| 当前会话排第一、切换对话时跟随、设置关掉后不跟 | `files-explorer.e2e.ts` |

## 验证

- 单测与合同测试：`bun run test:affected --since master`。
- e2e 合入前跑一次：`files-explorer.e2e.ts`、`agent-conversation.e2e.ts`、`lab-explorer.e2e.ts`，共 3 个文件。开工前先在起点上各跑一遍记作基线。
- 实施中只重跑改动覆盖到的文件和失败项。
- 交付前在开发服务上点一遍：对话里点 `session://` 文件、资源管理器展开会话、改一个文件看对话侧的改动。
- 未验证边界：几百个挂载点同时订阅时 inotify 的用量，只在切片 2 量 64 个挂载点同时订阅的情形；Bun 的递归 `fs.watch` 每个监视器占几个 inotify 实例，同样在切片 2 量。

## 不做与风险

- **不做**：`bots://` 与 `bot://`（随 neurobot 实现；bot 的文件现在在 `user://bots/<id>/`，已经看得到）；Composer 的 @ 跨方案、拖到 Composer、Agent 用链接引用文件，另开 Task；跨根的移动与复制（例如把会话里的稿子挪进作品）。
- **同一文件两个地址**：`skills://<id>` 与 `user://skills/<name>` 指向同一目录，`skills://` 只读，编辑器里会是两份文档。这次不处理，写进 Spec 的已知限制。`bots://` 实现时也会碰上，到时一起定。
- **事件泄露**：浏览器订阅的事件不按授权过滤的话，会把受保护的文件名送进浏览器。由 `files/schemes.test.ts` 用真实 `sessions://` 方案（`agentSchemes` 的实现，不是替身）在 `blobs/` 下写文件来兜底。
- **监视量**：每个展开的挂载点一个递归监视。用户展开很多会话时占用会上升，靠收起即关和软上限 64 的诊断来控制。
