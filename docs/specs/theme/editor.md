---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: theme.editor
owners:
  - nbook.workbench
  - nbook.files
---

# 主题编辑器

## 目标与非目标

**目标**：写作者在界面里做出一套[主题](skins.md)：配色、字体、活动栏、浮层画框、场景图和它在各位置的取景，改的时候真实工作台立刻变化；做好的主题进“我的主题”，也能导出成别人可安装的主题插件，或把插件里的主题导入来改。声明能写的东西，编辑器都能编；绝大部分声明式主题可以用它做出来。

**不承诺**：

- 编辑器不是主题的唯一来源：插件提供的主题照旧，编辑器不改它们，只能复制一份到“我的主题”再改。
- 声明里还没有的能力（图标集、按状态换场景、由代码提供的场景）：声明加了字段之后编辑器再跟上。
- 手写声明里编辑器读不懂的取景写法：对应位置的取景框不可拖，数值照旧能改（见输出 13）。
- 选本机已装的字体：浏览器列不出来，字体用常用字体栈下拉加自己填。
- 第三方主题的对比度：编辑器只提醒，不阻止保存与导出，与 [`theme.skins`](skins.md) 一致。
- 多人协作与云端同步：“我的主题”只在本机用户层。
- 运行期热插拔：导出的插件被安装后，仍要重启才生效（[`runtime.plugin-install`](../runtime/plugin-install.md)）。

## 术语与参与者

- **我的主题**：存在用户层的主题声明，和插件提供的主题出现在同一个主题列表里，id 为 `user:<uuid>`。声明的形状和校验与插件主题同一份（[`theme.skins`](skins.md)）。
- **编辑器**：工作台里的一个视图，有两种放法：编辑区的页签，或浮动窗口。主体是同一个组件。
- **编辑中的主题**：编辑器正在改的那一套。编辑器开着时，工作台用它来画，不管设置里选的是哪一套；关掉编辑器就回到设置里选的。
- **取景框**：场景图在某个位置上取的那一块，对应声明里的 `crop`；五个位置：空状态、正文左、正文右、侧栏下角、右栏下角。
- **主色**：背景、文字、强调三个颜色，用来推导整套配色。
- **场景素材**：上传的图片，存在 `user://theme-assets/`，文件名是内容的 SHA-256。
- 参与者：`nbook.workbench`（我的主题库、编辑器、主题列表）、`nbook.files`（写素材的路由与读取）。

## 输入与前置条件

- 我的主题存在 Storage 的用户记录 `user-themes`（scope `user`、locality `shared`、上限 512 KiB，[`storage.persistence`](../storage/persistence.md)）：值是 `{themes: [{id, declaration}]}`，`declaration` 是 `ThemeDeclaration`，其中 `scene` 写素材文件名。读取时逐条用 [`theme.skins`](skins.md) 的同一份校验检查，不合格的那一条不进主题列表并记诊断，别的照常。
- 编辑器改动自动写入，没有“保存”按钮；同一套主题在两个窗口里同时改时，各自的修改按字段合并，同一字段后写的为准；两边写完后显示的都是记录里确认的那一份。
- 上传场景图：浏览器先把图片缩到最长边 2560px 以内并转成 WebP，再经 `PUT /api/nbook.files/theme-assets` 写入（见下）；原图不留。单张建议 300 KB 以内，编辑器在超出时提示，不拒绝。
- 导入：只收本编辑器导出的那种插件包（zip），或不写代码的主题插件目录打成的 zip；`package.json` 走插件清单的同一份校验，主题 id 要以插件 id 开头、不能重复，有运行入口的包不收。zip 最大 20 MiB，文件数不超过 64 个，解压后单个文件不超过 20 MiB、总量不超过 48 MiB（按实际解出的字节数记账，不信 zip 目录里写的大小，超限立即停止解压），路径是不含空段、`.`、`..`、反斜杠与冒号的相对路径。

## 输出与可观察行为

