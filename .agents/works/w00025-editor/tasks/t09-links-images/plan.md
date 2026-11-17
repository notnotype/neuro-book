# t09 链接与图片的插入：实施计划（第二稿）

第一稿经设计审查：后端部分 Claude Opus（[`evidences/design-review-backend.txt`](evidences/design-review-backend.txt)，阻断 1、重要 7、建议 6；omp 的额度用完，按规则改派），前端部分 Claude Sonnet（[`evidences/design-review-frontend.txt`](evidences/design-review-frontend.txt)，重要 11、建议 4），逐条处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。第二稿的主要变化：上传写入改经 `projects://<项目 id>/…`；`find` 加可选的扩展名过滤；共用的图片类型判定改形状；插图能力改成 `nbook.markdown` 的独立注入键 `markdownMediaKey`（不放进 `EditorMenus`）；链接的动作自己写范围；粘贴有占位与串行的时序；`viewHost` 改读“当前挂载”。

## Context

编辑器里现在不能新建链接与图片：工具栏与选区菜单的链接按钮要等命令 `nbook.edit.link` 登记才出现，正文不处理图片的粘贴，浏览器也没有往作品里写图片字节的办法（`files` 服务只写文本，二进制只有主题素材那一条 `PUT`）。这个 Task 补上链接卡片、插图卡片、粘贴图片、图片存放设置与后端的上传接口。

开发者已定（[README](README.md) 的“决定”1–6；2026-11-17 说第一稿“可以，没问题”）：

1. 范围：链接卡片、插图的“选本机文件”与“粘贴”、浏览器往作品里写图片的上传接口、图片存放设置；不做拖放（归 w00046 t15，它调这里的上传接口与插图函数）。上传接口按“单个文件写到作品里的某个地址”设计，与按地址读字节对称。
2. 链接卡片一行、只填地址；链接文字是选中的字，没选字时取文件标题或网址；改已有链接时预填地址、多一个“去掉链接”。
3. 插图走插图卡片（斜杠菜单“图片”与工具栏）：先列存放目录里最近的图，打字找作品里的图，能粘贴网址，上传按钮选本机文件；正文里直接粘贴图片照常插入、不经卡片。
4. 粘贴、上传的图缺省存到作品根下的 `插图/`；设置照 Obsidian 四种，跟着作品走。
5. 存成普通图片文件。
6. 地址相对当前文件；按住 Ctrl 点链接打开；选的文件保留原名，粘贴的图按日期时间命名，重名加序号不覆盖；只收常见图片格式，上限 32 MiB。

