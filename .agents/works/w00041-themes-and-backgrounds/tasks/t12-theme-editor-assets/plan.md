# t12 计划：主题编辑器补图标集、工作态场景与场景提供者

## Context

t06 给声明加了三个字段（[`theme.skins`](../../../../../docs/specs/theme/skins.md) 输出 16 到 18）：`Look.icons`、`Look.workingScene`、`ThemeDeclaration.sceneProvider`。编辑器（[`theme.editor`](../../../../../docs/specs/theme/editor.md)）还没有对应的编辑项，“我的主题”也因为没有素材管线而不收前两个（`userThemeProblem` 拒绝、复制与导入时 `forUserLayer` 丢弃）。开发者 2026-11-06 用 `/autonomous-delivery` 要求补齐这三项，含用户层素材管线（SVG 与第二张场景图）的取舍。

决定（照推荐做，事后追认，记进 [pending-confirmations.md](../../pending-confirmations.md)）：

1. **做素材管线，不再降级**。“我的主题”持有 `icons` 与 `workingScene`；`forUserLayer` 删除。理由：编辑器的目标是“声明能写的东西，编辑器都能编”；降级只是 t06 缺素材管线时的权宜，而且复制书房、导入主题包会丢东西，用户看不出来。
2. **工作态场景的素材就是场景图**：同一条上传路由、同样的命名（`<sha256>.<png|jpg|webp>`），声明里 `workingScene` 写素材文件名，同一份 `crop`。
3. **图标素材是新的一类：`<sha256>.svg`，走新路由 `PUT /api/nbook.files/theme-icons`**，放在同一个 `user://theme-assets/` 目录。场景路由继续拒绝 SVG（Spec 写明的 415 不变）；图标路由只收通过白名单检查的 SVG。理由：两类素材的安全检查不同，混在一条路由里“看内容猜类型”会让场景路由的“只收位图”失去保证。
4. **SVG 检查是一个严格的词法状态机**（服务端、无 DOM、不用正则跳过任何一段）：整个输入必须被逐个 token 消费，遇到不认识的一律拒绝。允许的 token 只有：开头至多一条 `<?xml version="1.0" encoding="UTF-8"?>`（可省）、开始标签、结束标签、自闭合标签、元素之间的空白、`title`/`desc` 里的纯文本。元素名与属性名区分大小写，元素只收 `svg g path circle ellipse line polyline polygon rect title desc`，属性只收一份固定的几何与表现属性（`d cx cy r rx ry x y x1 x2 y1 y2 width height points transform fill stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity fill-opacity stroke-opacity viewBox`），根上另收 `xmlns`（值只能是 `http://www.w3.org/2000/svg`）与 `version`；属性值只收双引号、不含 `&`、`<`、`url(`（忽略大小写）、`javascript:`；同一元素重复属性、带命名空间前缀的名字、注释、CDATA、DOCTYPE、实体、其它处理指令、BOM、嵌套的 `<svg>`、至多 16 KiB 之外的输入全部拒绝。UTF-8 解码用 `fatal`。这是服务端的主防线：通过检查的字节里**构造上**不可能有脚本、引用或样式。第二层是消费方式：CSS `mask-image` 按“SVG 作为图片”的静态模式处理（t06 e2e 已用探针核实）；直接访问 raw 地址时有 `nosniff` 与 `sandbox`（只限制脚本与源，不限制资源加载，所以不能把它当作网络沙箱，设计审查第 1 条）。lucide 的 1805 个图标用到的元素都在上面（设计审查实测）。
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

