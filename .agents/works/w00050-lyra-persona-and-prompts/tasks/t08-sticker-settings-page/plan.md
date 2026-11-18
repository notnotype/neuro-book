# t08 计划：表情包设置页

第 3 版，按两轮设计审查改过（第 1 轮后端 omp 13 条、页面 Sonnet 17 条；第 2 轮后端 11 条、页面 12 条；处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)）。审查到第 2 轮为止，剩下的按下文实施。

## Context

开发者 2026-11-18 提出：放表情包文件夹太麻烦，要一个设置界面，能新建、编辑、导出导入表情包，以后做表情包市场。设计经三轮评审板定稿（[`artifacts/review`](artifacts/review/index.html) v3），交互与边角的决定见 [README](README.md) 的“决定”1 到 19。行为合同：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 输出 20、25 到 38，“副作用与数据”，失败表里标 planned 的几行，验收 9、10。

定稿的样子是草稿 worktree 里的 `StickerPacksPageDraft`（`.worktree/w00050-t08-drafts`，分支 `w00050-t08/drafts`，不合并）。**草稿只定版式、类名与格子尺寸**；下面几处以 Spec 为准，不照草稿：改包名的警告（要去 Profile 页重新勾选）、认不出的图的提示（写进清单，文件不改名）、表情的标识用文件名不用名字、认不出的图在改好名字之前说明与常用不能改、文字全部走消息目录。

依据的现状：远程调用单条消息至多 1 MiB（`nb-host/src/shared/socket.ts:16`），图片与 zip 走 HTTP；文件服务的 `rename`、`delete` 作用于目录、写入有条件写（`expect`）与读改写重试（`update`），`copy` 只在同一方案里（[workspace.files](../../../../../docs/specs/workspace/files.md) 的“文件操作”）；`stickers://` 拒绝写，写要用 `user://stickers/…`。`user://` 只由服务端进程写，所以同一个包的写入可以在进程里串行。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 读写 zip | `fflate`（应用已依赖，主题包导入导出在用，`theme-editor/package-io.ts`） | 服务端写用 `zipSync` 只存不压（图片再压省不下，`level: 0` 快）；读用流式 `Unzip`，按解出的实际字节计数；浏览器导入冲突时也用它读本地 zip 画预览 | `yazl`（只写、根工作区才有）；`Bun.Archive`（只说了 tar） |
| 缩小图片 | `Bun.Image`（目录核对已在用） | `metadata`、`resize`、`png`、`jpeg`、`webp` 都有 | `sharp`：新依赖 |
| 动态 WebP | 读 VP8X 块的动画位（约 10 行） | `Bun.Image` 没有帧数；只判这一位 | 解析整个 RIFF |
| GIF 是不是动图 | 不判断，超限一律拒绝（决定 18） | `Bun.Image` 写不出 GIF | 数图像描述块 |
| 打开文件夹 | 把现有 `openFolder` 拆出“打开已有目录”的部分共用 | 已处理没有桌面与打开失败 | 再写一份 |
| 拖放兜底 | `nbook/ui/dropped-folder` 的 `dragHasFiles`，同插件页 | 现成、有测试 | 手写 |

## 关键设计

### `packages/neuro-book/src/shared/open-folder.ts`

从 `agent/backend/skills/folder.ts` 拆出 `openExistingFolder(path, env, platform)`：不建目录，先 `lstat` 确认是目录且不是链接，再判断桌面与 `open`；失败交回 `no-desktop` 或 `open-failed`（带 `path`）。Skill 的 `openFolder` 保留自己的 `mkdir -p`，再调它。表情包一侧（`revealPack`）负责授权：按 id 从目录现取，用户包要求 `realpath` 落在 `user://stickers/` 的真实目录里、插件包要求它的根仍是当前登记的那个（代次没变），再交给 helper；不收用户给的路径。系统调用之前最后一瞬被换掉路径不在承诺内。

### `stickers/backend/catalog.ts`：目录多记几样

