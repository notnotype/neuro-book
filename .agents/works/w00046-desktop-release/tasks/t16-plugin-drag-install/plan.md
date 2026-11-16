# t16 计划：把插件文件夹拖到插件页安装

## 目标

在插件页把一个插件文件夹（构建好的，根目录有 `package.json`）从系统拖进来，就能走现有的“预览、确认安装”。浏览器与桌面同一份实现（HTML5 拖放）。

## 现状（读过的代码）

- 安装的输入只有“服务端可读的本地文件夹路径”（[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 的“输入与前置条件”）。插件页（`src/plugins/plugins/web/components/PluginsPage.vue`）是一个路径输入框：`registry.inspect({path})` 预览，确认后 `registry.install({path})`。
- 远程服务 `nbook.plugins` 的合同在 `src/plugins/plugins/shared/contracts.ts`，后端入口 `backend/plugin.ts` 只把宿主的 `pluginInventoryKey`（`src/plugin-platform/backend/inventory.ts`）映射成合同。`inspect`、`install` 都收一个源文件夹路径；复制按 `files` 规则、任何深度都排除 `node_modules` 与 `.git`（`copy.ts`），源不能在 `<State Root>/plugins/` 里，范围内有符号链接就 `path-rejected`。
- 远程服务走 RPC（JSON），不适合传文件字节。插件可以经 `HTTP_ROUTES_POINT` 贡献 Hono 路由（`nbook.files` 的 `PUT /api/nbook.files/theme-assets` 是现成的上传写法：`bodyLimit`、失败体 `{code, detail}`）。
- HTML5 拖放拿不到本机路径（浏览器与 WebView2 都是），只能读内容。拖进来的文件夹经 `DataTransferItem.webkitGetAsEntry()` 遍历；`<input type="file" webkitdirectory>` 给的是带 `webkitRelativePath` 的文件列表。

## 行为（写进 Spec，`runtime.plugin-install`，条目级 planned）

1. **安装的第二种输入：上传的文件夹。** 插件页接受从系统拖入的一个文件夹，也可以点“选择文件夹”选一个（同一条路，主要给浏览器与测试用）。页面把文件夹里的文件上传到服务端的上传暂存区，之后的预览、确认、安装与路径输入完全相同（同样的校验、失败码与确认界面）；预览里“来源”写“拖入的文件夹 `<名字>`”而不是路径。
2. **页面上传什么。** 任何深度的 `node_modules`、`.git` 目录不上传（安装时本来就排除）；别的文件都上传，`files` 的取舍仍由安装时的复制决定。符号链接：浏览器读到的是链接目标的内容，上传后是普通文件（与路径安装不同，已知限制）。
3. **拒绝。** 拖入的不是文件夹（文件、多个条目、网页里的文字或链接）：插件页提示“拖入一个插件文件夹”，不上传。超过上限（文件数 10000、总大小 256 MiB，单个文件 64 MiB）：在上传前按页面数到的数目拒绝；服务端照样按上限检查。
4. **上传暂存区。** `<State Root>/plugin-uploads/<上传 id>/`，不在 `<State Root>/plugins/` 里。一次上传一个目录、一个随机 id；只有插件所有者能建、写、删。预览之后取消、安装完成（成功或失败）、页面离开，页面都请求删除；服务端另外删掉 1 小时没有写入也没有被预览、安装用过的上传，启动时清空整个暂存区。
5. **失败码**（上传的路由各自返回 `{code, detail}`）：`upload-too-large`（超过上限，413）、`upload-path-invalid`（相对路径不合法：空段、`.`、`..`、绝对路径、反斜杠、控制字符、Windows 上不合法的名字，400）、`upload-not-found`（上传不存在或已清掉，404）、`upload-failed`（写盘失败，500）。`inspect`、`install` 收到不存在的上传 id 时以 `path-rejected` 拒绝（“上传已过期，重新拖入”）。

## 设计

**服务端**（`src/plugin-platform/backend/uploads.ts`，新）：

- `createPluginUploads({stateRoot, clock, limits})` → `{create(): id, write(id, relativePath, bytes), resolve(id): 目录路径 | null, discard(id), sweep()}`；启动时 `clear()`。
- 路径校验与 `copy.ts` 的同一份规则（抽出共用函数，不复制一份）；写入前 `lstat` 逐段确认目录不是链接；文件不覆盖（同一路径写两次是 `upload-path-invalid`）。
- 计数（文件数、总字节）在 `write` 里累加，超过就拒绝并删掉这次上传。
- 由宿主与 `pluginInventoryKey` 一起创建（宿主知道状态根），作为宿主能力给 `nbook.plugins`。

**路由**（`nbook.plugins` 贡献，`/api/nbook.plugins/uploads`）：`POST /uploads` 建，`PUT /uploads/<id>/<路径…>` 写一个文件（原始字节，`bodyLimit` 单文件上限），`DELETE /uploads/<id>` 删。授权与插件管理接口一样（插件所有者）；写请求照 nb-host 的来源检查。

**合同**：`inspect`、`install` 的输入改成 `{path} | {upload}`（TypeBox 联合，`additionalProperties: false`）；后端入口把 `upload` 解析成目录再交给 `inventory`；解析不到给 `path-rejected`。安装成功或失败后入口删掉这次上传。

**页面**（`PluginsPage.vue` 与一个新的纯 TS 模块 `web/folder-upload.ts`）：

- `collectFolder(entry)`：遍历 `FileSystemDirectoryEntry`（`readEntries` 要循环读到空），跳过 `node_modules`、`.git`，交回 `{name, files: [{path, file}]}`；`collectInput(files)` 从 `webkitRelativePath` 得到同样的形状。数目与大小在这里先判。
- `uploadFolder(folder, client)`：建上传、并发 4 个 `PUT`、失败时删掉上传；交回上传 id。进度显示在预览按钮的位置（“正在上传 12/40”）。
- 拖放：整个插件页是落点，拖着文件夹经过时显示一层提示（“松开以安装插件”），`dragleave` 按计数收起；只接 `types` 含 `Files` 的拖动。

## 切片

1. Spec（master）：`runtime.plugin-install` 输入、输出、失败码、副作用（暂存区）、验收加一条；按条目标 planned。
2. 服务端：`uploads.ts` 与路径规则共用、宿主装配、路由、合同改 `{path} | {upload}`；测试：真实文件系统与真实 Hono 路由（上限、路径、过期、清扫、启动清空、授权、`inspect`、`install` 用上传 id、安装后删除）。
3. 页面：`folder-upload.ts`（遍历用与 `FileSystemDirectoryEntry` 对过形状的替身，单元测试跳过规则、上限、`readEntries` 分批）、插件页的落点与“选择文件夹”、预览文字；`PluginsPage.dom.test.ts` 补拖入状态。
4. e2e：`plugins.e2e`（实施时查准文件名）用“选择文件夹”上传示例插件目录（Playwright 的 `setInputFiles` 给目录），预览、安装、重启前列表显示“重启后安装”；拖入文件时的提示。
5. Windows（等 pc-notype 能构建）：从资源管理器拖一个文件夹进桌面窗口的插件页，装上；拖文件时提示。

## 验证

单元：`bun test src/plugin-platform/ src/plugins/plugins/`；类型检查；`bun run test:affected`。e2e：插件页的文件。Windows 拖放放进切片 5 的证据。

## 待确认（照推荐做，记进待确认清单）

- 加一个“选择文件夹”按钮（与拖入同一条路）：浏览器部署时能装插件，也让 e2e 能真实上传目录。
- 上限：10000 个文件、总 256 MiB、单个 64 MiB。
- 符号链接上传后变成普通文件，不像路径安装那样拒绝（浏览器读不出是不是链接）。
- 不收 `.zip` 或 `.tgz`：只收文件夹（npm 包要先解开）。

## 不做

- 拖入 npm 包文件、URL；插件市场。
- 拖到插件页以外的地方（文件树、编辑器的拖入归 t15）。
