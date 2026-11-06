# t12 计划：主题编辑器补图标集、工作态场景与场景提供者

## Context

t06 给声明加了三个字段（[`theme.skins`](../../../../../docs/specs/theme/skins.md) 输出 16 到 18）：`Look.icons`、`Look.workingScene`、`ThemeDeclaration.sceneProvider`。编辑器（[`theme.editor`](../../../../../docs/specs/theme/editor.md)）还没有对应的编辑项，“我的主题”也因为没有素材管线而不收前两个（`userThemeProblem` 拒绝、复制与导入时 `forUserLayer` 丢弃）。开发者 2026-11-06 用 `/autonomous-delivery` 要求补齐这三项，含用户层素材管线（SVG 与第二张场景图）的取舍。

决定（照推荐做，事后追认，记进 [pending-confirmations.md](../../pending-confirmations.md)）：

1. **做素材管线，不再降级**。“我的主题”持有 `icons` 与 `workingScene`；`forUserLayer` 删除。理由：编辑器的目标是“声明能写的东西，编辑器都能编”；降级只是 t06 缺素材管线时的权宜，而且复制书房、导入主题包会丢东西，用户看不出来。
2. **工作态场景的素材就是场景图**：同一条上传路由、同样的命名（`<sha256>.<png|jpg|webp>`），声明里 `workingScene` 写素材文件名，同一份 `crop`。
3. **图标素材是新的一类：`<sha256>.svg`，走新路由 `PUT /api/nbook.files/theme-icons`**，放在同一个 `user://theme-assets/` 目录。场景路由继续拒绝 SVG（Spec 写明的 415 不变）；图标路由只收通过白名单检查的 SVG。理由：两类素材的安全检查不同，混在一条路由里“看内容猜类型”会让场景路由的“只收位图”失去保证。
4. **SVG 检查用元素与属性白名单**（服务端、无 DOM）：元素只收 `svg g path circle ellipse line polyline polygon rect title desc`，属性只收几何与表现属性，不收 `style`、`href`、事件属性，值里不许有 `url(`、`javascript:`、`&`、`<`；不收 DOCTYPE、实体、处理指令、CDATA；至多 16 KiB。这是纵深防御：图标是 CSS `mask-image`，浏览器按“SVG 作为图片”的静态模式处理（t06 e2e 已用探针核实），但同一个文件也能被直接访问（`raw` 路由，已有 `nosniff` 与沙箱），所以不收脚本。lucide 的图标只用到上面这些元素。
5. **编辑项**：“场景与取景”分区加“工作态场景”（上传、更换、移除）、“场景提供者”（下拉，列出已发布的 `workbench.theme-scenes` 贡献，当前值不在列表里时保留并标“未发布”）与“预览状态”（空闲 / 工作中，只影响预览，不写声明）；新增“图标”分区（当前明暗下的图标覆盖：加、换、移除，另有“复制到另一套明暗”）。
6. **包文件数上限 64 → 300**。图标最多 64 个 × 两套明暗 128 个，加场景图与清单，原上限导出后自己导不回去。其余上限（20 MiB、48 MiB）不变。