1. **入口**：命令 `nbook.settings.open-theme-editor` 在编辑区打开页签，`nbook.settings.open-theme-editor-floating` 在浮动窗口打开；标题栏“视图”菜单的“外观”一节里有这两条。设置窗口的“主题”项旁没有“编辑…”按钮：设置行还不能放操作按钮。页签与浮动窗口放的是同一个主体、共用一份模型，所以同时开着也只有一份预览；再开页签是聚焦已有的那个。
2. **我的主题库**：编辑器顶部选“我的主题”里的一套来编；可以新建（从 NeuroBook 缺省起步）、从任一主题复制起步（顶栏“复制自…”，库里已有主题时也在）、复制当前、重命名、删除。复制插件主题时，场景图先读出来、传成我的素材，全部成功才建副本；复制我的主题时素材共用（文件名是内容摘要）。删除我的主题时，设置里选着它的，按 [`theme.skins`](skins.md) 的“不是已接受的主题”退回，设置不改写。
3. **主题列表**：设置窗口的“主题”项与命令 `nbook.settings.switch-theme` 列出我的主题，标题后标明“我的”；选中后生效，和插件主题一样。
4. **实时预览**：编辑器开着时，每一次改动立刻写到文档根，两侧真实的活动栏、侧栏、右栏、菜单与浮层随之变化；没有另一个“预览界面”。预览取顶部选中的明暗，与系统或设置里的明暗无关。关掉编辑器，文档根回到设置里选的主题与明暗。
5. **分区**：左边竖向导航，右边一次一个分区：基本信息、配色、字体、活动栏与画框、场景与取景、对比度检查。
6. **基本信息**：标题（中文与英文）、主题包（NeuroBook 或 macos）；标题不能为空。
7. **配色**：顶部切亮暗，一次编一套。可以“从另一套派生”：由亮色派生暗色或反过来。“主色”三项（背景、文字、强调）加“推导整套”：为 33 个配色变量算出值；推导只填没改过的项，手改过的项保持不变，改过的项带标记，可以单项还原成推导值。推导出的主文字、次要文字与链接对背景不低于 4.5。33 个变量按用途分组，每项一个取色器，也可直接写色值。
8. **角色变量**：折叠在“高级”里，10 个角色变量（[`theme.skins`](skins.md) 的白名单）；取值是颜色或渐变，不能引外部资源。
9. **字体**：欢迎页标题与正文各一个，常用字体栈下拉或自己填；不填就是现有字体。
10. **活动栏与画框**：活动栏的面、前景、当前项与两端装饰色，画框的线色；活动栏的面可以是纯色或渐变。
11. **场景图**：亮、暗各一张，上传、更换、移除；更换或移除只改声明，素材文件不删：文件名是内容摘要，留着不会重复，占用很小；清理没人引用的素材需要文件服务的删除，留给以后。
12. **取景**：五个取景框叠在当前这张原图上，选中的实线，其余淡显；右边列表选框，也可直接改数值（`size`、`position`；空状态是位置与内容中心）。拖框、缩放框和改数值互相同步，工作台里对应位置同时变化。
13. **读不懂的取景**：取景数值不是编辑器自己写出的那几种形式时（手写的声明，或导入的插件），该位置的取景框显示为不可拖，数值输入框照常改；一旦在输入框里改，就按编辑器的形式重新写。
14. **对比度**：配色分区里，每个文字类颜色项旁实时显示它对相应背景的对比度，低于 4.5 标出；“对比度检查”分区汇总全部不合格项，写明是哪一对。导出时有不合格项只提示，不阻止。
15. **导出**：导出成一个 zip：`package.json`（发布者 `local`，名字取标题的拼写，版本 `0.1.0`，声明 `workbench.themes` 贡献，贡献 id 按插件前缀写）与 `assets/` 下的场景图；和不写代码的主题插件（`plugin-sdk/examples/external/theme-dusk`）同一格式，可以用“插件”页的“安装…”装上。
16. **导入**：选一个 zip，包里的主题全部复制成新的“我的主题”（一个提交点：要么都进要么都不进）；素材先经上传路由写完，再写主题；校验不过或写失败的给出原因，不导入任何东西。导入不改原插件。
17. **素材读取**：我的主题的场景图经已有的 `/api/nbook.files/raw/user/theme-assets/…` 显示，沿用它的 `nosniff`、沙箱和跨站拒绝；图片加载失败时那一位置没有图，配色照旧（[`theme.skins`](skins.md)）。
18. **无障碍与窄屏**：编辑面板始终用实心面，不受正在编辑的主题的半透明影响；浮动窗口与页签里键盘可以走完所有项；390px 宽时左边导航收成顶部的标签条。