- 每个表情包多记：`listed`（清单写了表情列表）；`extras`：名字当不了表情名但字节是相符图片的（`reason: "name"`），有列表时文件夹里没列的图片（`reason: "unlisted"`），各带宽高、版本、字节数，核对复用 `readImage` 与按戳记的缓存；有列表的包为此多列一次文件夹。`extras` 每类至多 500 项，另记总数。
- 概要（`packs`，给左栏与 Profile 页）加两个整数 `unrecognized`、`unlisted`；字节预算照旧。
- 变更判断把 `listed`、`extras` 也算上：只多了一张没加进来的图也发 `changed`。
- `refresh(rootKey): Promise<void>`：立即重扫这个根并等它发布（跳过 150ms 合并），写入的一方用它等到“目录已是写完的样子”。
- 打开目录时：删掉 `user://stickers/` 里以 `.nbook-stickers-tmp-` 开头的文件夹（只装过没提交的暂存；这个前缀是应用在自己管的目录里的命名空间）。以 `.nbook-stickers-replaced-<原包名>-` 开头的（替换时挪开的旧包）不删也不自动改回：留着，写诊断 `stickers.replace-leftover`（带路径），由用户自己处理。自动改回要判断替换走到了哪一步，判断错会复活已经替换掉的旧包，不值得。以点开头的本来就不是表情包。

### `stickers/shared/contracts.ts`：详情、远程合同与客户端

- `StickerPackDetail`：条目加 `listed`、`token`（文件夹的身份令牌，扫描时用文件服务的 `identify` 取，和那次扫描的内容一起发布）、每个表情的 `file`、`bytes`、`extras` 与两个总数。整份按序列化后的 UTF-8 字节核对（至多 768 KiB，同浏览器目录），超了从 `extras` 末尾截、总数照实，页面写“还有 N 张没列出”。
- 远程服务 `nbook.stickers` 加方法，逐个在合同里声明 `errors`：`pack({id})`；`createPack({folder, title})`；`updatePack({id, title?, description?})`；`renamePack({id, folder, token})`；`deletePack({id, token})`；`updateSticker({id, file, name, change: {name?, description?, common?}})`；`deleteSticker({id, file, name})`；`listFiles({id, files})`（加进来）；`deleteFile({id, file})`；`copyPack({id})`；`revealPack({id})`。建、改名、复制返回 `{id}`，返回时目录里已经有它（`refresh` 之后）。
- 表情的定位用 `{file, name}`：`name` 是清单里写的原样（没写是 null）。有表情列表的包按两者找清单项（同一个文件写了两项也分得开）；没有表情列表的、以及 `extras` 只按 `file`。对不上或不止一项得 `sticker-missing`。页面的选中键也是这一对。`listFiles` 的 `files` 可以是 `"all"`，由服务端在锁里重列，不用页面看到的（可能截过的）名单。
- Agent 的 `agent/web/sticker-packs.ts` 不动：架构检查只许跨插件导入对方的 `shared/contracts.ts`，客户端不能共用；表情包页自己写取数（要加载中、失败与丢旧结果，本来就不同）。
- 服务键 `stickerAllowlistUsageKey`（定义在 `stickers/shared/contracts.ts`，形状 `{profilesUsing(packId): Promise<readonly string[]>}`）由 `nbook.agent` 的浏览器入口提供。表情包插件**新加一个浏览器入口** `page`（只有设置页用，`settings.pages` 的贡献挂在它下面），对这个键做可选依赖；原来提供 `stickerResolverKey` 的入口不变。服务依赖按入口算，`page` 入口不被 Markdown 依赖，不成环（第 2 轮页面审查第 11 条的提议，比贡献点加接收者简单）。只列**显式**写了这个 id 的 Profile：声明的 `allowed` 是数组且含它，或用户加的 `added` 含它且不在 `removed`；声明 `"all"` 的不列（改名后自动包含新 id）。

### `stickers/backend/editor.ts`（新）：页面的全部写入