Spec（已写，planned）：[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“写入图片”与验收场景 12；[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md) 的“找文件”加 `extensions`；[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 52–58、验收场景 27–30、命令表三行、设置、输出 1、6、11；[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md) 作者规则的一条例外。

开发者在场；不 push。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 上传的传输与写入 | `nbook.files` 的 HTTP 路由 `PUT /api/nbook.files/raw/project/<id>/<代次>/<路径…>`，请求体是原始字节；写入经服务端 `ownWorkspaceFiles.write("projects://<项目 id>/<路径>", bytes, {expect: "absent", createParents: true})` | 与读取同一个地址（开发者决定 1）；这条写入走“暂存、提交、记账、变更事件”的提交链，`projects://` 由服务端从登记找到项目、取租约、在项目目录的暂存区建暂存、交项目实例提交；服务端的 `ownFiles` 不认 `project://`（保留名，只有项目实例里才有），所以不能照第一稿写 | 远程服务（单条 1 MiB）；`multipart`；新建暂存与提交；给 `ProjectsService.acquire` 加代次参数（见下“代次”，竞争窄、危害小，不值得改一个公共门面） |
| 类型判定 | 共用的 `shared/image-type.ts` 的 `sniffImageType` 改成返回 PNG、JPEG、GIF、WebP 四种，调用方（封面、主题素材、主题包导入、这条路由）各用自己的允许集合过滤 | 四个魔数只写一处（第一稿“路由里另写一份”会各自漂移）；封面与主题素材的行为不变，各补一条“GIF 被拒”的用例 | 路由里自己判 GIF；放宽共用函数不加过滤 |
| 相对地址 | 手写 `relativeAddress(from, to)`（纯 TS，nb-markdown），输出过宿主给的 `chips.targets.encodeFile`（编码 `%`、`#`、`?`、空格），第一段含 `:` 时加 `./` | 十行；读取一侧 `classifyTarget` 先去掉 `?`、`#` 之后的部分再解码，所以文件名里有这些字符的必须编码；`MarkdownViewHost.chips` 已经把这套规则交给 nb-markdown | 引入 `pathe`；直接拼地址 |
| 选本机文件 | `<input type="file" accept>`，放在 `MarkdownControl` 一层（不随卡片卸载），点“上传”触发 | 系统选文件框开着时窗口失焦，卡片的 `focusout` 会收起它；input 在卡片里就在 `change` 回来之前被卸载 | input 放在卡片里 |
| 找作品里的图 | `find` 加可选的 `extensions`（Spec 已写），先过滤再排序截断 | 第一稿“至多 100 条足够取 12 张”不成立：章节文件名与标题也参与匹配，同档按路径排，图片会被挤出前 100；加一个可选输入字段是增量 | 在客户端滤；用 `list` 递归 |
| 存放目录里的图 | `list(目录)`，客户端滤成图片、名字倒序、取 12 张 | 已有；`list` 不带修改时间，加了每个目录都多一次系统调用 | 给目录项加 `modified` |
| 插图能力的接口 | `nbook.markdown` 的独立注入键 `markdownMediaKey`（同 `markdownAssetsKey`、`markdownColorsKey`）；`MarkdownImageCard` 经 props 拿它 | `EditorMenus` 是编辑器区交给控件的“菜单”，加文件与设置的七个成员就让它多出一半不是菜单的东西；`thumbnail` 本来就是 `markdownAssetsKey` 的活；Lab 与测试各自 provide；t15 用同一个键 | 放进 `EditorMenus.media` |
| 插图卡片的列表 | 先读 nb-ui `SuggestionMenu.md`：能给列表项加一个前导缩略图插槽就复用它的组合框语义（`aria-activedescendant`、`header` 插槽放搜索框）；不能再说明理由、自己写 | 不再造第二份组合框；缩略图是它缺的，缺口补在 nb-ui | 卡片里自写组合框 |

## 关键设计

### 后端（`packages/neuro-book/src/plugins/files/`）

- **上传路由** `backend/upload-route.ts`，由 `backend/plugin.ts` 的服务端入口挂到同一个路由器（`addThemeAssetRoutes` 旁边）。
- **代次**：只在请求到达时核对：`registry.list()` 里这个 id 正在运行、代次等于 URL 里的，否则 410 `generation-gone`；**不**为写入打开项目根（`raw-route.ts` 的 `createProjectRoots` 已经导出，读取路由在用，写入用不到它，也不必“抽出”什么）。身份由项目实例打开时核对。核对之后、取租约之前项目换代的窄竞争里写入落在新一代的同一个目录，Spec 已写成已知限制。
- **检查顺序**：来源（带了 `Sec-Fetch-Site` 且不是 `same-origin` 为 403，不带的交给 nb-host 已做的 `Origin` 核对）→ 代次 → 名字（单段、主名不空、扩展名在允许集合里）→ 读请求体并限长 32 MiB（在处理器里边收边数，不用放在来源与代次核对之前的中间件，分块传输也数字节；超过 413）→ 按字节判定类型（415 `unsupported-type`）→ 扩展名与类型一致（415 `extension-mismatch`）→ 写入。
- **写入**：`ownFiles.write("projects://<id>/<路径>", …)`，请求的 `signal`（`c.req.raw.signal`）交给它：请求体收完之前取消确定没写，之后取消是结果未知。`exists=rename` 先 `list` 父目录（不存在算空）挑出第一个空着的 `名字 2.扩展名`……（至多 `名字 100`），只写一次；写时仍 `conflict`（并发）就从下一个候选继续；只有被占用才换名字，别的失败立即结束。目标是目录、链接（含悬空）时写入链回 `not-a-file`、`not-found`，路由改报 `conflict` 并按“被占用”处理。
- **状态码**：写一张专用的 `WRITE_STATUS` 表（`shared/` 里，服务端路由与浏览器客户端共用，码表与 Spec 的表一致），不复用读取路由的 `failureResponse`（它把码改成 `not-found`）；`unknown-outcome` 502、`project-unavailable` 503、`not-a-directory` 409；错误体 `{error: {code, message}}`，不照主题素材路由的 `{code, detail}`。
- **并发与内存**：路由里放一个至多 2 个同时处理的队列，其余排队；整份读进内存（上限内有界）。
- **`find` 加 `extensions`**：`backend/files-service.ts` 的 `find`、`shared/contracts.ts` 的输入模式（可选字段）、`web/client.ts`；过滤在排序与截断之前；两份合同（`project`、`user`）同改；`resources.md` 已写。
- **浏览器客户端** `files/web/client.ts` 在 `rawUrl` 旁加 `upload(address, body, {exists?, signal?})` 与 `UploadResult`（`{ok: true, address, renamed}` 或 `{ok: false, code, detail}`，码来自上面那张表加客户端自己的 `unavailable`、`too-large`、`cancelled`、`network`），不加进 `FILES_FAILURES`（那是远程合同的失败码表）；超过 32 MiB 不发出；中途取消得 `cancelled`（调用方要知道图可能已写下）；请求发出前就失败（没连上）才是 `network`。

### nb-markdown：动作、粘贴与点击（`packages/nb-markdown/src/editor/`）

- **链接的动作自己写范围**（Tiptap 的 `setLink`、`unsetLink` 会把链接切碎、留残片，光标折叠时什么也不做，已实验确认）：`link` 把选区碰到的所有链接扩成整条再改地址（选着字且没碰到链接时给选中的字加链接；光标处没有链接时插入一段链接，文字由调用方给的 `label` 或地址本身）；`link-remove` 去掉碰到的整条链接、文字留着；“碰到的几条地址不同”由 `linkAt` 之类的函数返回给卡片用。注音整体的补步不受影响（链接在“格式”清单里）。
- **`image` 动作与 `insertImages(editor, images)`**（公开出口，t15 调它）：每张图是行内节点。光标在不在表格里的空段落、且有几张时各占一段；其余位置依次插在光标处、图之间不加字符（表格单元格只能有一段，劈开段落会写出不可写的文档，已实验确认）；代码块、原样块里不接手，返回 false。
- **Ctrl（⌘）点链接**：Tiptap 的 Link 自带 `handleClickLink`（优先级 1000），点在链接上就选中整条并返回 true，我们的 `handleClick` 到不了。新扩展把优先级设到 1000 以上，只在 `ctrlKey || metaKey` 且命中链接时接手（交宿主 `openLink`），其余返回 false 交给 Link：单击照旧，点在链接上选中整条链接。批注的 Ctrl 点（输出 30）按“链接优先”处理：同一段文字既是链接又是批注时只打开链接。
- **`relativeAddress`**：见技术选型；放 `markdown-dialect.md` 旁边的纯 TS 文件，随机测试的字符集含 `%#? :`、中文、空格、括号。
- **粘贴插件** `image-paste.ts`：
  - `handlePaste` 同步取 `clipboardData.files`（事件结束后 `DataTransfer` 清空）再 `preventDefault`；Ctrl+Shift+V（纯文字）不接手；输入法组字中 ProseMirror 不调它，不处理。
  - 接手判据：有图片文件，且文字部分没有实质内容（纯文字去空白后为空，或每行都等于某个文件名、路径或 `file://` 地址；HTML 去标签后没有文字）；其余照原来的粘贴。
  - 时序：先在光标处放一个占位装饰（插件状态里，随事务映射；换 `EditorState` 时随状态走，换回来仍在），`images.upload` 一张接一张地串行（同秒的几张序号与剪贴板先后一致），每张传完按占位的位置插入（相对地址在插入那一刻按当前 `host.base()` 算）；失败的各报一条通知，成功的照常插入；组件卸载、文档关闭、变只读时 abort 没传的，已传的留在作品里并通知。
  - 类型在传之前按 `file.type` 判四种，不在集合里直接报“格式不支持”，不上传。
- 宿主能力经 `MarkdownViewHost` 加的可选字段进来；没有它（提示词编辑器等）时插件不装。

### neuro-book：能力、设置与界面

- **`viewHost` 改读“当前挂载”**（`MarkdownControl.vue`）：编辑器存在标签的实例槽里，标签移组、拆分时控件卸载重挂走 `kept` 分支、扩展不重建，现有的 `viewHost` 闭包在第一个实例上（`base()` 读的 `bound` 在旧实例卸载后是 null）。新能力一开始就读一个每次 `onMounted` 重写的间接对象，补“挂载、卸载、同一个槽再挂载后上传目录仍对”的 DOM 测试，顺带把图片视图与链接小块的同一个口子一并修。
- **`markdownMediaKey`**（`markdown/web/media.ts`）：`{destination(currentAddress, fileName), upload(file, name, {signal}), recent(currentAddress, {signal}), find(query, currentAddress, {signal}), thumbnail(address)}`，由 `markdown/web/plugin.ts` 在 `withHost` 里提供：依赖文件服务（已有）、设置服务（新增可选依赖）、窗口项目（已有可选依赖）；没绑定作品时 `upload`、`recent`、`find` 返回 `unavailable` 或空。Lab 与测试各自 provide（Lab 用内存文件，能做真实交互）。“宿主没提供”“提供了但没绑定作品”“已绑定”三种状态，卡片与粘贴插件都按 Spec 输出 58 处理。
- **打开链接**：作品里的文件与用户资产经 `EditorMenus` 的命令执行 `nbook.editor.open`（`OPEN_COMMAND`）；外部网址用临时 `<a target="_blank" rel="noopener">` 点击（`window.open` 打开 `mailto:` 会留空白标签页）。
- **设置**（`editor/shared/settings.ts`）：`imageLocationSetting`（四项，缺省 `folder`）、`imageFolderSetting`（字符串，缺省 `插图`，schema 只限长度与不含控制字符），新增“图片”小组（`EDITOR_SECTION_DECLARATION.groups`，中英文标题）；规则放进纯函数 `normalizeImageFolder`（拒绝前导 `/`、`..`、`.nbook`，不合规退回 `插图`），`destination` 与单测都用它。`configuration.md` 的作者规则例外已写。
- **通知带参数**：`EditorMenus.notify(key)` 只收静态键，写不出“某张图过大（40 MiB，上限 32 MiB）”；加 `notify(key, params?)`（兼容旧调用），粘贴与上传的失败文字各一条，中英文都写。
- **链接卡片**：用 `MarkdownTextPrompt.vue`，补 `width`（至少放得下一个网址，窄屏夹在窗口内）与 `confirmDisabled`；`MarkdownMenus.vue` 里写死注音的 `prompting`、标题与移除动作改成带类型的描述对象（动作、文字、提交的参数、移除的动作与图标）；工具栏与选区菜单的链接按钮现在是“直接执行命令”，登记命令后会以空参数执行而什么也不做，改成发 `prompt` 事件，“⋯”里的 `onMore` 同改；`formatLink` 给按下态。
- **插图卡片** `MarkdownImageCard.vue`（同名 `.md`、Lab 场景含读取中、空、出错、`truncated`、英文与 390px）：状态与键盘见 Spec 输出 54；输入去抖，`recent`、`find` 带请求序号与 `signal`，卸载后的迟到结果丢弃；缩略图 `loading="lazy"`、`decoding="async"`、固定尺寸，加载失败给占位；光标折叠时在光标处画竖线（`held-selection.ts` 旁），卡片关闭撤掉；点“上传”置“选文件中”标志、不处理 `focusout`（用 `document.hasFocus()` 区分窗口失焦）。
- **入口**：工具栏加图片按钮（链接按钮旁，`widthOf` 与收纳顺序的测试同改）；斜杠菜单“块”组加“图片”；`EDITING_ACTIONS` 加 `link`、`link-remove`、`image` 并登记命令；公开键 `formatLink`；Spec 输出 1、6、11 已写。
- **文字**：`nbook.editor` 与 `nbook.markdown` 的目录各加键，中英文都写。

## Spec 与文档改动

- 已写（planned）：见 Context 的 Spec 清单。
- 实现完成后：`files.md`、`resources.md`、`markdown-editing.md` 去掉“（planned）”、补实现合同与证据；`MarkdownControl.md`、`MarkdownTextPrompt.md`、新组件的 `.md`、应用 CHANGELOG（`## [Unreleased]`）。
- `workspace/markdown-dialect.md` 输出 18 的“新建时写相对地址（planned）”随本 Task 去掉标记。
- t10 的 Spec 不承诺里“按属性名给图标、类型的贡献点”由 t25 处理，与本 Task 无关。

## 切片

1. **后端**：(a) `sniffImageType` 改形状与三个调用方的“GIF 被拒”用例；(b) 上传路由、`WRITE_STATUS` 表、客户端 `upload`；(c) `find` 的 `extensions`。三个提交。
2. **nb-markdown**：`link`、`link-remove`、`image`、`insertImages`、`relativeAddress`、Ctrl 点链接、粘贴插件；DOM 测试（真实 Tiptap 与真实语言）。
3. **能力与设置**：`viewHost` 改造与它的测试、`markdownMediaKey`、设置与小组、`notify` 带参数、打开链接、文字目录。
4. **界面**：链接卡片、插图卡片、入口、Lab 场景、组件文档。
5. **收口**：`e2e/markdown-links-images.e2e.ts`、文档、变更记录、Spec 晋升前的逐条核对。

每片单独提交。审查：第 1 片后端交一个 omp 会话（额度回来后；用不了改 Claude Opus，同设计审查），第 2 到 4 片前端交一个 Claude Sonnet；处理完再合入。

## 验收映射

| Spec | 覆盖 |
|---|---|
| files 写入图片、场景 12 | `files/upload-route.test.ts`：真实项目实例；至少一条经真实 `Bun.serve`（含分块传输的 33 MiB、请求体发完之前断开连接）；订阅项目的变更，断言新文件与父目录的 `created` 带系统来源；目标是目录、链接、父路径是文件、并发同名、`rename`；浏览器客户端的 `upload`（没绑定、过大不发出、取消） |
| resources `find` 的 `extensions` | 文件服务的合同测试：长篇作品里章节文件多于 `limit` 时按图片找仍找得到图片；`truncated` |
| 共用的类型判定 | `image-type` 单测；封面、主题素材、主题包导入各一条 GIF 被拒 |
| 编辑 输出 52、场景 27 | 动作的 DOM 测试（选区在链接内部与跨链接边界、光标处、改链接、去掉链接、几条地址不同）；卡片的 DOM 测试；e2e：Ctrl+K 的真实键入 |
| 输出 53 | 插件的 DOM 测试（Ctrl 点与单击、链接又是批注）；e2e：外部网址开新标签页、作品里的文件在编辑器区打开 |
| 输出 54、场景 29 | 卡片的 DOM 测试（列表、搜索、网址、状态、上传、选文件框开着不收）；e2e：选本机文件 |
| 输出 55、场景 28 | 粘贴插件的 DOM 测试：只有图片、图文都有、文件管理器（文件加文件名）、网页图（`<img>`）、Word、多张、表格单元格、代码块、一张失败、换标签、卸载；e2e：用 Chrome 的剪贴板接口放进一张图再按 Ctrl+V，核对磁盘（文件头与宽高，不比字节） |
| 输出 56 | `normalizeImageFolder` 与 `destination` 的单元测试（四种位置、非法目录名退回缺省）；e2e 场景 28 里切设置 |
| 输出 57 | `relativeAddress` 的随机测试（任意两个地址解析回来等于原目标，字符集含 `%#? :`）；方言往返测试 |
| 输出 58、场景 30 | DOM 测试（只读、三种宿主状态）；e2e |
| `viewHost` 重挂 | DOM 测试：挂载、卸载、同一个槽再挂载后 `host.base()` 与上传目录 |

## 验证

- 每片：`bun run test:affected --files`（提交前去掉 `--files` 再跑一次），`tsc --noEmit`、两份 `vue-tsc`。
- 后端：第 1 片在真实 HTTP 上跑完。
- e2e：新文件 `markdown-links-images.e2e.ts`；合入前跑一次：`markdown-links-images`、`markdown-editing`、`markdown-input`、`markdown-properties`、`editor-types`、`editor-area`；之后只重跑改到的文件与失败项。
- 未验证、留给开发者真机试用：桌面壳里的系统选文件框与文件框开着时窗口失焦（Playwright 的 `setInputFiles` 绕过它）；系统剪贴板的四类内容（Windows 截图、文件管理器复制文件、网页复制图、Word 里的图）；Chromium 把剪贴板位图重编码成 PNG，字节与源不同（所以 e2e 只比文件头与宽高）。

## 不做与风险

- 不做：拖放；SVG、BMP、AVIF 的上传；多选文件；压缩、改名、缩放；图片说明与对齐的界面；删图片时删磁盘文件；链接卡片里搜文件；`user://` 的上传；给目录项加修改时间；`accept` 参数（t15 要收别的类型时另开）。
- 已知限制（Spec 已写）：代次竞争落在新一代；内容文件夹里 `same`、`sibling` 存的图是未列入项、`sibling` 建出的子目录是没有正文的节点；`www.example.com` 这类输入按相对地址写；“最近的图”按名字倒序，同秒的几张次序与时间相反。
- 风险：控件重挂后宿主能力指向旧实例。切片 3 先写测试、再改，见上。
- 风险：粘贴插件抢了普通的粘贴。判据写成函数，DOM 测试逐类对照。
- 风险：Link 自带的点击插件吞掉新的点击处理。优先级与“只在修饰键时接手”写进注释，DOM 测试覆盖 Ctrl 点与单击。
- 风险：`find` 的合同加了可选字段。两端同一个版本发布；旧客户端不传这个字段，行为不变。

## 审查后定下的几处（开发者可改）

1. 单击链接照旧：点在链接上选中整条链接（Link 自带的行为），Ctrl 点才打开；第一稿写“只是光标进去”，与现状不符，Spec 已改。
2. 从网页复制的图（HTML 里只有 `<img>`）粘贴时存成本地文件，不留外链；复制表格软件的单元格这类带实质文字的仍照原来的粘贴。
3. 多张图：只有光标在不在表格里的空段落时各占一段，其余位置行内依次插入（表格单元格只能有一段）。
4. 一张失败不影响别的；传的过程中光标处有占位，可以继续打字。
5. `find` 加可选的 `extensions`（后端合同的增量字段），插图卡片按图片找。
6. 上传只收 PNG、JPEG、GIF、WebP，名字的扩展名要对得上；选的本机 `.jfif`、`.jpe` JPEG 由客户端改成 `.jpg`。
7. 图片存放设置两层都能设，在 `configuration.md` 的作者规则里写了例外。
