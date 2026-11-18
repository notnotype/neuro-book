# t08 计划：表情包设置页

第 2 版，按设计审查改过（后端 omp 13 条、页面 Sonnet 17 条，处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)）。

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

从 `agent/backend/skills/folder.ts` 拆出 `openExistingFolder(path, env, platform)`：不建目录，先 `lstat` 确认是目录且不是链接，再判断桌面与 `open`；失败交回 `no-desktop` 或 `open-failed`（带 `path`）。Skill 的 `openFolder` 保留自己的 `mkdir -p`，再调它。表情包调用时路径从目录按 id 现取（用户包与插件包的真实目录），不收用户给的路径。

### `stickers/backend/catalog.ts`：目录多记几样

- 每个表情包多记：`listed`（清单写了表情列表）；`extras`：名字当不了表情名但字节是相符图片的（`reason: "name"`），有列表时文件夹里没列的图片（`reason: "unlisted"`），各带宽高、版本、字节数，核对复用 `readImage` 与按戳记的缓存；有列表的包为此多列一次文件夹。`extras` 每类至多 500 项，另记总数。
- 概要（`packs`，给左栏与 Profile 页）加两个整数 `unrecognized`、`unlisted`；字节预算照旧。
- 变更判断把 `listed`、`extras` 也算上：只多了一张没加进来的图也发 `changed`。
- `refresh(rootKey): Promise<void>`：立即重扫这个根并等它发布（跳过 150ms 合并），写入的一方用它等到“目录已是写完的样子”。
- 打开目录时：删掉 `user://stickers/` 里以 `.nbook-stickers-tmp-` 开头的文件夹（只装过没提交的暂存）；以 `.nbook-stickers-replaced-` 开头的（替换时挪开的旧包）不删：原名空着就改回原名，占着就留着并写诊断 `stickers.replace-leftover`（带路径）。以点开头的本来就不是表情包；这两个前缀是应用的命名空间。

### `stickers/shared/contracts.ts`：详情、远程合同与客户端

- `StickerPackDetail`：条目加 `listed`、`token`（文件夹的身份令牌，取自文件服务的 `identify`）、每个表情的 `file`、`bytes`、`extras` 与两个总数。整份按序列化后的 UTF-8 字节核对（至多 768 KiB，同浏览器目录），超了从 `extras` 末尾截、总数照实，页面写“还有 N 张没列出”。
- 远程服务 `nbook.stickers` 加方法，逐个在合同里声明 `errors`：`pack({id})`；`createPack({folder, title})`；`updatePack({id, title?, description?})`；`renamePack({id, folder, token})`；`deletePack({id, token})`；`updateSticker({id, file, name, change: {name?, description?, common?}})`；`deleteSticker({id, file, name})`；`listFiles({id, files})`（加进来）；`deleteFile({id, file})`；`copyPack({id})`；`revealPack({id})`。建、改名、复制返回 `{id}`，返回时目录里已经有它（`refresh` 之后）。
- 表情的定位：清单里的项用 `{file, name}`（当前名字）共同定位，清单里同一个文件写了两项也分得开；对不上或不止一项得 `sticker-missing`。`extras` 只用 `file`。
- 把 `agent/web/sticker-packs.ts` 的概要客户端（订阅 `changed`、取概要、丢晚到的旧结果）挪到 `stickers/shared/packs-client.ts`，Agent 与表情包页共用一份。
- 贡献点 `stickers.allowlist-usage`（`implementation: "required"`，`load()` 交回 `{profilesUsing(packId): Promise<readonly string[]>}`）：表情包页改名时按需加载；`nbook.agent` 的浏览器入口贡献实现。用贡献点而不是服务键：表情包浏览器入口提供 Markdown 要的 `stickerResolverKey`，Agent 入口又依赖 Markdown，服务依赖会成环；贡献在用时才加载，不进激活顺序。只列**显式**写了这个 id 的 Profile：声明的 `allowed` 是数组且含它，或用户加的 `added` 含它且不在 `removed`；声明 `"all"` 的不列（改名后自动包含新 id）。

