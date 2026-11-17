# t09 链接与图片的插入：实施计划（第一稿）

## Context

编辑器里现在不能新建链接与图片：工具栏与选区菜单的链接按钮要等命令 `nbook.edit.link` 登记才出现，正文不处理图片的粘贴，浏览器也没有往作品里写图片字节的办法（`files` 服务只写文本，二进制只有主题素材那一条 `PUT`）。这个 Task 补上链接卡片、插图卡片、粘贴图片、图片存放设置与后端的上传接口。

开发者已定（[README](README.md) 的“决定”1–6，评审板第 1 轮四题都取推荐）：

1. 范围：链接卡片、插图的“选本机文件”与“粘贴”、浏览器往作品里写图片的上传接口、图片存放设置；不做拖放（归 w00046 t15，它调这里的上传接口与插图函数）。上传接口按“单个文件写到作品里的某个地址”设计，与按地址读字节对称。
2. 链接卡片一行、只填地址；链接文字是选中的字，没选字时取文件标题或网址；改已有链接时预填地址、多一个“去掉链接”。
3. 插图走插图卡片（斜杠菜单“图片”与工具栏）：先列存放目录里最近的图，打字找作品里的图，能粘贴网址，上传按钮选本机文件；正文里直接粘贴图片照常插入、不经卡片。
4. 粘贴、上传的图缺省存到作品根下的 `插图/`；设置照 Obsidian 四种，跟着作品走。
5. 存成普通图片文件。
6. 地址相对当前文件；按住 Ctrl 点链接打开、单击仍是编辑；选的文件保留原名，粘贴的图按日期时间命名，重名加序号不覆盖；只收常见图片格式，上限 32 MiB。

