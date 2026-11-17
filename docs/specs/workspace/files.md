---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workspace.files
owners:
  - workspace-files
---

# 工作区文件访问与操作

## 目标与非目标

为主页面及其它合法文件消费者提供同一工作区下的文件查询、内容读写、目录操作与变更通知。后端能力由内置 Files 插件提供，浏览器经宿主 API 消费；不依赖资源管理器视图存活才能使用。

2026-09-26 开发者确认首版目标，并以“可以，就这么做，收口”批准 [Files 与资源管理器首版设计](../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#决策记录)中的 F1–F9。本文固定服务侧文件事实、批量结果和安全边界；展示、手势与确认交互归 [workbench.files-explorer](../workbench/files-explorer.md)。

2026-10-02 开发者接受 [项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)：本能力建在 [workspace.resources](resources.md)（资源地址、提供者、写入来源与变更事件）与 [workspace.folder-kinds](folder-kinds.md)（普通、内容、活页夹三类文件夹与清单）之上；目录按需列出，不读取文件内容或 frontmatter；`user://` 用户资产根与 Project 并列；写入带来源。

非目标：两种 UI 展示规则、角色/世界书适配、通用网络 API 动态注册、外部插件安装、恶意代码沙箱、多文件原子事务、远程文件系统提供者。也不迁移 Project 数据格式、删除用户领域数据或取代编辑器的未保存正文；首版不新增回收站或文件操作全局撤销。

已知限制：跨机器访问的基础操作尚未在隔离的第二宿主上验证；排他改名的平台原语（Linux `renameat2`、macOS `renamex_np`、Windows `MoveFileExW`）已在 Linux 上实测，macOS、Windows 与非默认文件系统的回退路径按 `process.platform` 代码分支区分但未在对应平台实际跑过。

## 术语与参与者

- **工作区绑定**：宿主核验的访问主体、文件根与有效 Project 代次；相对路径不是访问授权。
- **文件资源**：同一绑定下的真实文件或目录；展示标题、UI 模式和目录的正文入口不产生第二份文件数据。
- **磁盘基线**：读取或保存时确认的文件内容/版本依据，用来检测后续保存冲突；不是编辑器当前未保存内容。
- **Files 提供者**：拥有工作区文件行为和现有索引/History 接线的内置服务。
- **宿主 API**：前后端之间的认证、输入校验、目标解析与结果/事件通道；服务注册本身不自动暴露网络接口。
- **消费者**：浏览器文件客户端、文档保存或其它被授权入口。消费服务不获得关闭共享 Project 的权力。

## 输入与前置条件

- 文件访问必须携带有效工作区绑定及根内资源标识；创建/复制/移动另有明确目标，写入携带数据及已有条件保存依据。批量源按真实资源去重，父子重叠只操作最外层一次；不能因隐藏 `index.md` 缩小目录操作范围。
- 一个操作的源和目标在发起时确定，不能因为用户随后切换选中项、Project 或页面而改投新目标。目标目录不从多个选择中猜测；服务端提交时重验身份、权限及目标冲突，预检不授予写入资格。
- 路径包含、操作授予与链接约束沿 [platform.files](../platform/files.md)；查询接口、写接口及长连接均遵守服务端访问检查，不把 UI 禁用状态当授权。
- 对 Project 的业务操作只使用有效 ready 绑定。`user://` 用户资产根与 Project 并列、按 [workspace.resources](resources.md) 的规则访问，但不能充当 Project 失效时的隐式 fallback；不新增跨根搬运承诺。
- UI 选择一组资源可发起复制、移动或删除；并发、批量与单项操作都不能绕过相同权限和版本保护。

## 输出与可观察行为

| 能力 | 可观察结果 |
|---|---|
| 目录/树查询 | 按需返回一层实际目录项，不读取文件内容、不解析 frontmatter；内容树里的子目录带“有无正文”与“是不是叶子”（[workspace.folder-kinds](folder-kinds.md) 的“正文入口”）；内容文件夹与活页夹的展示名、顺序与编排来自其清单（[workspace.folder-kinds](folder-kinds.md)）；不存在、访问失败和空目录可区分，呈现方式不改变文件事实 |
| 内容读取 | 返回指定资源的内容及磁盘基线，或明确失败；旧绑定结果不得成为新项目内容 |
| 内容保存 | 成功确认本次提交的内容；基线冲突明确返回，不以覆盖替代冲突；正文保存期间的新输入仍由文档会话保留 |
| 创建文件/目录 | 用户明确意图产生实际文件/目录，失败不返回虚假的新节点；单纯浏览和展开不创建文件。已有目录中的“创建内容”仅排他创建缺失的 `index.md`，初始为空 Markdown，不注入模板；已存在时冲突，不覆盖或修改目录其余内容 |
| 重命名/移动 | 成功后可在确认目标定位资源，调用方能据结果协调打开文档；失败不宣称新路径已生效；移动到自身后代拒绝，同目标移动无操作 |
| 复制 | 在指定目标产生实际副本，源不因复制被删除；目录副本包含正文和附件，不因 UI 隐藏子项而遗漏；复制以已保存磁盘内容为基线，不能默默用 dirty 正文替换 |
| 删除 | 只在明确删除操作下移除实际目标；目录操作涉及其内全部实际资源，不因隐藏子项而缩小，也不将任意删除失败自动升级为递归强删；去除界面功能、释放视图或插件本身不删除数据 |
| 变更通知 | 当前绑定的文件变化可被消费者观察并协调刷新，事件附写入来源（[workspace.resources](resources.md)）；通知不是另一份正文，也不是所有平台事件逐条可靠投递的保证 |

复制/移动不得自动覆盖同名文件或递归合并目录；同目录复制也须明确新名称。改名目标须在提交时排他重验，预检后被占用仍返回冲突；跳过的项不得写入，取消不等同回滚。普通单项错误记录后继续执行独立项，绑定或授权失效停止后续项；逐项结果区分成功、失败、跳过、未执行、取消和结果未知。目录复制内部的部分完成也报告已产生的残留范围，不把部分成功标成整批完成。已确认成功项不得随恢复重复执行；先核对未知或失败项的实际状态，再提供重试，不清理用户后来修改的目标。

### 读取与保存

- **磁盘基线**：内容字节的 SHA-256（十六进制）。读取返回 `{text, baseline}`；保存成功返回新基线与 `identity: {before, after}`（替换前与替换后目录项的身份令牌，算法同 `identify`；调用方据此把保存之前冻结的令牌换成新的，外部替换不产生这对令牌；路径的最后一段是符号链接时目录项（链接本身）没换，没有这一对，经祖先目录的链接保存照样有；远程合同版本 3）（planned）。
- **文本**：只接受 UTF-8。UTF-8 BOM 保留在文本里、保存时原样写回，换行不归一化，未改内容的读写往返字节不变；含 NUL 或非法 UTF-8 为 `not-text`。不按扩展名判断是否文本。
- **正文上限**：正文要能装进一条远程服务消息：文本经 JSON 编码后不超过内核 RPC 单条消息上限（1 MiB，[远程服务](../runtime/plugin-channel.md)）减去 64 KiB 帧包络余量。读取时超过为 `too-large`；客户端在发出保存请求前按同一算法核对，超过直接返回 `too-large`、不发出，不让连接被断开；提供者对收到的保存再核一次。
- **条件保存**：只保存已有的普通文件，必须携带基线；目标不存在为 `not-found`，类型变了为 `not-a-file`。新建文件只经“创建文件”，它同时维护内容文件夹的清单（[workspace.folder-kinds](folder-kinds.md)）。保存不建父目录。
- **提交**：对同一真实文件的“读当前字节、比较基线、替换、确认新基线”是一次受锁保护的提交，跨进程有效（两个服务端可以同时打开同一个项目）：同一基线的两次并发保存恰好一次成功，另一次为 `conflict`。替换前核对目标仍是普通文件且可写（只读为 `permission-denied`，同目录临时文件改名本会绕过只读位），临时文件沿用原文件的权限位；路径是符号链接时替换链接的最终目标、链接保留；悬空链接为 `not-found`。外部编辑器不走锁：改名前的身份核对只缩小窗口，核对与改名之间被外部写入的那一次仍会被覆盖。
- **控制目录**：项目根下第一段名字不区分大小写等于 `.nbook` 的目录（项目身份、项目层配置与 Storage）不列出、不可读写，失败码 `protected-path`。请求的词法路径与解析符号链接后的真实路径都要检查，`alias -> .nbook` 这类根内链接同样拒绝。指向同一个目录的别名也拒绝：根下第一段与控制目录是同一个目录（设备号与 inode 相同）时按控制目录处理，Windows 上的 8.3 短名（`NBOOK~1`）由此挡住；Windows 上以点或空格结尾的名字（打开时会被去掉，`.nbook.` 指向 `.nbook`）与含 `:` 的名字一样为 `invalid-address`。用户资产根没有控制目录；嵌套的 `notes/.nbook/` 是普通目录。
- **根身份**：提供者记下方案根的设备号与 inode，每个请求先核对；根被移走、删除或换成别的目录为 `root-gone`，不重新解析到新目录。

### 按地址读取字节

图片这类二进制文件不走远程服务（正文上限与 UTF-8 校验都不适用），由 `nbook.files` 的 server 入口在 HTTP 端口上按地址给出原始字节；浏览器直接把地址交给 `<img>` 或 `fetch`。

- **地址**：`GET /api/nbook.files/raw/project/<项目 id>/<代次>/<路径…>` 与 `GET /api/nbook.files/raw/user/<路径…>`，路径各段按 URL 编码。浏览器的文件客户端给出 `rawUrl(address)`：按窗口绑定的项目与代次拼出 `project://` 地址的 URL，`user://` 同理；没有绑定项目、或地址不是这两个方案时为 null。
- **项目根**：只服务正在运行的那一代。服务端核对登记表里这个 id 正在运行且代次与 URL 一致，不一致为 410 `generation-gone`；该代次的根在第一次请求时打开并记下身份（同“根身份”一条），代次结束后丢弃；打开时核对项目身份文件里的 id 与登记一致，不一致为 409 `identity-conflict`。没有运行的项目读不到：与“只用有效 ready 绑定”一致，窗口绑定项目期间持有它的租约，所以它在运行。
- **规则**：路径包含、符号链接与控制目录的规则与“读取与保存”相同（同一实现），根身份同样逐请求核对。上限 32 MiB，超过为 413 `too-large`。
- **状态码**：`not-found`、`not-a-file`、`invalid-address`、`outside-root`、`protected-path` 一律 404，不区分受保护与不存在；`permission-denied` 403；`root-gone` 410；`io-failed` 500。错误体与 HTTP 端口的其它错误相同：`{error: {code, message}}`。
- **响应头**：`Content-Type` 按扩展名的白名单（png、jpeg、gif、webp、svg、avif、bmp、ico、html、css、js、mjs、json、txt、md、woff、woff2、ttf、otf），其它为 `application/octet-stream`；`X-Content-Type-Options: nosniff`；`Content-Security-Policy: sandbox`（直接打开一个 HTML 或 SVG 的地址也不在应用的源里运行）；`ETag`（修改时间与大小），`If-None-Match` 命中时 304；`Cache-Control: no-cache`。
- **跨站读取**：带 `Sec-Fetch-Site` 且既不是 `same-origin` 也不是 `none` 的请求为 403 `cross-site`：别的网页不能把这条路由当作读取接口；`none` 是用户自己打开，照同样的读取与沙箱规则放行。不带这个头的本机进程照常（与 HTTP 端口未加载鉴权时的信任相同，[runtime.server-host](../runtime/server-host.md)）。

### 写主题场景素材

主题编辑器（[`theme.editor`](../theme/editor.md)）经 `PUT /api/nbook.files/theme-assets` 把场景图写进 `user://theme-assets/`：请求体是原始字节，限长、按字节判定类型、文件名取 SHA-256、拒绝符号链接目录，细则在“主题编辑器”的“写场景素材”一节。同目录还有 `PUT /api/nbook.files/theme-icons`，只收通过严格检查的 SVG 图标（文件名 `<SHA-256>.svg`），细则在“写图标素材”一节。没人引用的素材由 `POST /api/nbook.files/theme-assets/sweep` 清理：先统计、再按用户确认过的名单删除，只碰摘要命名的普通文件，保护期内的不删，上传与清理互斥，细则在 [`theme.editor`](../theme/editor.md) 输出 22；删除经本能力的“删除”操作，`expected` 是目录项身份令牌。

### 写入图片（planned）

编辑器等浏览器一侧要把用户给的图片放进作品（粘贴、选本机文件，以后的拖入），经 `PUT` 把一个文件的字节写到作品里的某个地址，与“按地址读取字节”对称：

- **地址与客户端**：`PUT /api/nbook.files/raw/project/<项目 id>/<代次>/<路径…>`，路径是要写的那个文件，各段按 URL 编码，请求体是原始字节。只写 `project://`，不写 `user://`。浏览器的文件客户端给出 `upload(address, body, options?)`：按窗口绑定的项目与代次拼出这个地址；`options` 有 `exists`（`fail` 缺省，或 `rename`）与取消信号。结果是 `{ok: true, address, renamed}`（`address` 是实际写下的资源地址）或 `{ok: false, code, detail}`，`code` 取自下面的码表，调用方只按 `code` 判断。客户端自己给的码：没有绑定项目或地址不是 `project://` 为 `unavailable`（不发出）；字节超过 32 MiB 为 `too-large`（不发出）；调用方取消为 `cancelled`；请求没有得到响应（没连上服务，或连接中途断开，浏览器分不出这两种）为 `network`：图可能已经写下，调用方不要当成一定没写。
- **代次与规则**：项目代次在请求到达时按项目登记核对：不符、或项目没在运行，为 410 `generation-gone`，不会为了一次上传启动项目；核对之后项目换代的极窄竞争里，写入落在新一代的同一个目录。项目身份由项目实例打开时核对。路径包含、符号链接与控制目录的规则同“读取与保存”；父目录不存在时一并建出来，父路径的某一段是文件为 409 `not-a-directory`。名字是合法的单段，主名为空（`.png`）为 400 `invalid-address`。
- **只收图片**：按文件开头的字节判定，只收 PNG、JPEG、GIF、WebP，不信客户端给的类型，也只保证文件开头像图片、不保证整份是合法图片（读取时按扩展名给类型并加沙箱，不会在应用的源里运行）。名字的扩展名只能是 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`（不分大小写），没有扩展名或是别的为 415 `unsupported-type`；扩展名与判定的类型不一致为 415 `extension-mismatch`（JPEG 是 `.jpg` 或 `.jpeg`）。空请求体与不是允许图片的字节为 415 `unsupported-type`。上限 32 MiB，服务端边收边数，分块传输也一样，超过为 413 `too-large`。
- **不覆盖**：只新建。`exists=fail` 时目标已存在（普通文件、目录、链接，包括指向不存在目标的链接）为 409 `conflict`。`exists=rename` 时写第一个空着的 `名字 2.扩展名`、`名字 3.扩展名`……（不认名字里原有的序号，`a 2.png` 再写是 `a 2 2.png`），至多试到 `名字 100`，都被占用为 409 `conflict`；加了序号的名字超长为 400 `invalid-address`；成功时 `renamed` 为真。两个请求同时写同一个名字，恰好一个得到它，另一个按上面的规则取下一个空名；只有“被占用”才换下一个名字，别的失败立即结束并原样报出。
- **取消与结果未知**：请求体收完之前取消（调用方取消、连接断开），确定没有写；收完之后取消，或写入时项目实例断开，结果未知（502 `unknown-outcome`）：文件可能已经写在目标目录里，不自动删除，调用方也不要把它当成失败去重试同一个名字。
- **状态码与码表**：错误体同读取：`{error: {code, message}}`，写入的 `code` 不改写成 `not-found`（读取为了不区分受保护与不存在才改）。

  | 状态 | `code` | 情形 |
  |---|---|---|
  | 201 | — | 写成，`{address, renamed}` |
  | 400 | `invalid-address` | 名字或路径不合法（含主名为空、加序号后超长） |
  | 403 | `permission-denied`、`cross-site` | 目录不可写；来源不对（下一条） |
  | 404 | `protected-path`、`outside-root`、`not-found` | 控制目录、根外、没有这个项目；不区分受保护与不存在，同读取 |
  | 409 | `conflict`、`not-a-directory` | 目标被占用；父路径的某一段是文件 |
  | 410 | `generation-gone`、`root-gone` | 代次不符或项目没在运行；作品目录被移走 |
  | 413 | `too-large` | 超过 32 MiB |
  | 415 | `unsupported-type`、`extension-mismatch` | 不是允许的图片；扩展名与类型不符 |
  | 500 | `io-failed` | 其它写入失败 |
  | 502 | `unknown-outcome` | 结果未知 |
  | 503 | `project-unavailable` | 项目实例不可用 |

- **来源**：写请求同 HTTP 端口的其它写请求，带了 `Origin` 就要是允许的来源（[runtime.server-host](../runtime/server-host.md)）；另外带了 `Sec-Fetch-Site` 且不是 `same-origin`（包括 `same-site`、`cross-site`、`none`）为 403 `cross-site`，不带这个头的交给 `Origin` 核对。
- **写入来源与提交**：写入经本能力自己的提交链，写一半的文件不会出现在目标处；目录监视与资源管理器照常看到新文件与新建出来的父目录。HTTP 端口没有窗口的身份，写入来源记为系统（`nbook.files`）。服务端同时处理至多 2 个上传，其余排队。
- **边界**：本接口不写 `user://`，不写别的文件类型，不建空目录；新作品（还没有运行代次）用不了；一次拖入整个文件夹时，文件夹重名要调用方先定好名字再逐个写。在内容文件夹（[workspace.folder-kinds](folder-kinds.md)）里写入时，图作为未列入项出现、不改清单；一并建出来的子目录是没有正文的内容节点。

### 预览的受限读取

HTML 预览（[workbench.html-preview](../workbench/html-preview.md)）运行在不透明源的沙箱里，它对文件的每个请求都是跨站的。这里给它一个只认令牌的只读入口：

- **令牌**：远程服务 `nbook.files.preview`（server 入口，按调用方门面提供）的 `open({project, generation, network}) → {token, base}` 签发令牌：128 位随机数，只放行这部作品的这一代，只读；`network` 是这个令牌下的页面放不放行外网（预览的“允许联网”），切换时换令牌；`close({token})` 作废它。调用方的门面释放（窗口断开、入口停止）时它签发的令牌全部作废；项目这一代结束时这一代的令牌全部作废。令牌不写日志、不落盘。
- **路由**：`GET /api/nbook.files/preview/<令牌>/<路径…>`，路径相对项目根，根与规则同上一节（含上限、状态码与前五个响应头），只是 `Content-Security-Policy` 换成 `sandbox allow-scripts` 加预览的网络限制（[workbench.html-preview](../workbench/html-preview.md) 输出 5，按令牌的 `network`）：预览页在 iframe 里导航到作品里别的 HTML、或有人直接打开这个地址时，加载的页面同样在沙箱里、同样不能联网。令牌无效或已作废为 404。它接受跨站请求，请求带 `Origin: null` 时回 `Access-Control-Allow-Origin: null`：沙箱里的 `fetch`、模块脚本与字体按 CORS 读到响应，别的来源读不到。另加 `Referrer-Policy: no-referrer`，令牌不随引用头带到外部。
- **`base`**：令牌对应的 URL 前缀（`<应用源>/api/nbook.files/preview/<令牌>/`），预览据此拼出文件所在目录的地址。

### 文件操作

两份远程合同（`project://`、`user://`）提供同一组操作。只支持同一方案内、同一设备上的移动与复制，不跨根搬运。

| 方法 | 输入 | 结果 |
|---|---|---|
| `identify`（读） | `{paths}` | 逐项 `{kind, token}` 或失败：冻结操作意图用的目录项身份令牌 |
| `realPath`（读） | `{path}` | 资源在服务端机器上的绝对路径（给“复制路径”）；控制目录为 `protected-path`，经链接到根外为 `outside-root`，不存在为 `not-found`。跨机器访问时它是服务端的路径 |
| `create` | `{path, kind: "file" \| "directory", before?}` | 排他新建；文件为空 |
| `createContent` | `{path}`（内容树里的节点目录） | 排他新建空白 `index.md`，已有为 `conflict` |
| `rename` | `{path, name, expected?}` | 同目录改名 |
| `convert` | `{path, to: "content" \| "plain", expected?}` | 加或去 `.content` 后缀（[workspace.folder-kinds](folder-kinds.md) 的“转换”） |
| `reorder`、`display`、`include`、`drop` | 见 [workspace.folder-kinds](folder-kinds.md) 的“清单编辑” | 只改清单 |
| `move` | `{operation, items: [{source, target, expected?, before?}]}` | 逐项结果；`before` 见下文“移动到指定位置” |
| `copy` | `{operation, items: [{source, target, expected?}]}` | 逐项结果 |
| `delete` | `{operation, items: [{path, expected?}]}` | 逐项结果 |
| `cancel` | `{operation}` | `{found}`：是否命中本调用方在途的批量 |

- **名字与目标：** 名字是合法的单段（同资源地址的段规则），项目根下不能是控制目录。批量的目标是完整路径：碰撞时改名或跳过由调用方决定，服务端不自动改名、不覆盖、不合并。
- **排他提交：** 新建文件 `open` 排他，新建目录不递归 `mkdir`，改名、移动、转换用系统的排他改名（Linux `renameat2` 带 `RENAME_NOREPLACE`，macOS `renamex_np` 带 `RENAME_EXCL`，Windows `MoveFileExW` 不带替换标志）；提交本身就是检查，目标在预检之后被占用仍为 `conflict`。文件系统不支持排他改名、跨设备移动为 `unsupported`，不退回会覆盖的改名。父目录不存在为 `not-found`，不建中间目录。
- **目录项与目标：** 改名、移动、删除作用于目录项本身，不跟随最后一段的符号链接（改名链接就是改名链接，删链接不删目标）；父目录按[读取与保存](#读取与保存)的包含、控制目录与根身份规则解析。根本身不能改名、移动、删除、转换；控制目录作为源或目标都是 `protected-path`。
- **源身份：** 调用方冻结一次操作意图（剪贴板、拖动）时用 `identify` 取得源的令牌（目录项的设备号、inode、创建时间与类型的摘要，不含宿主路径；同一 inode 的两个硬链接名是两个目录项），提交时带 `expected`；服务端在执行前与提交前各核对一次，不符或冻结的源已不在为 `source-changed`（同目标移动也先核对）。最后一次核对与系统调用之间仍有窗口，沿 [platform.files](../platform/files.md) 不承诺抵御恶意的并发替换。
- **复制：** 源不变。文件先写到目标目录里带实例标记的临时名（复制字节与权限位），再排他改名到目标名，失败不留半个文件。目录先排他创建目标目录，再按名字次序逐项复制；中途失败停下，已产生的部分留在目标处并作为残留范围报告。链接复制为链接（复制链接原文，不跟随，不把根外内容拷进来）；设备、FIFO、套接字让该项失败为 `unsupported`。复制到源自身或其后代按真实路径判定，在产生任何东西之前拒绝为 `into-itself`。
- **删除：** 文件先核对可写，只读为 `permission-denied`（与“显示为只读的资源仍在服务端拒绝”一致，不依赖操作系统只看父目录权限的 `unlink`）。目录递归删除，遇到第一个失败就停，不改权限、不强删，报告已删除的最外层范围；目录仍在时不宣称它已删除。
- **批量预处理：** 任何副作用之前：源按目录项（父目录真实路径加名字）去重，重复为跳过（`duplicate`），被另一源目录覆盖的为跳过（`covered`）；移动的目标就是源本身为完成且无事件（带 `before` 时见下一条），复制的目标就是源本身照常提交而得到 `conflict`；移动或复制到自身或后代为 `into-itself`。
- **移动到指定位置：** 移动的一项可带 `before`：目标所在那一层另一项的名字，或 `null` 表示放到末尾；只对目标在内容树里的移动有意义（[workspace.folder-kinds](folder-kinds.md) 的“经文件服务的操作同步清单”），条目插到它之前；名字不在那一层时放到末尾；目标在普通文件夹里时忽略（普通文件夹按名字排序，没有位置）。源与目标是同一个目录项时，带 `before`（含 `null`）只在清单里把这一项挪到它之前，仍取同一把操作锁、发出清单的变更事件，不动文件。一批里多项带同一个 `before` 时按下标依次插入，结果连成一串，每一项各自原子。远程合同版本 5。
- **逐项结果：** 与输入按下标对齐：`done`；`failed`（码、详情，部分完成时带 `partial.removed` 或 `partial.residual` 范围）；`skipped`（`duplicate`、`covered`）；`not-run`（`root-gone`、`stopped`）；`cancelled`。完成与失败的项都可能涉及没改成的清单（文件已改而清单没改成，[workspace.folder-kinds](folder-kinds.md)）：单项操作的结果直接带 `manifests`（哪份清单、为什么）；批量结果另有一张按清单去重的 `manifests` 表，项里的 `manifests` 是表的下标。
- **停止与取消：** 每项开始前检查三件事：业务取消、根身份、请求的终止信号（调用方断线、调用方入口停止、提供入口停止、项目代次结束）。正在执行的项按实际结果结算，之后的项分别为 `cancelled`、`not-run: root-gone`、`not-run: stopped`；已完成的项不回滚。单项业务失败记下后继续。取消用单独的 `cancel` 方法，只命中同一调用方在途的操作 id；不用调用方中止写请求来取消（中止已发出的写请求只能得到结果未知，拿不到逐项结果）。提供入口停止时等在途操作结算后才关闭。
- **大小上限：** 一次批量最多 1000 项，输入经 JSON 编码后不超过与正文相同的预算；客户端按要发出的完整请求（字段名、令牌都算）在发出前核对、提供者再核一次，超过为 `too-large`、不发出。结果编码后超过预算时，依次省略范围里的路径（范围标 `truncated`）、把详情按编码字节截短、省略清单表（结果标 `truncated`），每一步之后重新核对，保证装进一条消息；看到 `truncated` 的调用方重新列出核对。
- **结果未知：** 断线或超时时调用方得到 `unknown-outcome`。列出只说明当前状态，不能证明旧操作已经停下；调用方不自动重试有副作用的操作。
- **浏览器客户端：** 批量方法立即返回句柄 `{result, cancel()}`：操作 id 由客户端生成，方案与 id 在句柄里，调用方不用记 id；批量里的地址必须同一方案。

## 状态与转换

| 状态/事件 | 对外结果与约束 |
|---|---|
| 未绑定或未就绪 | 文件业务入口不可用，说明原因；不能展示“读取成功但目录为空” |
| 有效绑定开始查询/操作 | 可观察等待/执行状态；执行对象保持此次绑定和源/目标 |
| 操作成功 | 发布逐项实际结果、实际源/目标及必要变化，消费者可重读核实 |
| 操作明确失败 | 返回拒绝或失败原因；独立项可继续，绑定/授权失效停止后续项；未执行项不得报成功 |
| 传输断开/超时且无法确认写入 | 结果未知，不等同于未执行；核对实际源/目标后才能决定后续动作，不能自动重试非幂等副作用 |
| 绑定撤销、Project 换代或访问失效 | 停止对旧身份接纳新操作及投递新结果；不自动改投新绑定 |
| 消费者释放 | 释放其订阅/借用，不关闭其它消费者使用的共享文件服务或 Project |

取消停止尚未开始的项，不撤销已完成的项；在途操作若不能证明终止即为结果未知。复制/批量不承诺整批幂等或跨文件事务。

## 副作用与数据

- 只有创建、写入、复制、移动、删除等明确操作改变文件；在内容文件夹内的这些操作同步更新清单（[workspace.folder-kinds](folder-kinds.md)）。浏览、展开与呈现方式不写任何文件，不改变磁盘布局、文件名、frontmatter 或原有引用。
- 文件事实与现有索引/History 的 owner 保持唯一；文件数据、未保存正文、视图偏好分别归 Files/文档域/Storage，不互相复制成另一份权威数据。
- 浏览器经 [远程服务](../runtime/plugin-channel.md) 取得结果并订阅变更；组件不持有底层网络连接协议。后端服务对象、数据库连接与原始授予不跨进程传入浏览器。
- 订阅与操作句柄按运行时作用域释放；用户文件及持久历史不随插件/视图关闭删除。
- 现有项目控制文件、Storage、数据库及运行产物的保护继续生效。去除领域界面不是让普通文件操作获得整个 State Root 的访问权。

## 失败与恢复

- 校验失败、越界、权限不足、资源消失、类型/身份改变、写入冲突与服务不可用都需可区分，不能退回另一项目或空成功。
- 显示为只读或没有删除权限的资源，仍在服务端拒绝对应操作；前端伪造菜单参数不能扩大授权。
- 在途保存确认仅推进本次提交基线，不清除等待期间的新输入；文档内容的冲突选择仍由文档 owner 负责。移动前结算输入并等待相关在途保存；成功后调用方以实际结果重绑定文档身份和未保存正文，失败不得冒认新路径。
- 部分完成、取消、结果未知必须如实呈现；不因重试而重复已确认成功的副作用，不以回滚本地树快照冒充磁盘回滚。
- 断线/订阅失效不可继续声称数据实时同步；恢复后依据有效绑定重新核对状态，不承诺断线期间的每个事件可重放。
- 目录内或隐藏文件的内容格式问题可作为诊断，不自动等同服务端创建/写入禁令；空白 Markdown `index.md` 不要求生成 frontmatter。已有路径、类型、项目绑定、权限及 Storage 保护仍须独立通过，不因诊断与写入解耦而放宽。
- 既有 History 不是新承诺的回收站或文件操作全局撤销器；删除前由消费者确认不可恢复风险与 dirty/未决冲突，本服务只按有效授权和明确请求执行。

## 边界与兼容

- 依赖方向是宿主授权/Project 绑定 → 工作区文件能力 → 被授权消费者；底层 [platform.files](../platform/files.md) 不反向等待 Files、Project 或 UI。
- 基础内置插件装配沿 [runtime.plugins](../runtime/plugins.md)，跨位置经 [runtime.application](../runtime/application.md) 的宿主边界，不新增任意方法透传的通用 RPC。
- 现有网络入口可以在内部改为调用插件服务，不为“插件版 Files”再设平行文件权威；新复制/批量沿同一入口族扩展，逐项结果必须能让消费者区分成功、残留与未知，而非只返回整批布尔值。
- 本能力不迁移 [内容格式 Reference](../../../packages/neuro-book-legacy/assets/reference/content/README.md)，不改变数据保护、History 和 [Storage](../storage/boundaries.md) 归属。内容节点只存在于内容文件夹中，展示信息来自清单；现有项目的 frontmatter 展示信息与目录后缀由项目迁移脚本一次性迁移，本能力不带兼容分支。普通文件操作也不自动改写 Markdown 链接或外部引用，失效引用应可诊断，不假称移动已修复全部引用。
- 公开第三方 SDK、独立插件安装和动态网络路由不在首版。信任内置代码不等于承诺不可信代码隔离。

## 验收与 Smoke

以下是完整能力的可观察门禁；真实文件使用隔离 State/Cache/Project 根，遵守[测试与验收合同](../../testing/README.md)。

1. 主页面打开隔离项目，读取文件树与正文、编辑并保存；重新读取磁盘确认提交内容，另一合法文件消费者取得同一结果。
2. 对普通文件、含 `index.md` 和附件的目录执行创建、重命名、移动、复制、删除，核对实际路径和字节；目录操作涵盖隐藏正文与附件。空目录的“创建内容”写入空白 `index.md`，已有时冲突而保留原字节；内容格式缺字段可诊断但不能单独阻断创建，路径和权限拒绝仍生效。
3. 多选父子重叠、重复源与两个独立资源复制/移动/删除，父子只操作最外层一次、重复不增副本；移到自身后代拒绝，同目标移动无操作；单项拒绝后独立项继续，绑定/授权失效后停止，结果逐项对齐磁盘。
4. 用过期磁盘基线保存，看到冲突而不是静默覆盖；保存期间继续输入，新输入保持未保存。
5. 改变外部文件后收到通知并核对状态；断线显示失同步，不将其报告成项目空目录。
6. 旧请求在切 Project 或关闭重开同路径后返回，不覆盖新工作面；只读/越界调用拒绝，根外数据不变。
7. 关闭一个资源管理器或窗口后，其订阅停止，另一个窗口仍可读写同一有效项目；正常释放不删除文件或历史。
8. 主页面不激活角色/世界书等领域适配也能完成基础链；同名文件/目录目标不覆盖、不合并，同目录复制要求改名，预检后目标被占用时仍拒绝写入。
9. 目录复制中途失败保留已产生的残留并报告范围；取消后已完成项不回滚、未开始项不执行，在途不能确认则标为结果未知；断线后先核对磁盘，绝不重复已确认成功的副作用。
10. 用 `rawUrl` 读一个运行中项目里的 png，得到原始字节与 `image/png`、`nosniff`、`sandbox` 三个头，再带 `If-None-Match` 得到 304；代次不符得到 410，`.nbook/` 下的文件与目录得到 404，超过 32 MiB 得到 413，`Sec-Fetch-Site: cross-site` 得到 403。
11. 经 `nbook.files.preview` 取得令牌后，带 `Origin: null` 读同一项目的文件得到响应与 `Access-Control-Allow-Origin: null`；令牌读不到别的项目；`close` 之后、窗口断开之后、项目这一代结束之后都得到 404。
12. （planned）用 `upload` 把一张 png 写进一个还没有 `插图/` 目录的运行中项目，得到 `{address: "project://插图/a.png", renamed: false}`，磁盘上目录与文件都在、字节相同，资源管理器收到文件与目录的新建、来源是系统；再写同名文件：默认得到 409 `conflict`、磁盘上原文件字节不变，`exists=rename` 得到 `插图/a 2.png`，目标是同名的目录时 `exists=fail` 得 409 `conflict`、`exists=rename` 得 `a 2.png`；同一时刻两个请求写同一个新名字，各得到一个不同的地址、两个文件都在；写 JPEG 字节到 `.png` 得到 415 `extension-mismatch`，写文本到 `.png` 或把 png 写到 `.txt` 得到 415 `unsupported-type`，33 MiB（含分块传输）得到 413、磁盘上没有文件；写 `.nbook/` 下得到 404，代次不符或项目没运行得到 410，父路径某段是文件得到 409 `not-a-directory`，`Sec-Fetch-Site: same-site` 或 `none` 得到 403 `cross-site`，不带 `Sec-Fetch-Site`、带允许的 `Origin` 的请求照常 201；请求体发完之前断开连接，磁盘上没有文件。

## 实现合同

- 公开入口：`nbook/plugins/files/shared/contracts.ts`（远程合同 `filesUserContract`/`filesProjectContract`、方法表、失败码 `FILES_FAILURES`、`TEXT_BUDGET_BYTES`/`encodedTextBytes`/`encodedBytes`）；浏览器客户端 `files/web/client.ts`、`filesKey`。
- owner 与依赖方向：`workspace-files` 拥有分区库之外的文件原语与远程服务；依赖内核的按调用方门面、远程服务与跨实例委托（同 `storage.persistence` 的依赖写法），服务端/项目入口依赖 [`platform.files`](../platform/files.md) 的受根约束原语与 `runtime.diagnostics`；浏览器入口只依赖 `filesKey`，不直接访问真实路径。
- 不变量：
  - 控制目录（项目根下 `.nbook`）在词法路径与解析符号链接后的真实路径两处都拒绝（`rooted.test.ts`）；
  - 条件保存与排他改名在系统调用层核对身份，核对与系统调用之间的窗口不承诺抵御恶意并发替换（`rooted.test.ts`、`exclusive.test.ts`）；
  - 批量操作的源按目录项去重、父子重叠只处理最外层一次，移动/复制到自身或后代在产生任何结果前拒绝（`batch.test.ts`）；
  - 内容文件夹内的操作与清单更新在同一次操作里结算，文件已改而清单未改时返回部分完成并指明哪份清单（见 `workspace.folder-kinds` 的“经文件服务的操作同步清单”，`operations.test.ts`）；
  - 结果编码超预算时按路径→详情→清单表的顺序截断，每步重新核对装进一条消息（`transport.test.ts`）；
  - 字节路由与预览路由（`files/backend/raw-route.ts`，挂在 `nbook.http` 的 `http.routes` 上）每次请求按运行中的项目登记核对代次与身份文件，项目根按代次缓存；ETag 取目录项的 inode、ctime、mtime 与大小，同样大小、改回修改时间的改写也换 ETag；预览令牌只在内存里，按调用方门面记下签发的令牌，门面释放（窗口断开）时作废（`raw-route.test.ts`，窗口断开与切走后作废由 `e2e/editor-types.e2e.ts` 核对）。

## 证据

- 批准依据：2026-09-26 开发者“可以，就这么做，收口”批准 [首版设计决策记录](../../../packages/neuro-book-legacy/docs/proposals/files-explorer.md#决策记录)（F1–F9）；2026-10-02 [项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md#决策记录)；2026-10-09 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 的 t68 条目（“读取与保存”一节：基线、文本、正文上限、只保存已有文件）与 t69 条目（“文件操作”一节：只读文件删除拒绝、复制与删除的失败政策、源身份令牌、批量的大小上限、结果未知不提供状态查询）；2026-10-14 [t86 的决定](../../../.agents/works/w00017-application-runtime-architecture/tasks/t86-explorer-polish/README.md#决定)（目录项的叶子标记、`realPath`、移动到指定位置）。；“写入图片”的决定：开发者 2026-11-16 在 `.agents/works/w00025-editor/tasks/t09-links-images/README.md` 决定 1。
- 实现入口：[`plugins/files/backend/`](../../../packages/neuro-book/src/plugins/files/backend/)、[`plugins/files/web/`](../../../packages/neuro-book/src/plugins/files/web/)、[`plugins/files/shared/contracts.ts`](../../../packages/neuro-book/src/plugins/files/shared/contracts.ts)
- 合同测试：[`files/files.test.ts`](../../../packages/neuro-book/src/plugins/files/files.test.ts)、[`files/operations.test.ts`](../../../packages/neuro-book/src/plugins/files/operations.test.ts)、[`files/batch.test.ts`](../../../packages/neuro-book/src/plugins/files/batch.test.ts)、[`files/changes.test.ts`](../../../packages/neuro-book/src/plugins/files/changes.test.ts)、[`files/transport.test.ts`](../../../packages/neuro-book/src/plugins/files/transport.test.ts)、[`files/project-child.test.ts`](../../../packages/neuro-book/src/plugins/files/project-child.test.ts)、[`files/backend/rooted.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/rooted.test.ts)、[`files/backend/entry-ops.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/entry-ops.test.ts)、[`files/backend/exclusive.test.ts`](../../../packages/neuro-book/src/plugins/files/backend/exclusive.test.ts)、[`files/raw-route.test.ts`](../../../packages/neuro-book/src/plugins/files/raw-route.test.ts)
- Smoke：不适用——没有独立的跨机器 e2e；单机双窗口、Lab 与切换性能的记录随 [workbench.files-explorer](../workbench/files-explorer.md) 的 `e2e/files-explorer.e2e.ts`、`scripts/perf/files-perf.ts`（最近一次测量见 t72，2026-10-10，未重新运行）；字节读取与预览读取由 [`e2e/editor-types.e2e.ts`](../../../packages/neuro-book/e2e/editor-types.e2e.ts) 在生产构建与本机 Chrome 里运行