- 一个类，拿 `WorkspaceFiles` 与目录。只对 `source: "user"` 的包写，别的得 `not-user-pack`。
- **锁**：按文件夹名的包锁（同一个包的写入排队），导入、导出、复制另有一把全局的归档锁（同时一个，排队至多 4 个，再多得 `busy`）。取锁顺序固定：先归档锁，再包锁（改名涉及新旧两个名字时按码元顺序取两把），再做文件服务的单次操作；只要包锁的操作不取归档锁。锁里从磁盘重读清单与文件夹（不读目录的缓存）。目录的扫描不取这些锁。
- **发布**：写完在锁里调 `catalog.refresh`：它排进目录自己的扫描队列，吸收此前已到的监视事件，扫描期间新来的事件照常再扫；扫描失败作为 `refresh` 的失败交回（写已完成，调用方报“已写入，目录没刷新”，不当成写失败）。改名这类两步之间监视器可能先发布中间状态，最后的 `refresh` 会盖过它，接受。
- 别的程序同时改文件属于尽力而为：条件写冲突时得 `pack-changed`，页面按重扫后的目录显示。
- **改清单**（输出 28）：清单在就 `files.update(清单地址, edit)`（基线冲突重读重算）；不在就 `write(…, {expect: "absent"})`，冲突说明刚有人建了，转去 `update`。`edit` 在每次重算里重新核对：目标项还在且唯一、新名字合规且不重名（NFC）、改完不超过 500 项与 256 KiB，不满足就不写、交回原因（`manifest-full` 等）。没有表情列表时，`edit` 先补一个列表：文件夹里每张图片一项 `{file, common: true}`（包括名字当不了表情名的，它们照旧认不出，等用户在这次或以后给它写名字），超过 500 张得 `manifest-full`，再改目标项。写回用 `JSON.stringify(…, null, 2)`：缩进与键序会变；数字按 JavaScript 能表示的精度写回（超出范围的大整数会变），Spec 28 照此写，不说原样保留。
- **加图片**（输出 29）：`prepareImage(fileName, bytes)` 是纯函数：先读 `metadata`，宽乘高超过 5000 万像素的不解码、拒绝；GIF 与动态 WebP 超限拒绝；静态的按比例缩到 1024 以内，仍超 2 MiB 改存 WebP。写图片用 `expect: "absent"`，撞名就按 `-2`、`-3` 往后试（至多 50 次）；有表情列表的再改清单加一项（名字省略、不常用），这一步失败就删掉刚写的图片（带写完时 `identify` 取的令牌作 `expected`，不删别人刚放的同名文件），整张算失败；补偿也失败时报 `write-failed` 并写明“部分完成，以目录为准”。没有表情列表、已经有 500 张图的包再加得 `manifest-full`。
- **删除表情**：清单里删掉那一项；同一个文件不再被别的项引用时才删文件。**删文件**（没加进来的）只删文件。
- **新建、改包名、删除表情包**：新建先在暂存里建目录、写清单（`{title}`），再改名成正式包名（撞名得 `pack-exists`）。改包名、删除把页面拿到的 `token` 直接作文件服务那一次 `rename`、`delete` 的 `expected`（不是先比一次再操作），文件夹已换成别的得 `pack-changed`；删除消费逐项结果，没删完的照实报“部分完成”。
- **复制到我的**（输出 32）：复制插件包里的清单与文件夹顶层的图片（Spec 32 收窄成这样），合计至多 64 MiB：开始时记下插件根的登记代次（`plugin-roots.ts` 的 `live`）与真实目录，写进 `.nbook-stickers-tmp-<随机>`，全部写完、提交前再核对一次代次，变了就丢弃暂存、得 `pack-changed`（可重试）；没变才改名成正式包名（撞名按 `-2` 往后试）。中途任何一步失败也删掉暂存。
- **导入**（输出 36）：`importZip(bytes, zipName, choice?)`。先核对再落盘：
  - 路径：只接受两种形状（根上一层文件；或恰好一个顶层文件夹里一层文件）；每段拒绝空段、`.`、`..`、以点开头、反斜杠、冒号、控制字符、绝对路径，有任何不合格的项整个 zip 拒绝；以 `/` 结尾的目录项与子文件夹里的文件忽略。
  - 只收清单与扩展名是图片的文件；同一个目标名（按 NFC、不分大小写）出现两次，整个拒绝。
  - 上限按实际解出的字节数算：单个文件至多 32 MiB、合计至多 256 MiB、至多 600 项，超了立即停止解压、丢弃。
  - 清单在的要能解析（`parseManifest`），一张图片也没有的拒绝。
  - 包名：顶层文件夹名或 zip 文件名去扩展名，转小写、非法字符换成连字符、连续连字符合并、去首尾、截到 60 个字符（给 `-2` 留位），空了就 `import-invalid`。
  - 写进暂存，再按冲突处理：没冲突就改名成正式包名。冲突且没给 `choice` 时删掉暂存，交回冲突（已有包的显示名、表情数、前四个表情的文件名、`token`，另存时会用的包名）。`choice: {mode: "copy"}` 改名成下一个空的 `-N`；`{mode: "replace", token}` 把旧包改名成 `.nbook-stickers-replaced-<包名>-<随机>`（这次改名带 `token` 作 `expected`，对不上得 `pack-changed`；旧包已经不在得 `pack-missing`，不当成没有冲突），暂存改名成正式名，删掉旧包；第二步失败就把旧包改回来，改回也失败就留着并写诊断。