Spec（已写，planned）：[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“写入图片”与验收场景 12；[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 52–58、验收场景 27–30、命令表三行、设置；[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 18 的相对地址一条沿用。

开发者在场，计划确认后实施；不 push。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 上传的传输 | 在 `nbook.files` 的 HTTP 路由上加 `PUT /api/nbook.files/raw/project/<id>/<代次>/<路径…>`，请求体是原始字节，写入经服务端已有的 `ownWorkspaceFiles.write(address, bytes, {expect: "absent", createParents: true})` | 与读取同一个地址，形状对称（开发者决定 1）；这条写入已经走“暂存、提交、记账、变更事件”的提交链，主题素材路由用的就是它，`project://` 地址由它转给项目实例提交；`expect: "absent"` 给出排他创建，重名并发也安全 | 远程服务（单条消息 1 MiB，装不下图）；`multipart/form-data`（要多一层解析，只传一个文件用不上）；新建一套暂存与提交 |
| 类型判定 | 按文件头字节手写判定 PNG、JPEG、GIF、WebP（`shared/image-type.ts` 的 `sniffImageType` 已有三种，只收 PNG、JPEG、WebP，封面与主题素材共用，不能放宽，所以这条路由自己多一个 GIF 的判定） | 四个魔数，已有先例；不信客户端给的类型与文件名 | 加 `file-type` 之类的库（体积与依赖都为四个魔数不值）；放宽共用的 `sniffImageType`（会让封面与主题素材也收 GIF） |
| 相对地址 | 手写 `relativeAddress(from, to)`，只处理 `/` 分隔的资源路径，放在 nb-markdown（纯 TS，带测试） | 十行；浏览器里没有 `node:path`；解析方向的另一半（`classifyTarget`、相对解析）已经在 `markdown/shared/targets.ts` | 引入 `pathe`（为一个函数加依赖） |
| 选本机文件 | 隐藏的 `<input type="file" accept>`，由“上传”按钮触发 | 浏览器与桌面壳同一份（桌面壳是浏览器内核）；没有别的需要 | 新的原生对话框接口 |
| 找作品里的图 | 文件服务的 `find({query, limit})`（按名字找，`@` 菜单在用），结果在客户端按扩展名滤成图片 | 已有；至多 100 条的上限足够取 12 张 | 给 `find` 加扩展名过滤（要改合同，等有需要再加） |
| 存放目录里的图 | 文件服务的 `list(目录)`，滤成图片、名字倒序、取 12 张 | 已有；见下“待确认 1” | 列目录项时带修改时间（`list` 现在不 `stat` 每一项，加了每个目录都多一次系统调用） |

## 关键设计

### 后端：上传路由（`packages/neuro-book/src/plugins/files/backend/`）

- 新文件 `upload-route.ts`，由 `backend/plugin.ts` 的服务端入口挂到同一个路由器（`addThemeAssetRoutes` 旁边）；路由器已按 `nbook.http` 的 `http.routes` 贡献出去，不动贡献点。
- 项目代次与根身份的核对：抽出 `raw-route.ts` 里“按登记核对代次与身份文件、取项目根”的那一段（现在是读取路由私有的），读写两条路由共用，状态码一致（410 `generation-gone`、409 `identity-conflict`）。写入本身经 `ownFiles.write("project://<路径>", …)` 交项目实例提交，路径包含、符号链接与控制目录的规则在那里执行（`rooted.ts`），不在路由里再写一份。
- 检查顺序（与主题素材路由同样是合同的一部分）：来源（`Sec-Fetch-Site` 不是 `same-origin` 为 403；`Origin` 由 `nb-host` 的分发层已核对）→ 代次与身份 → 名字（单段规则，扩展名在允许集合里）→ 请求体限长 32 MiB（Hono `bodyLimit`，超过为 413；空体为 400）→ 按字节判定类型（415 `unsupported-type`）→ 扩展名与类型一致（415 `extension-mismatch`）→ 写入。
- `exists=rename`：按 `名字 2.扩展名`、`名字 3.扩展名`……逐个 `expect: "absent"` 写，第一个成功的就是结果，至多到 `名字 100`；每次写入都是独立的暂存加提交，字节留在内存里（上限内有界）。目标是目录或链接时同样是冲突。
- 响应 201 `{address, renamed}`；错误体 `{error: {code, message}}`，状态码映射写成一张表，和读取路由并排放。
- 浏览器客户端：`files/web/client.ts` 在 `rawUrl` 旁加 `upload(address, body, {exists?, signal?})`：没绑定项目或不是 `project://` 时返回 `unavailable`；请求体超过 32 MiB 时在客户端就返回 `too-large`、不发出；结果是自己的 `UploadResult`（`{ok: true, address, renamed}` 或 `{ok: false, code, detail}`，码是 `unavailable | too-large | unsupported-type | extension-mismatch | conflict | invalid-address | permission-denied | generation-gone | cross-site | io-failed | network`），不加进 `FILES_FAILURES`（那是远程合同的失败码表，加了要改合同）。

### nb-markdown：动作与粘贴（`packages/nb-markdown/src/editor/`）

- `editing-actions.ts`：加 `link`（`{href}`：有选区把选中的字加上链接标记；没有选区在光标处插入一段链接，文字由调用方给的 `label` 或地址本身）、`link-remove`（去掉光标处或选区碰到的整条链接，文字留着）、`image`（`{src, alt?}`：在光标处插入图片节点）。链接的标记与“整条链接”的范围沿用方言里已有的链接标记；注音整体的补步（`whole-ruby.ts`）不受影响（链接在“格式”清单里）。
- 导出插图函数 `insertImages(editor, images)`：一张或几张，几张时各自成一段；t15 的拖入直接调它。放在 `editor/index.ts` 的公开出口。
- `relativeAddress(from, to)`、`resolveAddress` 的反向，放 `markdown-dialect.ts` 或 `targets.ts`，纯 TS 带测试。
- 粘贴：新的 ProseMirror 插件（`image-paste.ts`），`handlePaste` 里读 `clipboardData`：只有图片文件、没有 `text/plain` 与 `text/html` 时接手，其余交回原来的粘贴。接手后调宿主给的 `images.upload(file)`（经 `MarkdownViewHost` 加一个可选字段），传完才插入；传的过程中文档照常可编辑，插入位置取传完时记住的光标映射后的位置。失败调宿主给的 `report`。没有宿主能力（Lab、提示词编辑器不带这个插件）时插件不装。
- Ctrl（⌘）点链接：`handleClick` 里认 `event.ctrlKey || event.metaKey` 且命中链接标记时，交宿主的 `openLink(href)`，并阻止默认；单击照旧。

### neuro-book：设置、能力与界面

- 设置：`editor/shared/settings.ts` 加 `imageLocationSetting`（`choices` 四项，缺省 `folder`）与 `imageFolderSetting`（字符串，缺省 `插图`，schema 的 pattern 拒绝 `..`、前导 `/` 与 `.nbook`），两层都能设（缺省的 `layers`），在“编辑器”分区；设置窗口的页面由声明生成，不另写页面。
- 能力：`EditorMenus`（`editor/shared/contracts.ts`，编辑器插件给 Markdown 控件的上下文）加可选的 `media`：`{destination(currentAddress, fileName): string; upload(file, name): Promise<UploadResult>; recent(): Promise<ImageEntry[]>; find(query): Promise<ImageEntry[]>; thumbnail(address): string | null; openLink(href, currentAddress): void; pasteName(date): string}`。编辑器插件实现它：读设置算存放目录、调 `files.upload`、`files.list`、`files.find`、`rawUrl`，`openLink` 外部地址 `window.open(href, "_blank", "noopener")`、作品里的地址调 `nbook.editor.open`。控件只用这个对象，不直接引文件服务（与现在批注页边、菜单状态的接法一致）。没有绑定作品时 `upload`、`recent`、`find` 返回 `unavailable` 或空。
- 链接卡片：直接用 `MarkdownTextPrompt.vue`（注音与双语在用，已有 `initial`、`removeLabel` 与 `remove` 事件）：预填地址、“去掉链接”、清空再确认是取消；入口接 `MarkdownToolbar.vue`、`MarkdownSelectionMenu.vue` 的链接按钮（`LINK_COMMAND` 登记后才出现）和 Ctrl+K（控件的键位）。
- 插图卡片：新组件 `MarkdownImageCard.vue`（同名 `.md`、Lab 场景）：输入、图片列表（缩略图、名字、所在目录）、“上传”按钮、键盘上下选与回车；浮层定位同注音卡片（`AnchoredPopover`）。输入为网址时列表只有“插入网址的图片”。
- 入口：工具栏加图片按钮（链接按钮旁），斜杠菜单“块”组加“图片”，`EDITING_ACTIONS` 加 `link`、`link-remove`、`image` 三项并登记命令（`nbook.edit.link`、`link-remove`、`image`）；公开键加 `formatLink`。
- 文字：`nbook.editor` 与 `nbook.markdown` 的目录各加键，中英文都写。

## Spec 与文档改动

- 已写（planned）：`workspace/files.md`、`workbench/markdown-editing.md`（见上）。
- 实现完成后：两份 Spec 去掉“（planned）”、补实现合同与证据；`MarkdownControl.md`、`MarkdownTextPrompt.md`、新组件的 `.md`、应用 CHANGELOG（`## [Unreleased]`）。
- `workspace/markdown-dialect.md` 输出 18 的“新建时写相对地址（planned）”随本 Task 去掉标记。
- t10 的 Spec 不承诺里“按属性名给图标、类型的贡献点”由 t25 处理，与本 Task 无关。

## 切片

1. **后端上传接口**：`upload-route.ts` 与代次核对的抽取、客户端 `upload`、合同测试（真实项目实例与真实 HTTP）；Spec 场景 12。提交边界：路由、客户端、测试各一个提交。
2. **nb-markdown 动作与粘贴**：`link`、`link-remove`、`image` 动作与 `insertImages`、`relativeAddress`、粘贴插件、Ctrl 点链接；DOM 测试。
3. **设置与能力**：两条设置、`EditorMenus.media` 与编辑器插件的实现、文字目录；测试（真实设置服务、真实文件服务）。
4. **界面**：链接卡片、插图卡片、入口（工具栏、选区菜单、斜杠菜单、Ctrl+K）、Lab 场景、组件文档。
5. **收口**：`e2e/markdown-links-images.e2e.ts`、文档、变更记录、Spec 晋升前的逐条核对。

每片单独提交。审查：第 1 片是后端，交 omp 会话（默认模型）；第 2 到 4 片是前端，交一个 Claude Sonnet；都是处理完再合入。

## 验收映射

| Spec | 覆盖 |
|---|---|
| files 写入图片（全部条目）、场景 12 | `files/upload-route.test.ts`：真实项目实例与真实 HTTP，覆盖路径包含、控制目录、代次、类型与扩展名、大小、不覆盖与 `rename`、并发同名、父目录自动建出、变更事件；浏览器客户端的 `upload`（没绑定、过大不发出） |
| 编辑 输出 52、场景 27 | 动作的 DOM 测试（选区、光标处、改链接、去掉链接）；卡片的 DOM 测试；e2e：Ctrl+K 的真实键入 |
| 输出 53 | 插件的 DOM 测试（Ctrl 点与单击）；e2e：外部网址开新标签页、作品里的文件在编辑器区打开 |
| 输出 54、场景 29 | 卡片的 DOM 测试（列表、搜索、网址、上传）；`media` 的测试用真实文件服务；e2e：选本机文件 |
| 输出 55、场景 28 | 粘贴插件的 DOM 测试（只有图片、图文都有、多张、失败）；e2e：用 Chrome 的剪贴板接口放进一张图再按 Ctrl+V，核对磁盘 |
| 输出 56 | `destination` 的单元测试（四种位置、非法目录名退回缺省、重名）；e2e 场景 28 里切设置 |
| 输出 57 | `relativeAddress` 的随机测试（任意两个地址，解析回来等于原目标）；方言往返测试 |
| 输出 58、场景 30 | DOM 测试（只读、没绑定作品）；e2e |

## 验证

- 每片：`bun run test:affected --files`（提交前去掉 `--files` 再跑一次），`tsc --noEmit`、两份 `vue-tsc`。
- 后端：第 1 片在真实 HTTP 上跑完（不是直接调路由函数）；上限相关的用例用 33 MiB 的真实请求体。
- e2e：新文件 `markdown-links-images.e2e.ts`；合入前跑一次：`markdown-links-images`、`markdown-editing`、`markdown-input`、`markdown-properties`、`editor-types`（读取路由的代次核对被抽出来了）、`editor-area`；之后只重跑改到的文件与失败项。
- 未验证边界：桌面壳里的文件选择框与系统剪贴板（浏览器内核，但没有真机），留给开发者试用。

## 不做与风险

- 不做：拖放；SVG、BMP、AVIF；多选文件；压缩、改名、缩放；图片说明与对齐的界面；删图片时删磁盘文件；链接卡片里搜文件；`user://` 的上传。
- 风险：抽出读取路由的代次核对时改坏读取。由 `raw-route.test.ts` 与 `e2e/editor-types.e2e.ts` 兜底，抽取前先确认这两处覆盖到 410、409、404 三种。
- 风险：写入来源。路由在服务端，写入的来源记为系统（同主题素材），资源管理器的变更事件照常；如果文件树对“系统来源”的新文件有不同的呈现，第 1 片的合同测试要看到它。
- 风险：粘贴插件抢了普通的粘贴。判据写死“只有图片文件、没有任何文字类型”才接手，DOM 测试用“图文都有”与“只有文字”对照。
- 风险：传输中途文档被改。插入位置用传完时的光标映射，文档被换成别的文件（切标签）时丢弃结果、不插入，并给通知。

## 待确认

1. **“最近的图”按名字倒序，不按修改时间**：文件服务的 `list` 不带修改时间，加了每个目录都要多一次 `stat`；粘贴的图叫“粘贴的图片 年月日-时分秒”，名字倒序就是新的在前，选的本机文件保留原名时次序不一定新旧。要按真正的修改时间，需要给目录项加可选的 `modified`（改远程合同，是个后端的小改动）。推荐按名字倒序。
2. **图片格式只收 PNG、JPEG、GIF、WebP**：SVG 没有固定的文件头、要另做检查，AVIF 与 BMP 少见；以后要加是在判定函数与 Spec 各加一条。
3. **粘贴命名**：`粘贴的图片 20261117-140533.png`（本机时间）。
4. **链接卡片的细节**：没选字时链接文字取文件名（去掉扩展名）或网址；改链接时选区碰到几条地址不同的链接，不预填、只能去掉链接；输入 `project://` 开头的地址会改写成相对地址，别的原样。
5. **剪贴板里图文都有时仍当文字粘贴**（例如从网页复制的图文）；只有截图、文件时才当图片。
6. **快捷键 Ctrl+K（⌘K）打开链接卡片**，没有别的全局绑定占着它。
7. **设置放在“编辑器”分区**（`nbook.editor/imageLocation`、`imageFolder`），两层都能设、项目层优先；作者要“跟着作品走”就在“本作品”那一页设。
