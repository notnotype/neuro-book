# t16 计划：清理没人引用的主题素材

## Context

主题编辑器把素材（场景图、工作态场景、图标 SVG）写进 `user://theme-assets/`，文件名是内容的 SHA-256。素材只增不减：被替换或移除的、复制或导入中途失败时已经传上的，都留在那里（[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 11、边界“素材不整理，也不回滚”，t12 设计审查第 6 条接受的取舍，当时因为“文件服务没有删除能力”）。现在服务端 `WorkspaceFiles` 有 `delete`（[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“文件操作”），可以清。开发者 2026-11-06 要求做掉。

要清的是“没有任何用户主题引用的素材”。引用关系在 Storage 的用户记录 `user-themes` 里（浏览器写，工作台读），Files 后端不认识它，也不该认识（Files 在底层，不依赖工作台的数据）。

## 关键设计

### 清理由用户触发，不在后台自动做

编辑器的主题库区（左栏）加“清理未使用素材”：点它先**只统计**（几个文件、共多大），确认后才删。不做启动时或保存后的自动清理：删除用户数据的动作要有用户的明确操作（Files Spec“删除只在明确删除操作下”）。

### 路由：`POST /api/nbook.files/theme-assets/sweep`（`files/backend/theme-asset-route.ts`）

- 请求体 JSON：`{keep: string[], dryRun: boolean}`。`keep` 是调用方认为仍被引用的素材文件名。
- 服务端：列 `user://theme-assets/`（`lstat` 真实目录、拒绝符号链接，同上传路由）；候选 = 文件名匹配 `^[0-9a-f]{64}\.(png|jpg|webp|svg)$` 的**普通文件**（别的名字、子目录、符号链接一律不碰），且不在 `keep` 里，且**最后修改时间早于 10 分钟前**。`dryRun` 只返回 `{removable: [{name, bytes}]}`；否则对每个候选在互斥内逐个：`lstat` 重新核对仍是普通文件且 mtime 仍早于保护线，再经 `ownFiles.delete`（带 `expected` 身份令牌）删掉，返回 `{removed, skipped}`。**`expected` 只是目录项身份令牌**（设备号、inode、创建时间、类型，`rooted.ts` 的 `entryToken`），只防“这个名字换成了别的文件”，原地改写或刷新 mtime 令牌都不变（设计审查第 3 条，用真实 `entryToken` 验证），所以“改过就不删”靠互斥内的 `lstat` 重核对 mtime，不靠令牌。
- 同一目录的上传（`store()`）与清理串行：这两条路由共用一把进程内互斥（同一时刻只有一个在列出、判断、删除或定名写入）。**互斥只管这两条路由**，不是 Files 的通用写锁：经文件管理器等通用入口改 `user://theme-assets/` 的写入不参与（那是用户明确的另一种操作，主题素材不在内容树里，通用删除也不取内容树锁，`commit.ts`），Spec 要写明这一点；假定一个状态根只有一个服务进程。
- 上传命中“已有同名同字节”时**更新文件的修改时间**（`utimes`），让“刚被重新选中的旧素材”落进 10 分钟的保护期：否则会出现清理读完引用、用户随后重新上传了同一份旧素材（路由说已有，直接返回）、清理随后删了它，用户的新主题引用的就是一个不存在的文件。
- 失败：非 JSON、`keep` 不是字符串数组或有不合法的名字为 400；目录不是真实目录 409 `invalid-target`；单个文件删除失败记进 `skipped`，不中断。限制：`keep` 至多 8192 项、请求体至多 1 MiB，超限为 400 并显式拒绝，**绝不截断**（截断就把拒绝变成误删）。上限的来由：`user-themes` 记录至多 512 KiB（`USER_THEMES_RECORD.maxBytes`），一个引用的名字至少约 70 字节（64 位十六进制加扩展名加引号逗号），所以唯一引用至多约 7500 个，8192 总能装下；设计审查第 4 条用真实校验造出 4224 个唯一引用（33 套主题，每套亮暗各 64 个图标）、请求约 300 KB 验证过。客户端发现 `keep` 超过上限时拒绝清理并提示，不发请求。

### 为什么由客户端交 `keep`，不由服务端读 Storage

`user-themes` 是工作台的 Storage 记录，服务端 Files 去读它就多了一条 Files → 工作台数据的依赖。取舍：客户端交 `keep`，风险是客户端交了不全的清单会误删。防线：
1. 客户端在**当次**从 Storage 重新读 `user-themes`（不用内存里的快照），读失败或记录损坏时拒绝清理；
2. `keep` 的名字集是对记录里所有用户主题、两种明暗里的 `scene`、`workingScene`、`icons` 的并集（复用 `web/components/theme-editor/assets.ts` 的 `assetRefs`，与导出、复制用同一个函数）；
3. 10 分钟的保护期兜住“另一个窗口刚传、还没写进记录”；
4. 先 `dryRun` 给用户看数量，用户确认才删。

### `packages/neuro-book/src/plugins/workbench/web/components/theme-editor/`

- `transfer.ts` 加 `sweepAssets(keep, dryRun)`，`asset-upload.ts` 里是 fetch 的落点；`theme-editor-model.ts` 加 `unusedAssets()`（重新读记录、算 `keep`、`dryRun`）与 `sweepUnused()`。
- `ThemeEditor.vue`（主题库区）一个按钮和一行结果提示：统计结果（“有 N 个未使用的素材，共 X KB，清理吗”）加确认、清理结果（删了几个、跳过几个）；无可清理时按钮旁写“没有可清理的素材”。确认用现有的确认对话框或行内确认（实现前在 nb-ui 里找 `ConfirmDialog` 之类）。
- 上传进行时（`status.busy`）停用。

## Spec 与文档改动

- `workspace/files.md`：“主题编辑器”一段加 `POST /theme-assets/sweep`。
- `theme/editor.md`：输出 11 与边界改为“素材可手动清理”；加输出“清理未使用素材”和验收；`user-themes` 引用口径（哪些字段算引用）写成一句。
- 组件文档 `ThemeEditor` 同步。

## 切片

1. 路由与互斥、`utimes`、路由合同测试（`theme-asset-route.test.ts`：保护期、`keep`、不合法的名字与符号链接不碰、删除时目录项换了 inode 则跳过、**同 inode 原地改写与同 inode 刷新 mtime 各一条**（令牌不变，靠互斥内的 `lstat` 重核对）、上传命中同字节更新时间、与上传并发、`keep` 超过 4096 个唯一名字仍正确清理且超过 8192 个被拒绝）。验证 `bun test src/plugins/files/theme-asset-route.test.ts`。
2. 客户端（`transfer`、模型、界面、语言包、Lab 夹具）与 Spec、组件文档。验证：`theme-editor.test.ts`（引用并集与上传到清理的全程，fetch 接真实路由，沿用现有的 `wire()`）、`locales.test.ts`、类型检查。
3. e2e：`theme-editor.e2e.ts`（上传两张后移除一个、统计、确认、清理，素材目录里文件少一个且仍被引用的还在；保护期内的文件不删）。

## 验收映射

- `theme.editor` 新输出与验收：切片 3 的 e2e、切片 2 的 `theme-editor.test.ts`、切片 1 的路由测试。
- 数据不丢的不变量（被引用的与保护期内的不删、符号链接不碰、令牌不变的原地改写不被误删）：`theme-asset-route.test.ts`，含“清理读完引用之后重新上传同一份旧素材”的竞态用例（路由合同层可控时序）。

## 验证

`bun run build`、`bun run build:e2e`；只跑 `theme-editor.e2e` 的清理用例。取证：亮色 `nbdev shot` 主题库区的统计提示与确认。

## 不做与风险

- 不自动清理，不做回收站（Files 首版不做，[files.md](../../../../../docs/specs/workspace/files.md)）；被删素材找不回来，所以先统计再确认。
- 不在服务端读 `user-themes`（上面的取舍）；不清理 `user://theme-assets/` 以外的任何目录。
- 风险：保护期 10 分钟是经验值（上传与写记录之间只隔几秒，剩余是给慢设备和多窗口）；文件系统不保证 `mtime` 精度时（一些网络盘）退化成“刚改过的短时间内可能不受保护”，可接受并在 Spec 写明；`互斥内的 `lstat` 重核对与 `delete` 之间没有原子性，但那一段只有经通用入口的写入能打断，且保护期（10 分钟）里的文件已被排除，残余窗口可接受。