- **导出**（输出 35）：清单与文件夹顶层的、文件名按导入规则合格的图片（导入会拒绝的不放进去）；超过 600 项或按 `lstat` 求和超过 64 MiB 得 `export-too-large`；没有图片的得 `export-empty`（导回去会被拒）。读出实际字节、`zipSync` 只存不压后再量一次 zip 的实际大小，超 64 MiB 也得 `export-too-large`。这样导出的一定能导回来。

### `stickers/backend/routes.ts`：三条 HTTP 路由

- 写的两条（上传、导入）只放行 `Sec-Fetch-Site` 为 `same-origin` 或没有这个头，跨站 403 `cross-site`；读的导出照取图的规则。宿主对不允许的 `Origin` 先给 403 `origin-not-allowed`（`nb-host/http/dispatch.ts`），Spec 失败表照实写两种。
- 请求体边收边数（照 `files/backend/upload-route.ts` 的有界读取，挪到共用处，不跨插件导入），超限 413 `{code: "too-large"}`；读体前先占进程级的名额（上传与导入合计同时 2 个，排队至多 8 个，再多 429 `busy`），名额一直占到这次请求的全部工作（读体、解码或解压、写入、清理暂存）做完才放；读体 30 秒没有新字节就断开；请求取消时停下、清理、再放名额。像素上限取 3000 万（RGBA 约 115 MiB，两个同时也在可接受的范围）。
- `PUT /api/nbook.stickers/packs/<id>/images/<文件名>`：至多 32 MiB；200 `{file}`；422 `{code: "image-rejected", reason}`（`reason` 是稳定的码：`type-mismatch`、`unreadable`、`too-many-pixels`、`gif-too-large`、`animated-too-large`、`still-too-large`）；404 `pack-missing`；409 `pack-changed`。
- `POST /api/nbook.stickers/import?name=<zip 文件名>&mode=copy|replace&token=<…>`：至多 64 MiB；200 `{id}`；409 `{code: "import-conflict", existing, copyAs}` 或 `{code: "pack-changed"}`；404 `pack-missing`（替换时旧包已不在）；422 `{code: "import-invalid", reason}`；413、429 同上。
- 上传另有：403 `not-user-pack`、409 `manifest-full`、500 `write-failed`（含部分完成）。
- `GET /api/nbook.stickers/export/<id>`：`application/zip`、`Content-Disposition: attachment; filename*=UTF-8''<包名>.zip`（同 Agent 附件）；413 `export-too-large`、422 `export-empty`、404 `pack-missing`、429 `busy`。响应头发出之后读失败只能断开连接，页面按下载失败通知。
- 取图路由放宽：`extras` 的图（两类）也给，字节核对不变；插件包的 `extras` 同样给（只读预览）。`extras` 的响应一律 `Cache-Control: no-cache` 且不回 304：它们的版本来自扫描，扫描之后被换掉的文件不能被长期缓存（普通表情的同一缺口是取图路由已有的，另记，不在本次改）。

### 失败码

远程方法与路由都只交回下面这些码，文件服务的失败映射过来，不原样透传、不带宿主路径（`no-desktop`、`open-failed` 的路径除外，输出 37 要写）：

`not-user-pack`、`pack-missing`、`pack-exists`、`pack-changed`（文件夹或清单被别处改了、身份对不上、复制途中插件换代）、`folder-invalid`、`name-invalid`、`name-duplicate`、`sticker-missing`、`manifest-full`（超过 500 项或 256 KiB）、`image-rejected`、`import-invalid`、`import-conflict`、`too-large`、`export-too-large`、`export-empty`、`busy`、`permission-denied`、`write-failed`（细节写明是否部分完成）、`refresh-failed`（已写入、目录没刷新）、`no-desktop`、`open-failed`。远程方法在合同里逐个声明它可能交回的码。

### `stickers/web/`：页面

