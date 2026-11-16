# t16 计划：把插件文件夹拖到插件页安装（r2）

r2 按设计审查第 1 轮（Opus 17 条，[处理](evidences/design-review-r1-disposition.md)）改：上传有封口与状态机、id 只认服务端签发的、相对路径放 query、写入流式落盘、拖放事件写全、遍历放共用层、补配套。

## 目标

在插件页把一个插件文件夹（构建好的，根目录有 `package.json`）从系统拖进来，就能走现有的“预览、确认安装”。浏览器与桌面同一份实现（HTML5 拖放）。

## 现状（读过的代码，审查核对过）

- 安装的输入只有“服务端可读的本地文件夹路径”（[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 的“输入与前置条件”）。插件页（`src/plugins/plugins/web/components/PluginsPage.vue`）是路径输入框：`registry.inspect({path})` 预览，确认后 `registry.install({path})`。
- 远程服务 `nbook.plugins` 的合同在 `src/plugins/plugins/shared/contracts.ts`（版本 5），后端入口 `backend/plugin.ts` 把宿主的 `pluginInventoryKey`（`src/plugin-platform/backend/inventory.ts`）映射成合同。复制按 `files` 规则、任何深度排除 `node_modules` 与 `.git`（`copy.ts`）。命令行 `nbook plugin` 直接用 `createPluginInventory`，不经合同，不受本 Task 影响。
- 远程服务走 RPC（JSON）。插件经 `HTTP_ROUTES_POINT` 贡献 Hono 路由（`nbook.files` 的 `theme-asset-route.ts`、`raw-route.ts` 是写法参照：`bodyLimit`、`onError(rethrowRouteError)`、失败体 `{code, detail}`）。路由在服务端入口激活后才挂上；插件页打开时先 `list()`，入口那时已激活。
- v2 没有鉴权：本机单用户，插件所有者就是本机访问者；写请求由 nb-host 的来源检查拦外站。
- HTML5 拖放拿不到本机路径，只能读内容。Electrobun 2.0.6 在 Windows 上没有改 WebView2 的 `AllowExternalDrop`（缺省允许，`nativeWrapper.cpp` 里没搜到），外部拖放会交给网页；仍要在 Windows 上实测（切片 5）。

## 行为（写进 Spec，`runtime.plugin-install`，条目级 planned）

1. **第二种输入：上传的文件夹。** 插件页接受从系统拖入的一个文件夹，也可以点“选择文件夹”（键盘用户与浏览器的入口，同一条路）。页面把文件上传到服务端的上传暂存区、封口，之后的预览、确认、安装与路径输入相同（同样的校验、失败码与确认界面）。预览的来源写“拖入的文件夹 `<名字>`（N 个文件，大小）”。
2. **页面上传什么。** 任何深度的 `node_modules`、`.git` 不上传；别的都上传，取舍仍由安装时按 `files` 复制决定。符号链接：浏览器读到的是目标内容，上传后是普通文件（与路径安装不同，已知限制）。读某个文件失败（构建中被改写、链接断了）：这次上传作废、删掉，提示哪个文件读不了。
3. **拒绝与提示（上传之前，页面判断）。** 拖入的不是文件夹（单个文件、多个条目）：提示“拖入一个插件文件夹”；是 `.zip`、`.tgz` 时另说“先解压，再拖入解出的文件夹”。根目录没有 `package.json`、而恰有一个子目录有：提示“插件好像在 `<子目录>` 里，拖它进来”。超过上限（10000 个文件、总 256 MiB、单个 64 MiB）：按页面数到的拒绝，服务端照样检查。上传或预览进行中再拖入：提示“正在处理上一个文件夹”，不理。
4. **上传暂存区。** `<State Root>/plugin-uploads/<上传 id>/`（不在 `plugins/` 里）。上传 id 由服务端签发（随机、固定格式），只认登记在本次运行内存表里的。一次上传的状态：写入中 → 已封口 → 使用中（预览或安装正在读它）→ 已删除。写入只在写入中；预览、安装只收已封口的；使用中的删除请求等它用完再删。
5. **寿命。** 预览失败、取消、安装结束（成功或失败）后删除：安装由服务端在结束时删，其余由页面请求删；页面离开时用 `keepalive` 请求删；删除不存在的上传算成功。服务端另外删掉 1 小时没有活动（写入、封口、预览）的上传，启动时清空整个暂存区。
6. **失败码**（上传的路由各自返回 `{code, detail}`）：`upload-too-large`（413）、`upload-path-invalid`（400）、`upload-not-found`（404，不存在、已删或已过期）、`upload-state`（409，状态不对：封口后再写、未封口就预览）、`upload-failed`（500，写盘失败）。`inspect`、`install` 收到用不了的上传 id 时以 `path-rejected` 拒绝，详情说明“上传已失效，重新拖入”。

## 设计

**服务端**（`src/plugin-platform/backend/uploads.ts`，新；由宿主与 `pluginInventoryKey` 一起建，作为宿主能力 `pluginUploadsKey` 给 `nbook.plugins`）：

- 内存表 `Map<id, {state, files, bytes, lastActive, users}>`；id 是 `crypto.randomUUID()`，进来的 id 先按 UUID 正则查表，查不到就 `upload-not-found`，不拼路径。
- `write(id, path, body)`：路径校验（下面）→ 逐段 `mkdir`、`lstat` 确认不是链接 → 流式写到临时名再改名（不整份读进内存）；写完用实际字节数累加，超过上限删掉整个上传。同一路径写两次是 `upload-path-invalid`。
- `seal(id)` → `{files, bytes}`；`use(id, fn)`：已封口才进，期间删除排队；`discard(id)`、`sweep(now)`、`clear()`。
- 路径规则（自己的一份，不与 `copy.ts` 的 glob 规则共用）：用 `/` 分段；没有空段、`.`、`..`；不以 `/` 开头；没有 `\`、`:`、控制字符与 Windows 不合法的字符 `<>"|?*`；段不以空格或点结尾、不是 Windows 保留名（`CON`、`NUL`、`COM1` 等，不分大小写、带扩展名也算）；段至多 255 字节、整条至多 1024 字节；NFC 归一化后再比。不论服务端在什么系统上都按这套查（插件要能在 Windows 上装）。

**路由**（`nbook.plugins` 贡献，`/api/nbook.plugins/uploads`，`onError(rethrowRouteError)`）：`POST /uploads` 建 → `{id}`；`PUT /uploads/<id>?path=<相对路径>` 写一个文件（原始字节，`bodyLimit` 单文件上限；`path` 只解码一次）；`POST /uploads/<id>/seal` 封口 → `{files, bytes}`；`DELETE /uploads/<id>` 删（不存在也回 204）。

**合同**（版本 6）：`inspect`、`install` 的输入 `{path} | {upload}`；入口用 `uploads.use(id, dir => inventory.inspect(dir))`，安装结束后 `discard`。

**页面**：

- 共用模块 `src/ui/dropped-folder.ts`（t15 也用）：`readDrop(dataTransfer)` 在 `drop` 的同步段里取 `webkitGetAsEntry()`，交回 `{kind: "folder", entry} | {kind: "file", name} | {kind: "many"} | {kind: "none"}`；`collectFolder(entry, {skip})` 递归、`readEntries` 循环读到空，交回 `{name, files: [{path, file}]}`；`collectInputFiles(files)` 从 `webkitRelativePath` 得到同样的形状。数目与大小在收集时累计，过限立即停。
- 插件页 `upload.ts`：建上传、并发 4 个 `PUT`、封口；任一失败就删掉上传；进度“正在上传 12/40”。
- 拖放：插件页挂载期间在 `window` 上监听（设置窗口侧栏、经 Portal 的确认框也在里面）：`dragenter`、`dragover` 对含 `Files` 的拖动 `preventDefault()` 并设 `dropEffect = "copy"`，显示覆盖层“松开以安装插件”；`dragleave` 在 `relatedTarget === null`（离开窗口）时收起，`drop`、`dragend` 也收起，不用计数。页面内部元素的拖动（`types` 没有 `Files`）不理。卸载时移除监听。
- 文字：`errors.path-rejected` 在来源是上传时换成“拖入的文件夹已失效，重新拖入”；新增各条提示的中英文。
- 配套：`PluginsPage.md`、Lab 夹具 `PluginsPageFixture.vue`（新的 props 与状态）、`PluginsPage.dom.test.ts`。

## 切片

1. Spec（master）：`runtime.plugin-install` 输入、输出、状态（上传的状态）、失败码、副作用（暂存区与寿命）、边界（合同版本）、验收加一条；条目级 planned。
2. 服务端：`uploads.ts`、宿主装配、路由、合同 6；测试用真实文件系统与真实 Hono 路由：签发与查表（伪造 id、`..` 编码）、路径规则（逐条）、流式写与上限（单个、总量、并发写时的总量）、封口前后、使用中删除排队、过期清扫不删使用中的、启动清空、`inspect`、`install` 用上传 id、安装后删除、删除不存在算成功。
3. 页面：`dropped-folder.ts`（替身按 `FileSystemDirectoryEntry` 的真实形状写：`readEntries` 分批回调、错误回调）、`upload.ts`、插件页的覆盖层、“选择文件夹”、各条提示、预览文字；dom 测试；Lab 夹具。
4. e2e（插件页的文件，实施时查准）：“选择文件夹”用 `setInputFiles` 传示例插件目录（含一个 `node_modules` 子目录，确认没传上去）→ 预览显示文件数 → 安装 → 列表“重启后安装”；拖入单个文件的提示（合成 `drop`，只验文件分支）。
5. Windows（等 pc-notype 能构建）：从资源管理器拖文件夹进桌面窗口的插件页并安装；拖文件、压缩包的提示；拖到设置窗口侧栏上不会把窗口导航走。结果也给 t15 用。

## 验证

单元：`bun test src/plugin-platform/ src/plugins/plugins/ src/ui/`；类型检查（含 Lab）；`bun run test:affected --since <分支起点>`。e2e：插件页的文件。

## 待确认（照推荐做，记进待确认清单）

- 加“选择文件夹”按钮（键盘用户的入口，也让 e2e 真实上传目录）。已知：Chromium 选目录时会先弹“上传 N 个文件”，N 含 `node_modules`（页面之后会跳过它们）。
- 上限：10000 个文件、总 256 MiB、单个 64 MiB。
- 符号链接上传后变成普通文件，不像路径安装那样拒绝。
- 只收文件夹，不收 `.zip`、`.tgz`。
- 上传的路径一律按 Windows 也合法的规则查，不论服务端在什么系统上。

## 不做

- 拖入 npm 包文件、URL；插件市场。
- 只上传 `files` 用得到的部分（审查第 14 条的可选优化）：服务端的取舍已经正确，先不做。
- 拖到插件页以外的地方（文件树、编辑器、书架归 t15）。