### `stickers/backend/editor.ts`（新）：页面的全部写入

- 一个类，拿 `WorkspaceFiles` 与目录。只对 `source: "user"` 的包写，别的得 `not-user-pack`。
- **同一个包的写入在进程里排队**（按文件夹名一把锁），锁里从磁盘重读清单与文件夹（不读目录的缓存），写完调 `catalog.refresh` 再放锁返回。导入、导出、复制另有一把全局锁（同一时间只做一个，多的排队，队列至多 4 个，再多得 `busy`）。别的程序同时改文件属于尽力而为：条件写冲突时得 `pack-changed`，页面按重扫后的目录显示。
- **改清单**（输出 28）：清单在就 `files.update(清单地址, edit)`（基线冲突重读重算）；不在就 `write(…, {expect: "absent"})`，冲突说明刚有人建了，转去 `update`。`edit` 在每次重算里重新核对：目标项还在且唯一、新名字合规且不重名（NFC）、改完不超过 500 项与 256 KiB，不满足就不写、交回原因。没有表情列表时，`edit` 先补一个列表：文件夹里每张图片一项 `{file, common: true}`（包括名字当不了表情名的，它们照旧认不出，等用户在这次或以后给它写名字），再改目标项。写回用 `JSON.stringify(…, null, 2)`：缩进与键序会变，值不变（JavaScript 解析不了的超大整数这类值不在考虑内）。
- **加图片**（输出 29）：`prepareImage(fileName, bytes)` 是纯函数：先读 `metadata`，宽乘高超过 5000 万像素的不解码、拒绝；GIF 与动态 WebP 超限拒绝；静态的按比例缩到 1024 以内，仍超 2 MiB 改存 WebP。写图片用 `expect: "absent"`，撞名就按 `-2`、`-3` 往后试（至多 50 次）；有表情列表的再改清单加一项（名字省略、不常用），这一步失败就删掉刚写的图片，整张算失败。
- **删除表情**：清单里删掉那一项；同一个文件不再被别的项引用时才删文件。**删文件**（没加进来的）只删文件。
- **新建、改包名、删除表情包**：新建是 `create` 目录加写清单（`{title}`）；改包名、删除带页面拿到的 `token` 作 `expected`，文件夹已换成别的（身份对不上）得 `pack-changed`；删除消费逐项结果，没删完的照实报。
- **复制到我的**（输出 32）：复制插件包里的清单与文件夹顶层的图片（Spec 32 收窄成这样）：写进 `.nbook-stickers-tmp-<随机>`，全部写完再改名成正式包名（撞名按 `-2` 往后试）；中途任何一步失败就删掉暂存。
- **导入**（输出 36）：`importZip(bytes, zipName, choice?)`。先核对再落盘：
  - 路径：只接受两种形状（根上一层文件；或恰好一个顶层文件夹里一层文件）；每段拒绝空段、`.`、`..`、以点开头、反斜杠、冒号、控制字符、绝对路径，有任何不合格的项整个 zip 拒绝；以 `/` 结尾的目录项与子文件夹里的文件忽略。
  - 只收清单与扩展名是图片的文件；同一个目标名（按 NFC、不分大小写）出现两次，整个拒绝。
  - 上限按实际解出的字节数算：单个文件至多 32 MiB、合计至多 256 MiB、至多 600 项，超了立即停止解压、丢弃。
  - 清单在的要能解析（`parseManifest`），一张图片也没有的拒绝。
  - 包名：顶层文件夹名或 zip 文件名去扩展名，转小写、非法字符换成连字符、连续连字符合并、去首尾、截到 60 个字符（给 `-2` 留位），空了就 `import-invalid`。
  - 写进暂存，再按冲突处理：没冲突就改名成正式包名。冲突且没给 `choice` 时删掉暂存，交回冲突（已有包的显示名、表情数、前四个表情的文件名、`token`，另存时会用的包名）。`choice: {mode: "copy"}` 改名成下一个空的 `-N`；`{mode: "replace", token}` 先核对已有包的 `token`（对不上得 `pack-changed`），再把旧包改名成 `.nbook-stickers-replaced-<随机>`、暂存改名成正式名、删掉旧包；第二步失败就把旧包改回来。
