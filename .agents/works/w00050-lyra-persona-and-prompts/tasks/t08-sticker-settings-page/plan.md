# t08 计划：表情包设置页

## Context

开发者 2026-11-18 提出：放表情包文件夹太麻烦，要一个设置界面，能新建、编辑、导出导入表情包，以后做表情包市场。设计经三轮评审板定稿（[`artifacts/review`](artifacts/review/index.html) v3），交互与边角的决定见 [README](README.md) 的“决定”1 到 19。行为合同：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 输出 20、25 到 38，“副作用与数据”，失败表里标 planned 的几行，验收 9、10。

定稿的样子是草稿 worktree 里的 `StickerPacksPageDraft`（`.worktree/w00050-t08-drafts`，分支 `w00050-t08/drafts`，不合并）：实现照它的版式与类名拆成正式组件，样本数据搬进 Lab。

依据的现状（调研见会话，证据位置写在各节）：远程调用单条消息至多 1 MiB（`nb-host/src/shared/socket.ts:16`），所以图片与 zip 走 HTTP；文件服务的 `rename`、`delete` 作用于目录（[workspace.files](../../../../../docs/specs/workspace/files.md) 的“文件操作”），`copy` 只在同一方案里；`stickers://` 拒绝写，写要用 `user://stickers/…`。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 读写 zip | `fflate`（应用已依赖，主题包导入导出在用，`theme-editor/package-io.ts`） | 同步 `zipSync` 写、流式 `Unzip` 读，能边解边数大小，挡 zip 炸弹 | `yazl`（只写、根工作区才有）；`Bun.Archive`（只说了 tar） |
| 缩小图片 | `Bun.Image`（目录核对已在用） | `resize`、`png`、`jpeg`、`webp` 都有 | `sharp`：新依赖 |
| 动态 WebP | 读 VP8X 块的动画位（约 10 行） | `Bun.Image` 没有帧数；只判这一位 | 解析整个 RIFF |
| GIF 是不是动图 | 不判断，超限一律拒绝（决定 18） | `Bun.Image` 写不出 GIF，判出静态也只能转格式 | 数图像描述块 |
| 打开文件夹 | 现有 `openFolder`（`agent/backend/skills/folder.ts`，用 `open` 包） | 已经处理没有桌面与打开失败 | 再写一份 |

## 关键设计

### `packages/neuro-book/src/shared/open-folder.ts`

把 `agent/backend/skills/folder.ts` 的 `openFolder` 挪到这里（服务端共用，旁边就是它依赖的 `shared/desktop.ts`），Skill 一侧改成从这里导入。不改行为。调用方自己限定路径：它会 `mkdir -p`。

### `stickers/backend/catalog.ts`：目录多记两样

- 每个表情包多记 `listed: boolean`（清单写了表情列表）与 `extras`：名字当不了表情名但字节是相符图片的（`reason: "name"`），有列表时文件夹里没列的图片（`reason: "unlisted"`）。两者都带宽高、版本、字节数；核对复用现有的 `readImage` 与按戳记的缓存。没列的图片要列一次文件夹：有列表的包现在不列，多一次 `readdir`。
- `extras` 只进新的详情接口，不进浏览器目录与概要（输出 18 的字节预算不变）。
- 打开目录时清掉 `user://stickers/` 里以 `.nbook-` 开头的残留文件夹（导入、替换中途断掉留下的，见下文）；以点开头的本来就不是表情包。

### `stickers/shared/contracts.ts`：详情与远程合同

- `StickerPackDetail`：条目（`StickerPackEntry`）加 `listed`、每个表情的 `bytes`、`extras`。一个包至多 500 项加同样多的 extras，说明至多 200 字，序列化不过 300 KiB，在远程消息上限内。
- 远程服务 `nbook.stickers` 加方法（参数与结果都小）：`pack({id})`；`createPack({folder, title})`；`updatePack({id, title?, description?})`；`renamePack({id, folder})`；`deletePack({id})`；`updateSticker({id, file, name?, description?, common?})`；`deleteSticker({id, file})`；`listFiles({id, files})`（加进来）；`deleteFile({id, file})`；`copyPack({id})`；`revealPack({id})`。失败经 `context.fail(code, data)`，码见下文“失败码”。按文件名定位表情（`file`），不按名字：改名时名字在变。
- 浏览器服务键 `stickerAllowlistUsageKey`：`{profilesUsing(packId): Promise<readonly string[]>}`，定义在表情包的合同里，由 `nbook.agent` 的浏览器入口提供（读 Profile 目录与 `profileSettings`）；表情包页可选依赖它，没有时改名对话框不列 Profile。依赖方向同后端：Agent 依赖表情包的合同，表情包不依赖 Agent。

### `stickers/backend/editor.ts`（新）：页面的全部写入