- `svg-icon.ts` 导出 `checkSvgIcon(bytes): {ok: true} | {ok: false, detail: string}`：纯函数，实现上面第 4 条的状态机。合同测试把每条拒绝规则列成一个用例（注释、CDATA、`xlink:href`、`HREF` 大小写、嵌套 `<svg>`、`<style>`、`<animate>`、`<use>`、`<foreignObject>`、BOM、实体、重复属性、未闭合标签、结尾多余内容、16 KiB 边界），再加正例：书房的 10 个图标与从 `@iconify-json/lucide` 生成的全部图标都通过。
- 路由 `PUT /theme-icons`：请求体上限 `THEME_ICON_MAX_BYTES`（16 KiB，接收时限长，不看请求头）；不过 `checkSvgIcon` 返回 415 `unsupported-type`（detail 说明哪里不合格）；超限 413 `too-large`；文件名 `<sha256>.svg`；其余（`theme-assets` 必须是真实目录、同名同字节返回同一地址、同名异字节 409、写入归属、Host/Origin 检查）与场景路由相同。
- 共用函数不改变场景路由的检查顺序、失败码、同名同字节幂等与同名异字节 409。实现上把“定址、检查目标目录、已存在判断、写入”从现有路由里提成一个内部函数，两条路由只差“怎么判定类型与扩展名”和体积上限，避免两份近似逻辑。
- `contracts.ts` 加 `THEME_ICON_UPLOAD_URL`、`THEME_ICON_MAX_BYTES`。`/api/nbook.files/raw/user/theme-assets/<hash>.svg` 由已有的 raw 路由按 `image/svg+xml` 读，不改。

### 三、编辑器模型（`workbench/web/components/theme-editor/theme-editor-model.ts`）

沿用现有的 `#update`（目标主题与明暗在发起时定下，过 `userThemeProblem`，失败撤回）。新增：

- `setWorkingScene(name | undefined, target?)`：与 `setScene` 同形，写 `look.workingScene`。
- `setIcon(iconName, assetName, target?)`、`removeIcon(iconName, target?)`：改 `look.icons`；去空后删字段。`target` 是 `{id, appearance}`，界面在“选文件”时连同规范化后的图标名一并冻结，上传完成后按冻结的目标写（同 `setScene`；两次上传同一个名字时后完成的覆盖，不另做版本比较）。规范化只做 trim；空名在界面提示，不匹配图标名规则（含大写）的名字走 `userThemeProblem` 拒绝，原因进 `rejected`。**对已有的名字“添加”就是替换**，界面在该名字已存在时把按钮写成“更换”。保存一个产品里没有用到的名字不报错，也看不到效果（界面在输入框下写明“保存不等于产品里有这个图标”）。
- `copyIconsToOther()`：把当前明暗的 `icons` 整份复制到另一套明暗（覆盖）。
- `setSceneProvider(id | undefined)`：写声明顶层 `sceneProvider`；`undefined` 去掉。
- 复制与导入：`#copied` 不再调 `forUserLayer`；插件主题的 `workingScene` 与 `icons` 由传输层先复制成我的素材，再作为参数交给 `create`（见下），与 `scenes` 同样“素材全部成功才建副本”。`create(from, fromTitle, assets?)` 的 `assets` 扩成 `{scenes, workingScenes, icons}`（各按明暗），替换现在的 `scenes` 参数。

### 四、预览状态（`workbench/web/themes.ts`、`workbench/web/plugin.ts`、`editor-state.ts`）

- `ThemePreview` 加 `working?: boolean`；`plugin.ts` 里 `resolveTheme` 用 `themes.preview?.working ?? agentWorking()`。编辑器开着并选了“工作中”时，预览用工作态场景与提供者的工作态结果；“空闲”同理强制空闲；不选（缺省）跟随真实状态。关掉编辑器清掉预览，回到真实状态。
- 模型的 `watchEffect` 把 `previewWorking` 写进 `setPreview`；`dispose` 清预览，也就回到跟随真实状态。
- `ThemeCatalog` 暴露已发布的场景提供者 id 列表 `sceneProviders: ReadonlyArray<string>`（响应式、只读快照），编辑器下拉读它。`SceneProviders` 的可用性统一定义为“句柄在表里且 `handle.published === true`”：`sceneFor` 与列表都用它，停止窗口内（`published` 已失去、`revoke` 未到）不再列出也不再调用实现（设计审查第 12 条，t06 遗留的不严格处一并改）。提供者声明现在是空对象（没有 `title`），本 Task 不改这个公开合同，下拉里只显示贡献 id（设计审查第 4 条；要显示名称另开 Task 给声明加可选 `title`）。
- `previewWorking` 不放进 `ThemeEditorState`：它是模型自己的 `ShallowRef<boolean | null>`（`null` 跟随），每次打开编辑器都是跟随。`state` 里的东西会在最后一个编辑器关闭后保留，强制状态潜伏到下次打开会让人忘了自己在预览“工作中”（设计审查第 7 条）。