### 写场景素材（`nbook.files`）

`PUT /api/nbook.files/theme-assets`：请求体是原始字节，响应 `{address}`。

- 上限 20 MiB（20,971,520 字节），接收时就限长，不看请求头；超限 413 `too-large`。
- 只收 PNG、JPEG、WebP，按字节判定，不信文件名与 `Content-Type`；其它（含 SVG）415 `unsupported-type`。
- 文件名由服务端算：`<SHA-256>.<png|jpg|webp>`，放在 `user://theme-assets/`。经与其它写入相同的暂存与提交，写入归属是 `{kind: "system", plugin: "nbook.files"}`。
- `theme-assets` 必须是真实目录，是符号链接时 409 `invalid-target`，不写。
- 已存在且字节相同：返回同一地址，不发变更、不记账。已存在但字节不同或不是普通文件：409 `conflict`，不覆盖。
- 经统一的 Host、Origin 检查（[`runtime.server-host`](../runtime/server-host.md)）。

## 状态与转换

- 编辑器的状态：未打开、打开（页签或浮动）。打开时记“编辑中的主题”、顶部的明暗与当前分区；初始的明暗取打开时正在用的明暗。编辑区只挂载当前页签：切去看别的文件时预览暂停（文档根回到设置里选的主题），切回来时编辑状态保留、预览恢复；关闭编辑器（关页签、关浮动窗口、入口停止）才清掉。
- 编辑中的主题由“我的主题”库算出，不另存草稿：每次改动写进 `user-themes` 记录，工作台从那里读，所以改完马上和别的窗口一致。
- 推导标记（哪些项是手改过的）存在声明之外的编辑器自己的数据里：记录里的条目可以带 `editor: {touched: [...]}`，声明与导出的插件里没有它。

## 副作用与数据

- 写 Storage 用户记录 `user-themes` 与 `user://theme-assets/`；不写作品文件，不写项目层。
- 素材不整理：被替换或移除后没人引用的素材留在 `user://theme-assets/`（见输出 11）。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| `user-themes` 里某条不合格 | 那一条不进主题列表，记一条诊断，别的照常；编辑器里不显示它，记录不改写，改别的主题时它原样留在记录里（记录只验容器形状，条目逐条验） |
| 上传失败（超限、类型不对、符号链接、冲突） | 显示原因，那一位置保持原来的图 |
| 图片加载失败 | 那一位置没有图，配色照旧；编辑器里显示原因 |
| 导入的 zip 不合格（路径越界、文件数超限、清单不对、声明校验不过） | 显示原因，不导入任何东西 |
| 写 `user-themes` 失败（超限、值不合法、读写出错） | 这次改动（含排在它后面的）撤回，显示原因，工作台保持写入前的主题，之后的修改照常保存，不被失败的那次堵住 |
| 修改的取值写不进去（引外部资源、标题两种语言都空） | 不写，行内显示原因，工作台不受影响 |

## 边界与兼容

- 公开接口：Storage 记录 `user-themes`、两个命令、`PUT /api/nbook.files/theme-assets`。
- 信任边界：我的主题的声明与插件主题同一份校验，所以不能引外部资源；导入的 zip 当不可信输入，逐项校验，不执行其中任何文件。
- 声明加了字段（例如图标集）后，编辑器要补对应的编辑项；在补上之前，记录里已有这些字段的主题照常生效，编辑器保存时保留它们不丢。

## 验收与 Smoke