一个类，构造时拿 `WorkspaceFiles` 与目录，所有写入经文件服务写 `user://stickers/<folder>/…`，一次用户操作包成一个操作分组（`group`）。只对 `source: "user"` 的包写，别的得 `not-user-pack`。

- **改清单**（输出 28）：`files.update(清单地址, edit)`，按读到的基线写回、冲突重读（文件服务已有，至多 3 次）。`edit` 解析 JSON、只改目标那一处、`JSON.stringify(…, null, 2)` 写回；别的字段原样留着（JSON 解析再序列化会丢掉原来的缩进与键的写法，接受）。没有清单时先 `write(…, {expect: "absent"})` 一份 `{"stickers": [...]}`，项是当前目录认的表情（文件名，`common: true`），再走同一个 `update`。改名先按 `isStickerName` 与同包重名核对，不合规不写。
- **加图片**（输出 29）：`addImage(id, fileName, bytes)` → `prepareImage` 按决定 18 缩小或拒绝（纯函数，单独测）→ 选不撞名的文件名（`-2`、`-3`）→ `write(…, {expect: "absent"})` → 有列表的再在清单末尾加一项。
- **新建、改包名、删除、加进来、删文件**：`create` 目录加 `write` 清单；`rename` 目录；`delete` 目录或文件；清单的增删项走改清单的同一条路。
- **复制到我的**（输出 32）：读插件包的文件夹（`readPath` 后逐个读清单与图片，至多 501 个文件）写进新的 `user://stickers/<folder>/`；目标先写到 `.nbook-copy-<随机>`，写完再改名成正式包名，中途失败删掉临时的。
- **导入**（输出 36）：`importZip(bytes, zipName, onConflict?)`：流式解压，边解边数（单个文件解开至多 32 MiB、合计至多 256 MiB、至多 600 个文件，超了立即停），只收一层文件夹或根上的清单与图片；写进 `.nbook-import-<随机>`；包名冲突且没给 `onConflict` 时删掉临时的、交回冲突（两边的显示名、表情数与前几个表情的文件名，页面据此画对话框，再带 `onConflict` 重传一次）。`replace`：旧包先改名成 `.nbook-replaced-<随机>`，临时的改成正式名，再删旧的；`copy`：临时的改成 `<包名>-2`。改名失败时把旧的改回来。zip 在内存里（至多 64 MiB），不落临时文件。
- **导出**（输出 35）：读文件夹里的清单与图片，`zipSync` 成 `<包名>/…`，至多 500 张、每张至多 2 MiB，内存里至多约 1 GiB 的极端情形接受（实际的包远小于此），不另做流式。

### `stickers/backend/routes.ts`：三条 HTTP 路由

沿用现有取图路由的注册与跨站规则（只放行 same-origin 与 none，`routes.ts:21`）；请求体边收边数，超限 413，写法照 `files/backend/upload-route.ts` 的 `readBody`（不跨插件导入，抄一份十来行的有界读取，或者挪到共用处，实施时看那段是否已在 `shared`）。

- `PUT /api/nbook.stickers/packs/<id>/images/<文件名>`：原始字节至多 32 MiB（手机照片），交 `editor.addImage`；结果 `{file}` 或 `{rejected: reason}`。页面一张一张传，几张并发至多 3 个。
- `POST /api/nbook.stickers/import?name=<zip 文件名>&onConflict=replace|copy`：原始字节至多 64 MiB；冲突 409 带对照信息。
- `GET /api/nbook.stickers/export/<id>`：`Content-Type: application/zip`、`Content-Disposition: attachment; filename*=UTF-8''<包名>.zip`，写法同 Agent 附件（`agent/backend/attachments.ts:147`）。
- 取图路由放宽一条：用户包的 `extras` 也给（字节核对不变），属性栏与网格要显示认不出与没加进来的图。

### `stickers/web/`：页面

- 组件放 `stickers/web/components/`，各带同名 `.md`：`StickerPacksPage.vue`（整页与选中、对话框的开关）、`StickerPackRail.vue`、`StickerGrid.vue`（分组、格子、拖放）、`StickerPanel.vue`（属性栏的两种内容）、`NewStickerPackDialog.vue`、`RenameStickerPackDialog.vue`、`ImportConflictDialog.vue`。版式、类名与格子尺寸照草稿第 3 轮。删除确认用 `AlertDialog`。
- `packs-page.ts`：取数与写入，照 Agent 的 `profile-page.ts` 的写法：先订阅 `changed` 再取 `packs` 与选中包的 `pack`，晚到的旧结果丢掉；写入调远程方法或 `fetch` 路由，失败走工作台通知。选中的表情按 `file` 记。
- 登记：表情包浏览器入口向 `settings.pages` 贡献 `nbook.stickers.packs`（分类 `ai`、`order` 32、`layers: ["user"]`、`layout: "fill"`，同 Profile 页），`load` 按需导入页面。文字进表情包插件自己的消息目录（照 Agent 的 `text.ts` 写法），中英两份。
- Lab：七个组件各登记场景，样本是草稿的 `samples.ts` 搬过来（含宽图、竖图、不透明方图），另加一个英文场景与 390 宽场景（ui-development 检查第 5 条）。