- **导出**（输出 35）：清单与文件夹顶层的图片；先按 `lstat` 的大小求和，超过 64 MiB 得 `export-too-large`（这样导出的一定能导回来）；`zipSync` 只存不压。

### `stickers/backend/routes.ts`：三条 HTTP 路由

- 写的两条（上传、导入）只放行 `Sec-Fetch-Site` 为 `same-origin` 或没有这个头，跨站 403 `cross-site`；读的导出照取图的规则。宿主对不允许的 `Origin` 先给 403 `origin-not-allowed`（`nb-host/http/dispatch.ts`），Spec 失败表照实写两种。
- 请求体边收边数（照 `files/backend/upload-route.ts` 的有界读取，挪到共用处，不跨插件导入），超限 413 `{code: "too-large"}`；读体前先占进程级的名额（上传与导入合计同时 2 个，排队至多 8 个，再多 429 `busy`）；请求取消时释放名额与暂存。
- `PUT /api/nbook.stickers/packs/<id>/images/<文件名>`：至多 32 MiB；200 `{file}`；422 `{code: "image-rejected", reason}`（`reason` 是稳定的码：`type-mismatch`、`unreadable`、`too-many-pixels`、`gif-too-large`、`animated-too-large`、`still-too-large`）；404 `pack-missing`；409 `pack-changed`。
- `POST /api/nbook.stickers/import?name=<zip 文件名>&mode=copy|replace&token=<…>`：至多 64 MiB；200 `{id}`；409 `{code: "import-conflict", existing, copyAs}`；422 `{code: "import-invalid", reason}`；413、429 同上。
- `GET /api/nbook.stickers/export/<id>`：`application/zip`、`Content-Disposition: attachment; filename*=UTF-8''<包名>.zip`（同 Agent 附件）；413 `export-too-large`、404 `pack-missing`。
- 取图路由放宽：`extras` 的图（两类）也给，字节核对、缓存头不变；插件包的 `extras` 同样给（只读预览）。

### 失败码

远程方法与路由都只交回下面这些码，文件服务的失败映射过来，不原样透传、不带宿主路径（`no-desktop`、`open-failed` 的路径除外，输出 37 要写）：

`not-user-pack`、`pack-missing`、`pack-exists`、`pack-changed`（文件夹或清单被别处改了、身份对不上）、`folder-invalid`、`name-invalid`、`name-duplicate`、`sticker-missing`、`manifest-full`（超过 500 项或 256 KiB）、`image-rejected`、`import-invalid`、`import-conflict`、`too-large`、`export-too-large`、`busy`、`permission-denied`、`write-failed`、`no-desktop`、`open-failed`。

### `stickers/web/`：页面

**组件**（各带同名 `.md` 与 props 表，Lab 场景用草稿的样本，含宽图、竖图、不透明方图、英文、390 宽）：

| 组件 | props | 事件或回调 |
|---|---|---|
| `StickerPacksPage` | `state: "loading" \| "ready" \| {failed}`、`packs`（概要）、`detail`（选中包的详情或 null）、`uploads`（进行中的上传）、`initial?` | 回调（交回失败原因或 null）：`createPack`、`renamePack`、`copyPack`、`importZip`、`updatePack`、`updateSticker`；事件：`select`、`delete-pack`、`delete-sticker`、`delete-file`、`list-files`、`add-images(files)`、`export`、`reveal`、`retry` |
| `StickerPackRail` | `groups`、`current`、`disabled?` | `select`、`create`、`import` |
| `StickerGrid` | `pack`（详情）、`selected`（文件名或 null）、`uploads`、`readonly` | `select`、`add-images`、`list-files`、`delete` |
| `StickerFields` | 一个表情或一张 extras 图、`readonly`、`pending`、`status` | `commit(change)`、`delete`、`list`、`back` |
| `PackFields` | 详情、`readonly`、`pending`、`status` | `commit(change)`、`rename` |
| `StickerPackNameDialog` | `mode: "create" \| "rename"`、`busy`、`status`、`usage`（改名时用到它的 Profile：加载中、名单、未知） | `submit`、`edit` |
| `ImportConflictDialog` | 冲突信息、本地 zip 的预览图 | `choose(mode)` |