依据：[`theme/editor.md`](../../../../../docs/specs/theme/editor.md)、[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 的边界与兼容、[t06 计划](../t06-skin-extensions/plan.md)与它的[设计审查](../t06-skin-extensions/evidences/design-review.txt)（第 1、10 条是用户层降级的来源）。

约束：声明形状不变（字段已有），只收紧“我的主题”的取值；不改插件主题的校验；`user-themes` 记录的版本不变（旧记录里没有这两个字段）。

## 关键设计

### 一、共享：用户层素材的命名与校验（`workbench/shared/user-themes.ts`）

- `THEME_ASSET_NAME`（位图）不变；新增 `THEME_ICON_NAME = /^[0-9a-f]{64}\.svg$/u`。
- `userThemeProblem`：`scene`、`workingScene` 必须匹配 `THEME_ASSET_NAME`；`icons` 的值必须匹配 `THEME_ICON_NAME`；去掉对 `icons`、`workingScene` 的拒绝；`forUserLayer` 删除。`sceneProvider` 仍只是贡献 id。
- 一套声明的 `icons` 最多 `MAX_ICONS`（64）个已在 `lookProblem` 里。每个图标条目约 90 字节，两套明暗满额约 12 KB，`user-themes` 记录 512 KiB 仍够放二三十套满额的主题；超限由现有的“写入失败撤回”处理，不新增机制。

### 二、`nbook.files`：图标路由（`files/backend/theme-asset-route.ts`、新增 `files/backend/svg-icon.ts`、`files/shared/contracts.ts`）

- `svg-icon.ts` 导出 `checkSvgIcon(bytes): {ok: true} | {ok: false, detail: string}`：纯函数，实现上面第 4 条。以 `TextDecoder("utf-8", {fatal: true})` 解码，失败即拒绝。
- 路由 `PUT /theme-icons`：请求体上限 `THEME_ICON_MAX_BYTES`（16 KiB，接收时限长，不看请求头）；不过 `checkSvgIcon` 返回 415 `unsupported-type`（detail 说明哪里不合格）；超限 413 `too-large`；文件名 `<sha256>.svg`；其余（`theme-assets` 必须是真实目录、同名同字节返回同一地址、同名异字节 409、写入归属、Host/Origin 检查）与场景路由相同。
- 实现上把“定址、检查目标目录、已存在判断、写入”从现有路由里提成一个内部函数，两条路由只差“怎么判定类型与扩展名”和体积上限，避免两份近似逻辑。
- `contracts.ts` 加 `THEME_ICON_UPLOAD_URL`、`THEME_ICON_MAX_BYTES`。`/api/nbook.files/raw/user/theme-assets/<hash>.svg` 由已有的 raw 路由按 `image/svg+xml` 读，不改。

### 三、编辑器模型（`workbench/web/components/theme-editor/theme-editor-model.ts`）

沿用现有的 `#update`（目标主题与明暗在发起时定下，过 `userThemeProblem`，失败撤回）。新增：

- `setWorkingScene(name | undefined, target?)`：与 `setScene` 同形，写 `look.workingScene`。
- `setIcon(iconName, assetName, target?)`、`removeIcon(iconName)`：改 `look.icons`；去空后删字段。`iconName` 不匹配图标名规则时不写，原因进 `rejected`（走 `userThemeProblem` 即可，`lookProblem` 已校验图标名）。
- `copyIconsToOther()`：把当前明暗的 `icons` 整份复制到另一套明暗（覆盖）。
- `setSceneProvider(id | undefined)`：写声明顶层 `sceneProvider`；`undefined` 去掉。
- 复制与导入：`#copied` 不再调 `forUserLayer`；插件主题的 `workingScene` 与 `icons` 由传输层先复制成我的素材，再作为参数交给 `create`（见下），与 `scenes` 同样“素材全部成功才建副本”。`create(from, fromTitle, assets?)` 的 `assets` 扩成 `{scenes, workingScenes, icons}`（各按明暗），替换现在的 `scenes` 参数。

### 四、预览状态（`workbench/web/themes.ts`、`workbench/web/plugin.ts`、`editor-state.ts`）

- `ThemePreview` 加 `working?: boolean`；`plugin.ts` 里 `resolveTheme` 用 `themes.preview?.working ?? agentWorking()`。编辑器开着并选了“工作中”时，预览用工作态场景与提供者的工作态结果；“空闲”同理强制空闲；不选（缺省）跟随真实状态。关掉编辑器清掉预览，回到真实状态。
- `ThemeEditorState` 加 `previewWorking: ShallowRef<boolean | null>`（`null` 跟随），模型的 `watchEffect` 把它写进 `setPreview`。随编辑会话保留，同 `appearance`。
- `ThemeCatalog` 暴露已发布的场景提供者列表 `sceneProviders: ReadonlyArray<{id, title}>`（从 `SceneProviders` 的 `#handles` 取，响应式），编辑器下拉读它。

### 五、传输层（`transfer.ts`、`package-io.ts`、`scene-upload.ts`）

- `scene-upload.ts` 加 `uploadIcon(blob)`：只检查体积（≤ 16 KiB，超限直接给原因，不发请求），`PUT` 图标路由，返回结果同 `uploadScene`。图标不缩放、不转码（SVG 原样上传）。
- `ThemeTransfer.copyScenes` 改名 `copyAssets(entry)`：读取插件主题的 `scene`、`workingScene`、`icons` 全部文件（按插件文件端点），位图走 `uploadScene`，SVG 走 `uploadIcon`；任何一个读不到或传不上整体失败。最多 4 张图加 128 个图标，并发上限 6，避免一次发出上百个请求。
- 导出（`exportPackage`）：`scene`、`workingScene`、`icons` 的素材都读出来放进 `assets/<素材文件名>`，声明里改写成包内路径；同一文件被多处引用只存一份（路径相同）。
- 导入（`readPackage`）：去掉 `forUserLayer`；`workingScene` 与位图一样检查 `sniffImageType`，`icons` 的文件检查是 `.svg` 且 ≤ 16 KiB（完整白名单检查在服务端路由，浏览器只做便宜的检查）；`ImportedTheme.assets` 里放全部素材。`importArchive` 对每个素材按种类上传，再把声明里的路径换成素材文件名；任何一个失败整体失败，沿用“素材传完才写主题”。
- `PACKAGE_LIMITS.files` 改为 300。

### 六、编辑器界面（`workbench/web/components/theme-editor/`）

- `ThemeEditorScene.vue`（同名 .md 先改）：现有“场景图”块下面加三块：“工作态场景”（上传、更换、移除，缩略图；提示“使用同一份取景”）、“场景提供者”（`Select`）、“预览状态”（`SegmentedControl`：跟随 / 空闲 / 工作中）。上传逻辑复用，抽出的是“选文件、处理、上传、写声明”的一小段（现在写死在 `onFile`）：参数是写声明的动作，避免三份近似代码。
- 新增 `ThemeEditorIcons.vue`（与 .md）：当前明暗的图标列表，每行：用该图标的 `mask` 画的预览（沿用 `userThemeSceneUrl` 的地址换成通用的 `userThemeAssetUrl`）、图标名、更换、移除；底部“添加”：图标名输入（`DraftInput`，提示“lucide 图标名，例如 folder-open”）加“选择 SVG…”；顶部“复制到另一套明暗”。没有图标时一句引导。
- `ThemeEditor.vue`：`SECTIONS` 加 `icons`（放在 `scene` 后），导航与 `EditorSection` 类型同步；`createFrom` 的“复制素材”判断扩到 `workingScene` 与 `icons`。
- `ThemeEditorHolder.vue`：`copyAssets` 的实现。
- 文案：`workbench/web/text` 两种语言各加一组 `themeEditor.icons.*`、`themeEditor.scene.working*`、`themeEditor.scene.provider*`；窄屏（390px）下图标行不横向溢出。
- Lab：现有主题编辑器场景（`ThemeEditorHolder` 的空传输）补图标与工作态场景的夹具；跑 `lab:shot`。

## Spec 与文档改动（主工作区 master，设计审查后、开工前提交）

- `docs/specs/theme/editor.md`：目标与不承诺里去掉“图标集、按状态换场景、由代码提供的场景”；术语“场景素材”扩成“素材”；输入与前置条件加图标上传；输出 5 的分区加“图标”，输出 11 加工作态场景，新增输出 19 到 21（工作态场景与预览状态、场景提供者、图标）；“写场景素材”后加“写图标素材”一节；失败表加“图标不合格”；边界与兼容删掉“例外是……”那段，改为用户层持有这两项；验收加三条，改 12；导入的包文件数上限 300。
- `docs/specs/theme/skins.md`：边界与兼容、输入里“我的主题不持有”改为“我的主题的素材写素材文件名”；输出 16、17 里关于“我的主题”的限定同步。
- `docs/specs/theme/system.md`：只在引用到“用户层不持有”处同步。
- `docs/specs/files/`（`nbook.files` 的路由登记所在 Spec，实施时搜 `theme-assets` 定位）：登记 `PUT /theme-icons`。
- 组件同名 `.md`：`ThemeEditorScene.md`、新增 `ThemeEditorIcons.md`、`ThemeEditor.md`、`ThemeEditorHolder.md`。

## 切片

1. **共享与服务端**（一、二）：`user-themes.ts`、`svg-icon.ts`、路由、contracts；测试 `user-themes.test.ts`、`svg-icon.test.ts`、`theme-asset-route.test.ts`（含图标路由）。验证：`bun run test:affected`（files、workbench 范围）、`typecheck`。
2. **模型、预览状态与传输层**（三、四、五）：模型、`ThemePreview.working`、`sceneProviders`、`package-io.ts`、`transfer.ts`；测试 `theme-editor.test.ts`、`package-io.test.ts`、`themes.test.ts`、`WorkbenchDocument.dom.test.ts` 或等价。
3. **界面**（六）：两个分区、文案、Lab 夹具；vitest 组件测试（若已有同类）与 `lab:shot`。
4. **e2e 与收口**：`theme-editor.e2e.ts` 加用例；提供者下拉用例放 `plugin-code.e2e.ts`（那里已装 `scene-clock`）；`governance:check`、`docs:check`、typecheck。

## 验收映射

编号待 Spec 改完后补，对应如下：

| 判据 | 覆盖 |
|---|---|
| 上传 SVG 图标，活动栏等处该图标随即换成它（亮暗各一份）；移除后恢复 | `theme-editor.e2e.ts`（读目标元素的 `mask-image` 计算值）、`theme-editor.test.ts`（声明写入） |
| 图标路由：合格 SVG 返回 `<sha256>.svg`；含脚本、`href`、`style`、`url(`、实体、超 16 KiB、非 SVG 的都拒绝；场景路由仍拒绝 SVG | `svg-icon.test.ts`、`theme-asset-route.test.ts` |
| 工作态场景上传后，预览状态选“工作中”时场景换成它，“空闲”时回原图；真实 Agent 状态不受预览影响 | `theme-editor.e2e.ts`、`themes.test.ts` |
| 场景提供者下拉只列已发布的；选中后预览用提供者的图；当前值未发布时保留并标注 | `plugin-code.e2e.ts`、`theme-editor.test.ts` |
| 复制插件主题（书房）：场景、工作态场景、图标全部成为我的素材；任何一个失败整体失败，不留半个副本 | `theme-editor.test.ts`（传输替身与真实路由各一）、`theme-editor.e2e.ts` |
| 导出再导入：图标与工作态场景往返不丢；包文件数 300 以内；超限、缺文件、图标不是 SVG 时整体拒绝 | `package-io.test.ts` |
| `userThemeProblem`：`icons` 值、`workingScene` 不是素材文件名时拒绝；旧记录（无这两个字段）照常 | `user-themes.test.ts` |
| 窄屏 390px 图标分区不溢出 | `lab:shot` 加 e2e 的 `scrollWidth` 检查 |

## 验证

- `bun run test:affected`；typecheck；`governance:check`、`docs:check`；Lab `lab:shot`。
- e2e：`theme-editor.e2e.ts`、`plugin-code.e2e.ts` 先 `bun run build` 和 `bun run build:e2e`；跑前停掉多余服务。
- 不能验证的边界：真实图片模型、真实 Agent 运行时的“工作中”（e2e 用预览状态覆盖，真实状态的链路已由 t06 的用例覆盖）；SVG 白名单是否收得住所有变形写法只能靠测试里的反例集，不是形式化证明（兜底是 mask 的静态模式与 raw 路由的沙箱）。

## 不做与风险

- 不做图标的内联编辑器（画图），只上传文件。
- 不清理没人引用的素材（沿用输出 11 的“素材不整理”）。
- 不做图标名的自动补全列表：lucide 全集有一千多个，写死进编辑器会随 lucide 版本过期；提示里给名字的写法。
- 风险：图标 SVG 白名单拒绝某些合法图标（例如用了 `<defs>`、渐变的）。这是有意取舍：产品图标是单色蒙版，用不到；真遇到再加元素。
- 风险：复制书房一次上传十来个文件，网络差时较慢；整体失败不留半个副本，用户重试即可。