### `agent/web/`：白名单用到哪些 Profile

提供 `stickerAllowlistUsageKey`：用 Profile 页同一份目录与 `profileAllowlist` 的合成，返回白名单里有这个 id 的 Profile 显示名。

## 失败码

`not-user-pack`、`pack-missing`、`pack-exists`（包名已被用）、`folder-invalid`、`name-invalid`、`name-duplicate`、`sticker-missing`、`image-rejected`（带原因：类型不符、读不出宽高、GIF 超限、动态 WebP 超限、缩完仍超限）、`import-invalid`（读不懂、没有图片、包名转不出）、`import-too-large`、`import-conflict`（409）、`no-desktop`、`open-failed`，以及文件服务的码原样交回（`conflict`、`permission-denied` 等）。页面把码映射成文字，不按文案分支。

## Spec 与文档改动

- `docs/specs/agent/stickers.md`：已在 master 上加好（planned）。实现后逐条核对、去掉标记、补实现合同与证据。
- `docs/specs/agent/skills.md` 不动（只是 `openFolder` 搬家）。

## 切片

1. **读的一侧**：`open-folder` 搬家；目录的 `listed` 与 `extras`、残留清理；`pack` 详情；取图路由放宽。测试：`stickers.test.ts` 加详情与 extras、取图；Skill 的打开文件夹测试照过。
2. **写的一侧**：`editor.ts` 的改清单、新建、改包名、删除、加进来、删文件、复制；远程方法。测试：真实目录、真实文件服务内核（同现有 `stickers.test.ts` 的场地），每条输出一组。
3. **上传与 zip**：`prepareImage`（纯函数，单测缩小、转 WebP、GIF 与动态 WebP 拒绝）；三条路由；导入的形状、上限、冲突与替换。测试：路由跨站、413、zip 炸弹（一个解开很大的项）、冲突两种。
4. **页面**：组件、`packs-page.ts`、登记、文字、Lab；Agent 提供白名单用途。测试：页面的 DOM 测试（选中、分组、改名不合规、冲突对话框、跟着目录变），Lab 截图看过亮暗与 390 宽。
5. **验收与收口**：e2e 验收 9、10；Spec 逐条核对后去掉 planned。

每片单独提交，片内自跑：`bun test src/plugins/stickers src/plugins/agent/stickers-slot.test.ts`（第 4 片加 `src/plugins/agent/web`）、`bun run typecheck`。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 25、26、27、38 | 第 4 片的页面 DOM 测试；Lab 截图 |
| 输出 28、30、31、32、33、34 | 第 2 片的 `stickers.test.ts` 写入用例；33 的 Profile 列表在第 4 片 |
| 输出 29 | 第 3 片 `prepareImage` 单测与上传路由用例 |
| 输出 35、36 | 第 3 片导出、导入用例；e2e 验收 9、10 |
| 输出 37 | 第 1 片 `openFolder` 搬家后 Skill 的现有用例；表情包的 `revealPack` 在没有桌面的环境下得 `no-desktop` |
| 失败表的五行 | 第 2、3 片各用例；跨站在路由用例 |
| 验收 9、10 | `e2e/stickers.e2e.ts` 新增两条 |

## 验证

- 每片的 bun 测试与类型检查。
- 合入前 e2e：`stickers.e2e.ts`（含新增两条）、`agent-profiles.e2e.ts`（Profile 页的表情包一节与白名单用途）、`settings-window` 相关的一个文件（新分区出现在左栏）。直接跑 Playwright 前先构建 server、web、e2e 三份产物，并先看负载。
- 实施中只重跑改动覆盖的文件。
- 未验证边界：macOS、Windows 的“在文件夹中显示”（同 Skill 页，只在 Linux 测）。

## 不做与风险

- 不做：拖动排序、多选、裁剪、撤销、表情包市场、白名单迁移（Spec 的“不承诺”）。
- 风险：改清单会把 JSON 重新格式化（缩进、键序按解析结果），手写清单的格式会变；内容不变。接受，交付时说明。
- 风险：导入替换与复制走“临时文件夹再改名”，不是原子的；中途断掉留下的 `.nbook-*` 文件夹在下次打开目录时清掉，由第 1 片的用例兜底（真实目录里放一个残留文件夹）。
- 风险：页面一次加很多张图时每张触发一次重扫（150ms 内合并）；不另做批量接口，按现有合并的重扫看效果，慢了再改。