**组件**（各带同名 `.md` 与 props 表，Lab 场景用草稿的样本，含宽图、竖图、不透明方图、英文、390 宽）：

| 组件 | props | 事件或回调 |
|---|---|---|
| `StickerPacksPage` | `state: "loading" \| "ready" \| {failed}`、`packs`（概要）、`detail`（选中包的详情或 null，自带 `id` 与 `token`；与选中的 id 不同时当作还没到）、`uploads`（进行中的上传，按包分）、`initial?` | 回调都是 `Promise`：`createPack`、`renamePack`、`copyPack` 交回 `{id} \| {reason}`；`importZip(file, choice?)` 交回 `{id} \| {conflict} \| {reason}`；`updatePack`、`updateSticker`、`deletePack`、`deleteSticker`、`deleteFile`、`listFiles` 交回 `{reason} \| null`；`allowlistUsage(id)` 交回名单或 null（不知道）。改名、删除、替换用的 `token` 取自打开对话框那一刻的 `detail`。事件：`select`、`add-images(id, files)`、`export(id)`、`reveal(id)`、`retry` |
| `StickerPackRail` | `groups`、`current`、`disabled?` | `select`、`create`、`import` |
| `StickerGrid` | `pack`（详情）、`selected`（文件名或 null）、`uploads`、`readonly` | `select`、`add-images`、`list-files`、`delete` |
| `StickerFields` | 一个表情或一张 extras 图、`readonly`、`pending`、`status` | `commit(target, change)`（`target` 是提交那一刻的 `{packId, file, name}`）、`delete`、`list`、`back` |
| `PackFields` | 详情、`readonly`、`pending`、`status` | `commit(target, change)`、`rename` |
| `StickerPackNameDialog` | `mode: "create" \| "rename"`、`busy`、`status`、`usage`（改名时用到它的 Profile：加载中、名单、未知） | `submit`、`edit` |
| `ImportConflictDialog` | 冲突信息、本地 zip 的预览图、`busy`、`status` | `choose(mode)`：选了以后对话框开着显示 `busy`，失败把原因写进 `status`，成功才关 |

