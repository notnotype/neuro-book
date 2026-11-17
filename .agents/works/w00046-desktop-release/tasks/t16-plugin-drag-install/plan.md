# t16 计划：把插件文件夹拖到插件页安装（r4）

r4（2026-11-17，开发者同意上限与 nb-host 的改法）按第 3 轮（[处理](evidences/design-review-r3-proposal.md)）改：总上限 64 MiB、单个 32 MiB；先改 nb-host 的请求转交为流式（切片 0）；window 上只防导航、安装只在插件页内容区接；满 8 个时淘汰最久没用的；分帧写死。三轮审查已满，r4 不再开设计审查，实现审查时 nb-host 与服务端部分派 Opus。

r2 按设计审查第 1 轮改（[处理](evidences/design-review-r1-disposition.md)）。r3 按第 2 轮（[处理](evidences/design-review-r2-disposition.md)）把上传简化成**一个请求传整个文件夹**：请求结束时上传就是完整的，去掉逐个文件的 PUT、封口与在途写入的状态；拖放落点收窄到插件页自己。

## 目标

在插件页把一个插件文件夹（构建好的，根目录有 `package.json`）从系统拖进来，就能走现有的“预览、确认安装”。浏览器与桌面同一份实现（HTML5 拖放）。

## 现状（读过的代码，审查核对过）