### 五、传输层（`transfer.ts`、`package-io.ts`、`scene-upload.ts`）

- `scene-upload.ts` 加 `uploadIcon(blob)`：只检查体积（≤ 16 KiB，超限直接给原因，不发请求），`PUT` 图标路由，返回结果同 `uploadScene`。图标不缩放、不转码（SVG 原样上传）。
- `ThemeCatalog` 加 `assetUrl(entry, path)`（公开、窄接口，内部就是现有的 `#assetUrl(entry.plugin, path)`），`ThemeEditorSession` 转出同名方法；传输层不再自己拼插件文件地址（设计审查第 3 条）。现有 `sceneUrl(entry, appearance)` 保留给场景图预览。
- `ThemeTransfer.copyScenes` 改名 `copyAssets(entry)`：读取插件主题的 `scene`、`workingScene`、`icons` 全部文件，位图走 `uploadScene`，SVG 走 `uploadIcon`。同一路径只读传一次（两套明暗共用的图标按路径去重）；并发上限 6；第一个失败后不再开始新的请求，等已发出的全部 settled 再返回失败（不遗留在途请求，设计审查第 6 条）。**合同改写为：主题记录是原子的，素材写入不可回滚**——失败时已传上的素材留在 `user://theme-assets/` 成为孤儿（沿用“素材不整理”，文件名是内容摘要，重试不会重复），结果里的失败原因注明；最多 4 张位图加 128 个图标。导入同理。
- 导出（`exportPackage`）：`scene`、`workingScene`、`icons` 的素材都读出来放进 `assets/<素材文件名>`，声明里改写成包内路径；同一文件被多处引用只存一份（路径相同）。
- 导入（`readPackage`）：去掉 `forUserLayer`；`workingScene` 与位图一样检查 `sniffImageType`，`icons` 的文件检查是 `.svg` 且 ≤ 16 KiB（完整白名单检查在服务端路由，浏览器只做便宜的检查）；`ImportedTheme.assets` 里放全部素材。`importArchive` 对每个素材按种类上传（同一包内路径只传一次，几套主题共用同一路径同样），全部拿到文件名后才把声明里的路径换成文件名并调 `addMany`；任何一个失败不写主题，已传的素材留作孤儿。
- `PACKAGE_LIMITS.files` 改为 300。

### 六、编辑器界面（`workbench/web/components/theme-editor/`）