1. Given 空的我的主题库；When 新建；Then 列表里有一套“我的”主题，设置里能选。
2. Given 编辑器打开、改一个配色；Then 真实工作台立刻变；关掉编辑器后回到设置里选的主题。
3. Given 编辑暗色而系统是亮色；Then 预览是暗色，关掉后回到系统的明暗。
4. Given 三个主色；When 推导整套；Then 33 项都有值，主文字、次要文字、链接对背景不低于 4.5；手改过的项再推导时不变。
5. Given 一个文字类颜色低于 4.5；Then 该项与“对比度检查”分区都标出；导出时提示但能导出。
6. Given 上传一张 PNG；Then 浏览器转成 WebP 后写入，主题的场景显示；上传 SVG、超限与符号链接目录按路由的失败码拒绝。
7. Given 五个取景框；When 拖其中一个；Then 对应数值与工作台里的位置同步变化；When 改数值；Then 框跟着动。
8. Given 手写的、编辑器读不懂的取景值；Then 该位置的框不可拖，数值能改，改后按编辑器的形式重写。
9. Given 一套我的主题；When 导出；Then 得到的 zip 能被“插件”页安装、重启后在列表里出现；When 导入这个 zip；Then 复制成一套我的主题，素材一并写入。
10. Given 路径越界、文件过多或声明不合格的 zip；When 导入；Then 显示原因，什么都不写。
11. Given 删除正在使用的我的主题；Then 设置不改写，主题退回缺省（[`theme.skins`](skins.md) 验收 8）。
12. Given 复制插件主题；Then 声明与素材复制成我的主题，原插件不变。
13. Given 编辑面板所在的主题是半透明或高对比度；Then 编辑面板仍是实心面，文字对比度不低于 4.5。
14. Given 390px 宽；Then 导航收成顶部标签，不横向溢出。

Smoke：`e2e/theme-editor.e2e.ts`。

## 实现合同

- 公开入口：命令 `nbook.settings.open-theme-editor`、`nbook.settings.open-theme-editor-floating`；Storage 用户记录 `user-themes`（`workbench/shared/user-themes.ts`）；`PUT /api/nbook.files/theme-assets`。
- owner 与依赖方向：我的主题库、目录、预览覆盖、编辑器归 `nbook.workbench`（编辑区页面经 `editor.pages` 贡献，浮动窗口经 `workbench.overlays` 贡献）；写素材归 `nbook.files`。颜色计算与对比度在 `ui/theme/`（纯函数）。
- 不变量：声明的校验插件主题与我的主题是同一份（`declarationProblem`）；编辑器自己不存声明副本，改动只经 store 的乐观显示回到预览；预览只覆盖文档根，不改设置。
- 不变量：主题包的缺省配色来自装载整套主题包的模块，不进首屏，只在编辑器组件加载时交进来。
- 不变量：取景只读写编辑器自己写出的形式（`crop-model.ts`），读不懂的返回 null；框的位置与大小用参照盒换算，是示意。
- 不变量：导入先量完大小、数量与路径，全部合格才解压；素材先传完再写主题。
- 导出导入的格式与不写代码的主题插件相同，所以编辑器导出的包可以直接用“插件”页安装。

## 证据

- 批准依据：开发者 2026-11-06 的决定，记在主工作区 master 的 `.agents/works/w00041-themes-and-backgrounds/tasks/t08-theme-editor/README.md`（决定 1 到 10）。
- 实现入口：[`workbench/web/components/theme-editor/`](../../../packages/neuro-book/src/plugins/workbench/web/components/theme-editor/ThemeEditor.vue)、[`workbench/shared/user-themes.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/user-themes.ts)、[`ui/theme/derive-palette.ts`](../../../packages/neuro-book/src/ui/theme/derive-palette.ts)、[`files/backend/theme-asset-route.ts`](../../../packages/neuro-book/src/plugins/files/backend/theme-asset-route.ts)
- Smoke：[`theme-editor.e2e.ts`](../../../packages/neuro-book/e2e/theme-editor.e2e.ts)
- 合同测试：[`theme-editor.test.ts`](../../../packages/neuro-book/src/plugins/workbench/theme-editor.test.ts)、[`user-themes.test.ts`](../../../packages/neuro-book/src/plugins/workbench/user-themes.test.ts)、[`crop-model.test.ts`](../../../packages/neuro-book/src/plugins/workbench/crop-model.test.ts)、[`package-io.test.ts`](../../../packages/neuro-book/src/plugins/workbench/package-io.test.ts)、[`derive-palette.test.ts`](../../../packages/neuro-book/src/ui/theme/derive-palette.test.ts)、[`theme-asset-route.test.ts`](../../../packages/neuro-book/src/plugins/files/theme-asset-route.test.ts)