- 安装的输入只有“服务端可读的本地文件夹路径”（[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 的“输入与前置条件”）。插件页（`src/plugins/plugins/web/components/PluginsPage.vue`）是路径输入框：`registry.inspect({path})` 预览，确认后 `registry.install({path})`。
- 远程服务 `nbook.plugins` 的合同在 `src/plugins/plugins/shared/contracts.ts`（版本 5），后端入口 `backend/plugin.ts` 把宿主的 `pluginInventoryKey`（`src/plugin-platform/backend/inventory.ts`）映射成合同。复制按 `files` 规则、任何深度排除 `node_modules` 与 `.git`（`copy.ts`）。命令行 `nbook plugin` 直接用 `createPluginInventory`，不经合同，不受本 Task 影响。
- 远程服务走 RPC（JSON）。插件经 `HTTP_ROUTES_POINT` 贡献 Hono 路由（`nbook.files` 的 `theme-asset-route.ts`、`raw-route.ts` 是写法参照：`bodyLimit`、`onError(rethrowRouteError)`、失败体 `{code, detail}`）。路由在服务端入口激活后才挂上；插件页打开时先 `list()`，入口那时已激活。
- v2 没有鉴权：本机单用户，插件所有者就是本机访问者；写请求由 nb-host 的来源检查拦外站。
- HTML5 拖放拿不到本机路径，只能读内容。Electrobun 2.0.6 在 Windows 上没有改 WebView2 的 `AllowExternalDrop`（缺省允许，`nativeWrapper.cpp` 里没搜到），外部拖放会交给网页；仍要在 Windows 上实测（切片 5）。

## 行为（写进 Spec，`runtime.plugin-install`，条目级 planned）

1. **第二种输入：上传的文件夹。** 插件页接受从系统拖入的一个文件夹，也可以点“选择文件夹”（键盘用户与浏览器的入口，同一条路）。页面把文件夹一次上传到服务端的上传暂存区，之后的预览、确认、安装与路径输入相同（同样的校验、失败码与确认界面）。预览的来源写“拖入的文件夹 `<名字>`（N 个文件，大小）”。
2. **页面上传什么。** 任何深度的 `node_modules`、`.git` 不上传；别的都上传，取舍仍由安装时按 `files` 复制决定。符号链接：浏览器读到的是目标内容，上传后是普通文件（与路径安装不同，已知限制）。读某个文件失败（构建中被改写、链接断了）：这次上传作废，提示“读取或上传没有完成”（浏览器分不出是读不了还是连不上）。
3. **拒绝与提示（上传之前，页面判断）。** 拖入的不是文件夹（单个文件、多个条目）：提示“拖入一个插件文件夹”；是 `.zip`、`.tgz` 时另说“先解压，再拖入解出的文件夹”。根目录没有 `package.json`、而恰有一个子目录有：提示“插件好像在 `<子目录>` 里，拖它进来”。超过上限（10000 个文件、总 64 MiB（含分帧头）、单个 32 MiB）：按页面数到的拒绝，服务端照样检查。上传中、预览或确认框开着时再拖入：提示“正在处理上一个文件夹”，不理。
4. **上传暂存区。** `<State Root>/plugin-uploads/<上传 id>/`（不在 `plugins/` 里）。一次上传是一个请求：请求体按顺序带着全部文件，服务端边读边写，读完、全部写好才交回上传 id；请求中途断开、超限或任何一个文件不合规，就删掉已写的部分，不留下上传。上传 id 由服务端签发，只认登记在本次运行内存表里的。上传交回之后只读：状态是“可用”或“使用中”（预览或安装正在读它）；使用中的删除等它用完再删。
5. **寿命。** 页面在这几种时候请求删除：预览失败、取消、页面离开（`keepalive`）——但**已经发出安装请求的上传，页面不再删**，由服务端在安装结束（成功或失败）时删。删除不存在的上传算成功。服务端另外每 10 分钟删掉 1 小时没有被用过的可用上传，第一次用到暂存区时清空整个目录：只跑一次，其它方法都等这次清空的 Promise；清扫只看内存表。删除失败只记诊断，留给下次清空；清空失败不挡插件页。
6. **失败码**（上传的路由返回 `{code, detail}`）：`upload-too-large`（413，超过上限）、`upload-path-invalid`（400，相对路径不合规或重名）、`upload-busy`（429，同时在接收的上传已满）、`upload-malformed`（400，请求体的分帧不对）、`upload-failed`（500，写盘失败）。`inspect`、`install` 收到用不了的上传 id 时以 `path-rejected` 拒绝，详情说明“上传已失效，重新拖入”。

## 设计

**请求体的分帧**（一个模块 `src/shared/plugin-upload.ts`，页面与服务端共用，含路径规则）：按顺序重复“4 字节大端的头长度 N（1 到 2048）、N 字节 UTF-8 JSON `{path: string, size: 非负整数}`（只有这两个键）、`size` 字节的内容”，直到流结束；没有结束帧，在帧的边界上流结束才算完整，在帧中间结束是 `upload-malformed`；空请求体是 `upload-malformed`。`size` 在读内容之前就按单个上限与总量查，超了立即停；解析器等本帧写盘完成再读下一块。总量计分帧头与内容。页面用 `new Blob([头, 文件, 头, 文件, …])` 拼出请求体（`Blob` 由 `File` 拼成时不复制内容，`fetch` 边读边发）。不用 tar 或 multipart：浏览器里写 tar 要加依赖，multipart 在 Bun 与 Hono 里都要整份读进内存才能解析；这套分帧两边各几十行，能流式处理。

**路径规则**（同一模块，页面收集时先查，服务端再查）：用 `/` 分段；没有空段、`.`、`..`；不以 `/` 开头；没有 `\`、`:`、控制字符与 `<>"|?*`；段不以空格或点结尾、不是 Windows 保留名（`CON`、`NUL`、`COM1` 等，不分大小写、带扩展名也算）；段至多 255 字节、整条至多 1024 字节。比较前做 NFC 归一化、按“大写再小写”的近似比（NTFS 按大写比，只做小写会漏 `ς`、`ı` 这类）：同一次上传里两条路径只差大小写或归一化形式、或一条是另一条的上层目录（文件与目录同名），都是 `upload-path-invalid`。写盘用 NFC 形式。不论服务端在什么系统上都按这套查。

**服务端**（`src/plugin-platform/backend/uploads.ts`，新；由宿主与 `pluginInventoryKey` 一起建，作为宿主能力 `pluginUploadsKey` 给 `nbook.plugins`；时钟注入，清扫计时器随能力建立、随服务端停止撤销）：

- 内存表 `Map<id, {users, lastUsed, deleting}>`；id 是 `crypto.randomUUID()`，进来的 id 先按格式查表，查不到不拼路径。
- `receive(body, limits)`：读流、按分帧解析；每个文件以 `wx`（独占新建）打开、边读边写；字节在流里计数（单个、总量），超限就取消读、删目录。文件数也计。不写临时名再改名：上传交回之前没人读这个目录，改名只会在 Windows 上多一次被杀毒软件打断的机会。
- 服务端停止时取消正在接收的请求并等它们收尾（否则排空要等到超时）；安装后的删除放在 `finally` 里。
- `use(id, fn)`：可用才进，`users` 加一；`discard(id)`：有使用者时记 `deleting`，最后一个用完再删；`sweep(now)`、`clear()`。
- 并发的上传各写各的目录，互不影响；同时存在的上传至多 8 个；接收开始就占位；满了时淘汰最久没被用过的可用上传，没有可淘汰的才以新码 `upload-busy`（429）拒绝。页面另在 `pagehide` 上发删除（`keepalive`）。

**路由**（`nbook.plugins` 贡献，`/api/nbook.plugins/uploads`，`onError(rethrowRouteError)`）：`POST /uploads`（请求体是分帧的流，交回 `{id, files, bytes}`）；`DELETE /uploads/<id>`（不存在也回 204）。不用 `bodyLimit`（它在没有 Content-Length 时会整份读进内存），上限在流里数。

**合同**（版本 6）：`inspect`、`install` 的输入 `{path} | {upload}`；入口用 `uploads.use(id, dir => inventory.inspect(dir))`，安装结束后 `discard`。

**页面**：

- 共用模块 `src/ui/dropped-folder.ts`（t15 也用）：`readDrop(dataTransfer)` 在 `drop` 的同步段里取全部条目，交回 `Array<{kind: "folder", entry} | {kind: "file", file}>`（解释交给调用方）；`collectFolder(entry, {skip, limits})` 递归、`readEntries` 循环读到空，深度至多 64，交回 `{name, files: [{path, file}]}`；`collectInputFiles(files)` 从 `webkitRelativePath` 得到同样的形状。数目、大小与路径规则在收集时就查，过限立即停。
- 上传客户端 `web/plugin-upload.ts`（失败有三种形状都要识别：路由的 `{code, detail}`、nb-host 的 `{error: {code, message}}`、没有正文的 413）：拼分帧、一个 `fetch`、`AbortController`；作为 prop 交给插件页（Lab 夹具与 dom 测试注入替身，不替换全局 `fetch`）。读文件失败与连不上服务端都表现为请求失败，提示“读取或上传没有完成”（浏览器分不出两者）。
- 防导航：插件页挂载期间在 `window` 上对含 `Files` 的 `dragover`、`drop` 做 `preventDefault()`（只防整页导航，不安装；某个更近的落点已 `preventDefault` 的拖动，插件页自己的安装逻辑看 `defaultPrevented` 跳过，给 t15 的落点让路）。落点（安装）在插件页内容区，根元素撑满设置窗口的内容区；落在内容区外（侧栏、标题、确认框遮罩）时覆盖层不出现，在设置窗口顶部短暂提示“拖到插件页的内容区”。
- 拖放落点是插件页的根元素：`dragenter`、`dragover` 对 `types` 含 `Files` 的拖动 `preventDefault()`、设 `dropEffect = "copy"`、显示覆盖层；`dragleave` 在 `relatedTarget` 不在根元素内时收起；`drop`、`dragend` 收起。设置窗口是工作台上的浮层，编辑器与文件树（t15）有自己的落点，各管各的元素。
- 进行中（上传中，或预览、确认框开着）再拖入：提示“正在处理上一个文件夹”，不理；确认框关掉（取消）后才能拖下一个。
- 文字：`errors.path-rejected` 在来源是上传时换成“拖入的文件夹已失效，重新拖入”；各条提示的中英文。
- 配套：`PluginsPage.md`、Lab 夹具 `PluginsPageFixture.vue`、`PluginsPage.dom.test.ts`。

## 切片

0. **nb-host 转交改流式**（前置，独立提交与测试）：`packages/nb-host/src/http/dispatch.ts` 的 `forwardedRequest` 显式传 `body: request.body`、`duplex: "half"`、`signal`；测试经真实 `Bun.serve` 与 nb-host 分发上传 100 MiB，读得慢时进程内存峰值不随请求体增长（断言增量低于请求体的一半），客户端中途断开时读流以中止结束。不改 `maxRequestBodySize`（64 MiB 远低于缺省 128 MiB）。
1. Spec（master）：`runtime.plugin-install` 输入、输出、状态（上传的可用与使用中）、失败码、副作用（暂存区与寿命）、边界（合同版本 6、上传路由）、验收加一条；条目级 planned。
2. 共用模块 `src/shared/plugin-upload.ts`：分帧的编码与流式解析、路径规则；单元测试逐条规则、分帧的边界（头被切在两个块之间、截断、超长头）。
3. 服务端：`uploads.ts`、宿主装配、路由、合同 6；测试用真实文件系统与真实 Hono 路由：签发与查表（伪造 id）、超限（单个、总量、文件数、同时存在的个数）、中途断开不留目录、`wx` 冲突、使用中删除排队、清扫不删使用中的、首次使用清空、`inspect`、`install` 用上传 id、安装后删除、删除不存在算成功。
4. 页面：`dropped-folder.ts`（替身按 `FileSystemDirectoryEntry` 的真实形状写：`readEntries` 分批回调、错误回调）、上传客户端、插件页的落点与覆盖层、“选择文件夹”、各条提示、预览文字；dom 测试（拖入单个文件、压缩包、上一层目录、进行中再拖入、发出安装后离开不删除）；Lab 夹具。
5. e2e（插件页的文件，实施时查准）：“选择文件夹”用 `setInputFiles` 传示例插件目录（含一个 `node_modules` 子目录，确认没传上去）→ 预览显示文件数 → 安装 → 列表“重启后安装”。
6. Windows（等 pc-notype 能构建）：从资源管理器拖文件夹进桌面窗口的插件页并安装；拖文件、压缩包的提示。结果也给 t15 用。

## 验证

单元：`bun test src/plugin-platform/ src/plugins/plugins/ src/shared/plugin-upload.test.ts`，`src/ui/` 的 dom 测试；类型检查（含 Lab）；`bun run test:affected --since <分支起点>`。e2e：插件页的文件。

## 待确认（照推荐做，记进待确认清单）

- 加“选择文件夹”按钮（键盘用户的入口，也让 e2e 真实上传目录）。已知：Chromium 选目录时会先弹“上传 N 个文件”，N 含 `node_modules`（页面之后会跳过它们）。
- 上限：10000 个文件、总 64 MiB（含分帧头）、单个 32 MiB。
- 符号链接上传后变成普通文件，不像路径安装那样拒绝。
- 只收文件夹，不收 `.zip`、`.tgz`。
- 上传的路径一律按 Windows 也合法的规则查，不论服务端在什么系统上。

## 不做

- 拖入 npm 包文件、URL；插件市场。
- 只上传 `files` 用得到的部分（第 1 轮第 14 条）：先不做。路径规则在页面收集时就查，`files` 用不到的文件不合规也会在上传前被拒，代价是少数插件要改文件名；真遇到再做“按 `files` 预筛”。
- 拖到插件页以外的地方（文件树、编辑器、书架归 t15）。