- `ThemeEditorScene.vue`（同名 .md 先改）：现有“场景图”块下面加三块：“工作态场景”（上传、更换、移除，缩略图；提示“使用同一份取景”）、“场景提供者”（`Select`）、“预览状态”（`SegmentedControl`：跟随 / 空闲 / 工作中）。上传逻辑复用，抽出的是“选文件、处理、上传、写声明”的一小段（现在写死在 `onFile`）：参数是写声明的动作，避免三份近似代码。
- “场景提供者”下拉的选项：已发布的 id 正常可选，另有“无”；当前值不在已发布列表里时临时追加一项 `{value: id, label: id, description: "未发布", disabled: true}`（`Select` 的受控值要在 options 里；禁用项保留显示但不可再选，设计审查第 5 条）；提供者发布后这一项变回普通项，撤回后又变回禁用项。
- 新增 `ThemeEditorIcons.vue`（与 .md）：当前明暗的图标列表，每行：用该图标的 `mask` 画的预览（沿用 `userThemeSceneUrl` 的地址换成通用的 `userThemeAssetUrl`）、图标名、更换、移除；“添加”行放在列表上方（列表至多 64 个，放底部要滚下去才找得到）：图标名输入（提示“lucide 图标名，例如 folder-open”）加“添加”按钮（已有名字时写“更换”，点它选 SVG 文件），另有“复制到另一套明暗”。（实现审查 F4：实现与原写法不一致，统一成这个。）没有图标时一句引导。
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
| 工作态场景上传后，预览状态选“工作中”时场景换成它，“空闲”时回原图；选“跟随”时随真实 Agent 状态变；编辑器关闭后回到真实状态、重开是跟随 | `themes.test.ts`（用可注入的响应式状态替身，断言 `resolveTheme` 的 effect 重跑与不重跑）、`WorkbenchDocument.dom.test.ts`、`theme-editor.e2e.ts`（只看稳定的 `--skin-scene` 与 `data-nb-skin-scene`） |
| 场景提供者下拉只列已发布的 id；选中后预览用提供者的图；当前值未发布时保留为禁用项并标“未发布”，发布后变回普通项 | `plugin-code.e2e.ts`、`theme-editor.test.ts` |
| 复制插件主题（书房）：场景、工作态场景、图标全部成为我的素材；任何一个失败整体失败，不留半个副本 | `theme-editor.test.ts`（传输替身与真实路由各一）、`theme-editor.e2e.ts` |
| 导出再导入：图标与工作态场景往返不丢；两套明暗共用同一 SVG、同一工作态位图时包内只有一份、两处声明指向同一路径；包文件数 300 以内；超限、缺文件、图标不是 SVG 时整体拒绝；`importArchive` 按种类调用两个上传端，全部返回文件名后才调 `addMany`，任何一个失败不调 | `package-io.test.ts`、`transfer` 的测试（用可记录的上传端替身，另用真实路由跑一次） |
| 图标上传的异步目标：上传期间切主题、切明暗、改名、连续两次上传，图标落在发起时的主题、明暗与名字下 | `theme-editor.test.ts` |
| 提供者可用性：停止窗口内（`published` 为假、`revoke` 未到）不列出、不调用实现 | `scene-providers.test.ts` |
| `userThemeProblem`：`icons` 值、`workingScene` 不是素材文件名时拒绝；旧记录（无这两个字段）照常 | `user-themes.test.ts` |
| 窄屏 390px 图标分区不溢出 | `lab:shot` 加 e2e 的 `scrollWidth` 检查 |

## 验证

- `bun run test:affected`；typecheck；`governance:check`、`docs:check`；Lab `lab:shot`。
- e2e：`theme-editor.e2e.ts`、`plugin-code.e2e.ts` 先 `bun run build` 和 `bun run build:e2e`；跑前停掉多余服务。
- 不能验证的边界：真实图片模型、真实 Agent 运行时的“工作中”（e2e 用预览状态覆盖，真实状态的链路已由 t06 的用例覆盖）；SVG 白名单是否收得住所有变形写法只能靠测试里的反例集，不是形式化证明（兜底是 mask 的静态模式与 raw 路由的沙箱）。

## 不做与风险

- 不做图标的内联编辑器（画图），只上传文件。
- 不清理没人引用的素材（沿用输出 11 的“素材不整理”）。
- 不做图标名的自动补全与“产品里哪些位置用到哪个图标”的目录（设计审查第 11 条，VS Code 产品图标主题有这样的目录）：lucide 全集有一千八百多个，手写会过期；要做就从产品源码里的 `i-lucide-*` 用法在构建时生成一份可版本化的目录，另开 Task。本 Task 的 UI 只提示“保存不等于产品里有这个图标”。
- 风险：图标 SVG 白名单拒绝某些合法图标（例如用了 `<defs>`、渐变的）。这是有意取舍：产品图标是单色蒙版，用不到；真遇到再加元素。
- 风险：复制书房一次上传十来个文件，网络差时较慢；整体失败不留半个副本，用户重试即可。