- 属性栏是 `StickerFields` 与 `PackFields` 二选一的外框，顶上有“返回表情包”。左栏与 Profile 页的 `ProfileRail` 有意各写一份（数据形状不同），保留同样的方向键与 roving tabindex。
- **页面状态**：沿用 Profile 页三态（加载中、读失败加重试、就绪）；已显示后重取失败不换成失败态。第一次打开选中分组后的第一项（“我的”在前）。无效的表情包照样在左栏（零个、错误图标），右边写原因，可用“在文件夹中显示”、删除，文件夹名不合规的还能改包名，不能导出。没有缩略图时用图标。表情包页不看设置的 `writable`（它不写设置）。
- **选中**：表情按文件名记；页面自己做的新建、改名、复制、导入完成后选中交回的 id（交回时目录里已有它）；只有别处删掉了选中的包，才回到第一项。改名时选中的表情与草稿清空。
- **网格**：`role="listbox"`，每格 `role="option"` 与 `aria-selected`，roving tabindex；方向键按行列移动（跨组接续），Home、End，Enter 或空格选中，Delete 先确认再删，Esc 取消选中回到表情包；组头是标题元素，组是 `role="group"` 加 `aria-labelledby`；格子里的图 `alt=""`（名字在下面的文字里），图片 `loading="lazy"`、`decoding="async"`。空的表情包（还没表情）画一个整格的落点，写“拖进图片或选择文件”，“添加”格在“其他”组末尾、没有组时单独一行。
- **添加图片**：“添加”格是一个按钮，点开隐藏的 `<input type="file" multiple accept="image/png,image/gif,image/webp,image/jpeg">`；拖放的窗口级兜底照插件页（含文件的拖动在整个设置窗口 `preventDefault`，落在网格外不导航，`dropEffect` 在网格外与只读包上是 `none`，离开窗口才收起覆盖层）；拖进来的文件夹（`size` 为 0 且没有类型）跳过并在汇总通知里写出。上传按包排队，同时至多 3 张，网格末尾为每张画一个转圈的占位格；切到别的包上传照样进行，结束后汇总一条通知；包在上传途中被删或改名，剩下的得 `pack-missing`、计入汇总。
- **字段提交**：名字、显示名用 `Input` 的本地草稿，回车或失焦（`change`）提交，Esc 还原；说明用 `Textarea`，失焦提交。提交时带上那一刻的包与表情（不读当前选中）。同一个包的提交排队；写入中草稿保持显示，收到 `changed` 不覆盖正在编辑的字段；失败回到目录里的值并通知。名字清空等于“用文件名”（文件名当不了名字时不合规）。校验错误用 `Field` 的 `error`（标红、读屏关联），看得见的原因写在属性栏底部一行固定高度的状态行（不在输入框下插字，ui-development-spec 第 5 节第 7 条）；对话框写在 `Dialog` 的 `status`（同 `NewProfileDialog`：提交过一次才标红）。认不出的图在改好名字之前，说明与常用不能改。
- **导入冲突**：页面收到 409 后用 `fflate` 在浏览器里读本地 zip 的前四张图画右侧预览（读不了就只写名字与数目），显示服务端给的另存包名；选择后带 `mode` 与 `token` 再传一次（64 MiB 以内，本机传两遍接受）；本地文件读不了时通知“文件读不到了，重新选择”。
- **焦点**：删表情后到下一格（没有则上一格，再没有则“添加”格）；删包后到新选中的左栏项（窄时到下拉）；对话框关闭后回到触发它的按钮；等关闭动画的写法同 Profile 页输出 23。
- **窄**：容器查询，页面窄于 600px 时左栏收成顶上的下拉加“新建”“导入”，属性栏排到网格下面，选中格子时把属性栏滚进可见区。
- **写入失败**：远程方法的失败码映射成文字走工作台通知；网络断开、请求结果不知道时通知“结果未知”，并重取一次目录。导出用 `fetch` 拿到 zip 后经 `a.download` 保存（同主题包导出），失败（`export-too-large` 等）走通知。
- **登记**：表情包浏览器入口向 `settings.pages` 贡献 `nbook.stickers.packs`（分类 `ai`、`order` 32、`layers: ["user"]`、`layout: "fill"`），`load` 按需导入页面。文字进表情包插件自己的消息目录，中英两份，带插值的句子用占位符。