- 对话框的 `busy` 与 `status` 由 `StickerPacksPage` 持有（同 Profile 页的新建）：回调交回之前 `busy`，交回 `{reason}` 写进 `status`、不关。删除确认用 `AlertDialog`，确认后先关再做，失败走通知（同 Profile 页删除）。
- `packs-page.ts` 管：订阅 `changed` 与取概要（丢晚到的旧结果）、选中包的 `detail`（选中变了就重取，旧的丢掉）、上传队列（按包，同时 3 张）、字段写入队列（按包）、远程失败码到文字与通知。设置窗口关掉时，进行中的上传照样传完（不中断请求），结果用工作台通知汇总；没开始的从队列里丢掉。
- 属性栏是 `StickerFields` 与 `PackFields` 二选一的外框，顶上有“返回表情包”。左栏与 Profile 页的 `ProfileRail` 有意各写一份（数据形状不同），保留同样的方向键与 roving tabindex。
- **页面状态**：沿用 Profile 页三态（加载中、读失败加重试、就绪）；已显示后重取失败不换成失败态。第一次打开选中分组后的第一项（“我的”在前）。无效的表情包照样在左栏（零个、错误图标），右边写原因，可用“在文件夹中显示”、删除，文件夹名不合规的还能改包名，不能导出。没有缩略图时用图标。表情包页不看设置的 `writable`（它不写设置）。
- **选中**：表情按文件名记；页面自己做的新建、改名、复制、导入完成后选中交回的 id（交回时目录里已有它）；只有别处删掉了选中的包，才回到第一项。改名时选中的表情与草稿清空。
- **网格**：每组一个 `role="listbox"`（`aria-labelledby` 指向组头的标题元素），里面只有 `role="option"` 的格子与 `aria-selected`；listbox 用 `display: contents`，“添加”格是 listbox 外面的普通按钮，视觉上排在同一个网格里。焦点即选中：方向键左右按顺序移动（跨组接续），上下按当前组实际的列数移动（从网格的计算样式量列数；到组边就进上一组或下一组同列，没有同列取最后一格），Home、End 到全部表情的头尾；Delete 删除选中的那一个（先确认）；Esc 取消选中回到表情包。只有一个 tabindex=0 的格子（roving）。格子里的图 `alt=""`（名字在下面的文字里），图片 `loading="lazy"`、`decoding="async"`。空的表情包（还没表情）画一个整格的落点，写“拖进图片或选择文件”；“添加”格排在最后一个有表情的组（常用或其他）末尾，没有组时单独一行。happy-dom 没有布局，上下方向键在 e2e 里测，左右、Home、End、Delete、Esc 在 DOM 测试里测。
- **添加图片**：“添加”格是一个按钮，点开隐藏的 `<input type="file" multiple accept="image/png,image/gif,image/webp,image/jpeg">`；拖放的窗口级兜底照插件页（含文件的拖动在整个设置窗口 `preventDefault`，落在网格外不导航，`dropEffect` 在网格外与只读包上是 `none`，离开窗口才收起覆盖层）；拖进来的文件夹（`size` 为 0 且没有类型）跳过并在汇总通知里写出。上传按包排队，同时至多 3 张，网格末尾为每张画一个转圈的占位格；切到别的包上传照样进行，结束后汇总一条通知；包在上传途中被删或改名，剩下的得 `pack-missing`、计入汇总。
- **字段提交**：名字、显示名用 `Input` 的本地草稿，回车（`keydown`）或失焦（`blur`，不用 `change`：nb-ui 的 `Input` 不发它，原生的 `change` 会和回车各提交一次）提交，值没变不提交，Esc 还原；说明用 `Textarea`，失焦提交。提交时带上那一刻的目标（不读当前选中）。同一个包的提交排队；草稿保持显示，直到写入交回之后重取的 `detail` 里已是新值（或写入失败，回到 `detail` 的值并通知）才清掉，所以不会闪回旧值；收到 `changed` 不覆盖正在编辑（有焦点）的字段。名字清空等于“用文件名”（文件名当不了名字时不合规）。校验错误用 `Field` 的 `error`（标红、读屏关联），看得见的原因写在属性栏底部一行固定高度的状态行（不在输入框下插字，ui-development-spec 第 5 节第 7 条）；对话框写在 `Dialog` 的 `status`（同 `NewProfileDialog`：提交过一次才标红）。认不出的图在改好名字之前，说明与常用不能改。
- **导入冲突**：页面收到 409 后用 `fflate` 在浏览器里读本地 zip 的前四张图画右侧预览（读不了就只写名字与数目），显示服务端给的另存包名；选择后带 `mode` 与 `token` 再传一次（64 MiB 以内，本机传两遍接受）；本地文件读不了时通知“文件读不到了，重新选择”。
- **焦点**：删表情后到下一格（没有则上一格，再没有则“添加”格）；删包后到新选中的左栏项（窄时到下拉）；对话框关闭后回到触发它的按钮；等关闭动画的写法同 Profile 页输出 23。
- **窄**：容器查询，页面窄于 600px 时左栏收成顶上的下拉加“新建”“导入”，属性栏排到网格下面，选中格子时把属性栏滚进可见区。
- **写入失败**：远程方法的失败码映射成文字走工作台通知；网络断开、请求结果不知道时通知“结果未知”，并重取一次目录。导出用 `fetch` 拿到 zip 后经 `a.download` 保存（同主题包导出），失败（`export-too-large` 等）走通知。
- **登记**：表情包浏览器入口向 `settings.pages` 贡献 `nbook.stickers.packs`（分类 `ai`、`order` 32、`layers: ["user"]`、`layout: "fill"`），`load` 按需导入页面。文字进表情包插件自己的消息目录，中英两份，带插值的句子用占位符。

### `agent/web/`

- 浏览器入口提供 `stickerAllowlistUsageKey`：用 Profile 目录与 `profileSettings`，按上文的“显式”规则返回显示名。Agent 入口受阻或失败时，表情包的 `page` 入口拿不到这个键，改名对话框写通用的提醒。

## Spec 与文档改动

`docs/specs/agent/stickers.md`（已在 master 上，planned）随这一版改：输出 25（选中规则、无效包、第一项按分组）、27（返回入口、状态行、认不出的图不能改说明与常用）、28 与 31（原因写在状态行或对话框页脚）、29（像素上限、占位格、汇总通知）、32（收窄为清单与顶层图片）、33（只列显式写了 id 的 Profile）、35（64 MiB 导出上限）、36（路径与形状规则、按实际字节计数、`token`）、37（不建目录）；失败表加 `pack-changed`、`busy`、`too-large`、两种来源拒绝。实现后逐条核对、去掉 planned、补实现合同与证据。

## 切片

1. **读的一侧**：`open-folder` 拆分；目录的 `listed`、`extras`、总数、概要两个整数、`refresh`、启动时的暂存与挪开旧包的处理；`pack` 详情与字节预算；取图路由放宽（extras 不长期缓存）。测试：`stickers.test.ts` 加详情、extras、概要计数、取图 extras、两种前缀文件夹（暂存删、旧包改回或留着）、`refresh` 后立即可读、扫描失败时 `refresh` 失败；`revealPack` 没有桌面时得 `no-desktop` 且不建目录，链接与插件撤回后得 `pack-missing`。
2. **写的一侧**：`editor.ts` 的锁、改清单（含补列表、`{file, name}` 定位、重算核对）、新建、改包名、删除（`token`）、加进来、删文件、删表情（共享文件）、复制；远程方法与错误声明。测试：真实目录、真实文件服务与真实远程调用（同现有场地），每条输出一组，另加两个并发改同一包、清单只有 `title`、身份对不上。
3. **上传与 zip**：`prepareImage`（纯函数单测：缩小、转 WebP、GIF 与动态 WebP 拒绝、像素上限）；三条路由；导入的路径、形状、重名、计数上限（一个声明很小、解开很大的项）、冲突两种、替换中途失败改回；导出上限与往返。测试经真实 HTTP 分发：跨站、413、429、取消释放名额。
4. **页面**：七个组件、`packs-page.ts`、登记、文字、Lab；Agent 的贡献与客户端替换。测试：页面 DOM 测试（三态、选中与改名后仍选中、网格方向键与 Delete 后的焦点、字段提交与 Esc、失败回退、空包落点、拖到网格外不导航、只读包、冲突对话框的预览与选择、改名对话框列出 Profile 与“all”不列）；Lab 截图看亮暗、390 宽与英文。
5. **验收与收口**：e2e 验收 9、10（加图用隐藏输入框的 `setInputFiles`），另加网格上下方向键一条（要布局）；Spec 逐条核对后去掉 planned。

每片单独提交，片内自跑：`bun test src/plugins/stickers src/plugins/agent/stickers-slot.test.ts`（第 4 片加 `src/plugins/agent/web`）、`bun run typecheck`。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 25、26、27、38 | 第 4 片页面 DOM 测试；Lab 截图 |
| 输出 28、30、31、32、33、34 | 第 2 片 `stickers.test.ts` 写入用例；33 的 Profile 名单在第 4 片 |
| 输出 29 | 第 3 片 `prepareImage` 单测与上传路由用例；占位格与汇总通知在第 4 片 |
| 输出 35、36 | 第 3 片导出、导入用例；e2e 验收 9、10 |
| 输出 37 | 第 1 片：没有桌面的环境下得 `no-desktop` 且不建目录；Skill 的现有用例照过 |
| 失败表各行 | 第 2、3 片各用例；来源拒绝在路由用例 |
| 验收 9、10 | `e2e/stickers.e2e.ts` 新增两条 |

## 验证

- 每片的 bun 测试与类型检查。
- 合入前 e2e：`stickers.e2e.ts`（含新增两条）、`agent-profiles.e2e.ts`、覆盖设置窗口左栏的一个文件。直接跑 Playwright 前先构建 server、web、e2e 三份产物，并先看负载。实施中只重跑改动覆盖的文件。
- 未验证边界：macOS、Windows 的“在文件夹中显示”；别的程序与页面同时改同一个清单（尽力而为，条件写冲突时报 `pack-changed`）。

## 不做与风险

- 不做：拖动排序、多选、裁剪、撤销、表情包市场、白名单迁移（Spec 的“不承诺”）。
- 风险：页面改清单会重新排版（缩进、键序），值不变；交付时说明。
- 风险：替换、复制、导入不是原子的；中途断掉时暂存在下次打开目录时删掉，挪开的旧包留着并写诊断（不自动改回），由第 1 片用例兜底。
- 取图的已有缺口不在本次改：扫描之后、重扫之前文件被换成链接或别的图，取图会给新字节而版本仍是旧的（窗口约 150ms，链接也只能指向同一个包里的图）。