### `agent/web/`

- 用 `stickers/shared/packs-client.ts` 取代自己的 `sticker-packs.ts`。
- 贡献 `stickers.allowlist-usage` 的实现：用 Profile 目录与 `profileSettings`，按上文的“显式”规则返回显示名。

## Spec 与文档改动

`docs/specs/agent/stickers.md`（已在 master 上，planned）随这一版改：输出 25（选中规则、无效包、第一项按分组）、27（返回入口、状态行、认不出的图不能改说明与常用）、28 与 31（原因写在状态行或对话框页脚）、29（像素上限、占位格、汇总通知）、32（收窄为清单与顶层图片）、33（只列显式写了 id 的 Profile）、35（64 MiB 导出上限）、36（路径与形状规则、按实际字节计数、`token`）、37（不建目录）；失败表加 `pack-changed`、`busy`、`too-large`、两种来源拒绝。实现后逐条核对、去掉 planned、补实现合同与证据。

## 切片

1. **读的一侧**：`open-folder` 拆分；目录的 `listed`、`extras`、总数、概要两个整数、`refresh`、启动时的暂存与挪开旧包的处理；`pack` 详情与字节预算；取图路由放宽；`packs-client` 挪到表情包的 `shared`。测试：`stickers.test.ts` 加详情、extras、概要计数、取图 extras、两种前缀文件夹（暂存删、旧包改回或留着）、`refresh` 后立即可读。
2. **写的一侧**：`editor.ts` 的锁、改清单（含补列表、`{file, name}` 定位、重算核对）、新建、改包名、删除（`token`）、加进来、删文件、删表情（共享文件）、复制；远程方法与错误声明。测试：真实目录、真实文件服务与真实远程调用（同现有场地），每条输出一组，另加两个并发改同一包、清单只有 `title`、身份对不上。
3. **上传与 zip**：`prepareImage`（纯函数单测：缩小、转 WebP、GIF 与动态 WebP 拒绝、像素上限）；三条路由；导入的路径、形状、重名、计数上限（一个声明很小、解开很大的项）、冲突两种、替换中途失败改回；导出上限与往返。测试经真实 HTTP 分发：跨站、413、429、取消释放名额。
4. **页面**：七个组件、`packs-page.ts`、登记、文字、Lab；Agent 的贡献与客户端替换。测试：页面 DOM 测试（三态、选中与改名后仍选中、网格方向键与 Delete 后的焦点、字段提交与 Esc、失败回退、空包落点、拖到网格外不导航、只读包、冲突对话框的预览与选择、改名对话框列出 Profile 与“all”不列）；Lab 截图看亮暗、390 宽与英文。
5. **验收与收口**：e2e 验收 9、10（加图用隐藏输入框的 `setInputFiles`）；Spec 逐条核对后去掉 planned。

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
- 风险：替换、复制、导入不是原子的；中途断掉时暂存在下次打开目录时删掉，挪开的旧包改回原名或留着并写诊断，由第 1 片用例兜底。
- 取图的已有缺口不在本次改：扫描之后、重扫之前文件被换成链接或别的图，取图会给新字节而版本仍是旧的（窗口约 150ms，链接也只能指向同一个包里的图）。
