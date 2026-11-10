# t05 实施计划：源码编辑器的右键菜单与语法配色（第二稿）

第二稿按[第一稿的设计审查](evidences/design-review-disposition.txt)重写（fable 子代理，17 条：阻断 2、重要 9、建议 6；审查者在真实 Chrome 里对 Monaco 0.55.1 做了实验）。第一稿对 Monaco 的几处假设不成立：`execCommand("cut")` 无效、`addCommand` 是全局的、自带菜单关掉后还留着会动光标的分支、基底主题的规则要逐条压。

## 1. Context

- **为什么做**：源码编辑器（Monaco）有两处和产品不一致。
  - 右键菜单是 Monaco 自己画的：样式与文字语言不归应用管（语言在加载时定死），插件加不了项，而且“粘贴”在独立版 0.55.1 里是坏的（缺内部服务，点了没反应）。
  - 语法着色用 Monaco 自带的 `vs`、`vs-dark`，不随产品主题变；护眼主题的底是绿或米黄，着色仍是为白底、黑底配的。
- **开发者已确认的决定**（2026-10-15，Task README）：右键菜单关掉 Monaco 自己的，换成应用的（nb-ui `ContextMenu`），菜单项来自 Monaco 的动作，给插件一个菜单位置；语法配色加进主题 token，用户覆盖以后再做。
- **期望结果**：右击源码看到的是与 Markdown 正文同一套外观的菜单，每一项执行的是 Monaco 自己的命令；语法颜色由主题 token 给出，换主题、换明暗、用护眼主题或“我的主题”都跟着变。
- **工作方式**：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`，排在 t04 之后；Spec 在主工作区 master 上改。审查派 fable 子代理（开发者 2026-11-10）。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 菜单项从哪来 | 一张自己维护的表，每一项执行 Monaco 的命令或动作（`editor.trigger`、`editor.getAction(id).run()`）。表是封闭的：以后语言贡献带来新动作（转到定义、重命名）要改表 | 读 Monaco 内部的 `MenuRegistry`：内部模块没有类型、随版本变，条件要用内部的 context key 服务求值 |
| 菜单外观 | nb-ui `ContextMenu`，写法照 `MarkdownContextMenu.vue` | 把自带菜单画进普通 DOM（`useShadowDOM: false`）再写样式：文字语言、粘贴、贡献位置仍解决不了 |
| 何时打开 | 控件根元素上捕获阶段的 DOM `contextmenu` 与 `editor.onKeyDown` | `editor.onContextMenu` 加自带控制器的残留分支：回调时光标与焦点还是旧的，残留分支会收掉多选区、移走光标、从查找框抢焦点；`editor.addCommand`：键位登记是整页单例，实例之间串，不能释放 |
| 语法色的取值 | 新的一组角色变量 `--syntax-*`，缺省由配色变量用 `color-mix()` 推导 | 加进配色契约（33 个键）：每套配色、主题编辑器、“我的主题”都要补值 |
| Monaco 主题规则 | `inherit: false`，自己写十几条前缀规则 | `inherit: true`：要逐条压掉基底的 51 条专门规则，还要读 Monaco 内部的规则表来核对 |
| 颜色换算 | 临时元素读计算色，再经 1×1 画布读回 RGBA，输出 `#rrggbbaa` | 现有的 `hex()`：只认不透明的旧式写法，`rgba()`、`color-mix()` 一律退回后备色 |

## 3. 关键设计

### 3.1 右键菜单：`packages/neuro-book/src/plugins/editor/web/components/CodeContextMenu.vue`（新，同名 `.md`）与 `web/code/context-menu.ts`

`MonacoControl.vue` 建编辑器时加 `contextmenu: false`，并挂 `CodeContextMenu`（收编辑器实例、只读、绑定标识、是否可见）。菜单经注入的 `editorMenusKey` 取文字、快捷键写法与贡献项。

- **鼠标打开**：控件根上捕获阶段的 `contextmenu` 监听，用 `editor.getTargetAtClientPoint(x, y)` 取目标：
  - 落在编辑器自己的浮层（查找框、建议框等 `OVERLAY_WIDGET`、`CONTENT_WIDGET`）：不拦，留给浏览器（查找输入框里要能粘贴），焦点不动；
  - 滚动条、小地图：只 `preventDefault`，不出菜单；
  - 正文与行号区：`preventDefault`、`stopPropagation`（自带控制器的残留分支就不再动光标与焦点），自己 `editor.focus()`；点击处不在**任何一个**选区里时把光标移到点击处，在选区里则保留全部选区；然后打开菜单。
- **键盘打开**：`editor.onKeyDown` 里认菜单键与 Shift+F10，`preventDefault` 加 `stopPropagation`（Monaco 自己绑在 Shift+F10 上的动作不再吃这次按键）；先 `revealPosition` 再 `render()`，锚点取光标的底边。DOM 监听里 `button !== 2` 的事件（有的平台菜单键在 keyup 才发）同样按“在光标处打开”处理，两条路径幂等。监听随控件卸载释放。
- **显示条件取快照**：打开那一刻、聚焦之后取一次 `{readonly, hasSelection, canFormat, canFormatSelection}`，交给纯函数 `codeMenuItems(snapshot)` 得到项的列表；菜单开着期间不重算。`isSupported()` 只用来问“这门语言有没有格式化”，别的项不用它（有的动作的条件含“文字区有焦点”，菜单开着时为假）。
- **每一项执行前先 `editor.focus()`**，再执行；执行方式写在表里：

  | 项 | 执行 | 显示条件 | 显示的快捷键 |
  |---|---|---|---|
  | 剪切 | 命令 `editor.action.clipboardCutAction`（`trigger`） | 可写 | Mod+X |
  | 复制 | 命令 `editor.action.clipboardCopyAction` | 总是 | Mod+C |
  | 粘贴 | 读剪贴板后 `trigger("nbook", "paste", {text, pasteOnNewLine, multicursorText, mode})` | 可写 | Mod+V |
  | 全选 | 命令 `editor.action.selectAll` | 总是 | Mod+A |
  | 查找 | 动作 `actions.find` | 总是 | Mod+F |
  | 替换 | 动作 `editor.action.startFindReplaceAction` | 可写 | 不显示 |
  | 更改所有匹配项 | 动作 `editor.action.changeAll` | 可写 | 不显示 |
  | 格式化文档 | 动作 `editor.action.formatDocument` | 可写且 `canFormat` | 不显示 |
  | 格式化选定内容 | 动作 `editor.action.formatSelection` | 可写、有选区且 `canFormatSelection` | 不显示 |

  - 剪切、复制不用 `document.execCommand`：Monaco 0.55.1 在 Chrome 上用 EditContext 输入，`execCommand("cut")` 什么都不做。没选区时这两项作用于整行（与 Ctrl+X、Ctrl+C 相同，和 Markdown 正文“没选区置灰”不同，写进 Spec）。
  - 粘贴不能执行 Monaco 自己的粘贴动作（独立版缺 `IProductService`）。自己读剪贴板，并从 Monaco 的 `InMemoryClipboardMetadataManager`（`monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js`，内部模块）取这段文字复制时记下的整行、多光标信息一起交出：否则“复制整行再从菜单粘贴”会插在行中间，与 Ctrl+V 不同。内部模块随升级变动由 e2e 的“整行复制后菜单粘贴”兜底。
  - 读剪贴板与失败分类（不支持、被拒、为空）现在写在 `markdown/web/components/menus/clipboard.ts` 里、绑着 Tiptap。抽成 `editor/shared/clipboard-read.ts` 的一个函数（可注入读取器），两个菜单共用；失败经 `menus.notify` 在组顶部提示，文案同 Markdown。
  - 快捷键只显示各平台一致的五项：替换、格式化在 Linux、macOS 上的键位不同，应用只分两档平台，写不对。键位本身仍归 Monaco。
  - 内置项带与 Markdown 正文菜单相同的图标。分三节：剪贴板；全选；查找与修改。之后是贡献项。
- **不放的**，取舍按本产品 Markdown 正文菜单的习惯（给不记快捷键的写作者用得上的编辑动作）：撤销、重做（工具栏与快捷键已有，Markdown 正文菜单也没有）；转到行（应用的命令要参数，由命令面板的 `:N` 给）。产品没有加载 Monaco 的命令面板与“转到符号”，不存在取舍。
- **关闭**：选了一项或 Escape，焦点回编辑器；点外面不抢焦点。换绑定、控件变为不可见、正文滚动时关闭。只读在菜单开着时变了不处理（项是打开时的快照，执行时 Monaco 自己拒绝）。
- **贡献项的“当前文件”**：`EditorMenus.contributed` 取活动组的活动标签；打开前已经 `focus()`，被右击的组成为活动组之后再取。

### 3.2 菜单位置 `editor.code-context`

- `shared/contracts.ts`：`EDITOR_CODE_CONTEXT_POINT = "editor.code-context"`，`menuLocation(point, {...MENU_ICON, ...MENU_EXTENSIONS}, {contexts: ["resource"]})` 与校验函数。比 `editor.body-context` 多 `extensions`：这个位置下开的是 `.json`、`.css`、`.html` 等各种文件，只对一种有意义的项要能按后缀出现。这也是不复用 `editor.body-context` 的理由：两个位置的字段不同，那边的贡献项默认自己在 Markdown 富文本里。
- `web/plugin.ts` 照 `editor.body-context` 登记五处（贡献点、`receives`、`MenuItemRegistry`、`createEditorMenus` 的 `items`、`receivers`）；测试插件 `src/web/testing/test-menus.ts` 加一项。SDK 公开入口不导出位置常量，没有快照要改。
- 只读时不显示贡献项（同 Markdown 正文）。

### 3.3 语法色的 token：`packages/nb-ui/src/tokens.css`、`src/theme/tokens.ts`

角色变量新增一组（`nbThemeSyntaxTokens`，并入 `nbThemeTokens`）。每个变量的缺省各取不同的来源，彩色的一律往正文字色混 25%（`color-mix(in srgb, <来源> 75%, var(--text-main))`）：状态色是按面板底（`--bg-panel`）校的，源码编辑器的底是 `--bg-main`，不加深的话 nbook 亮、macos 亮上有六项不到 4.5。

| 变量 | 缺省的来源 | 用在 |
|---|---|---|
| `--syntax-comment` | `--text-secondary` 与 `--text-muted` 各半 | 注释 |
| `--syntax-keyword` | `--accent-text` 55% 加 `--status-danger`（蓝色强调下是紫） | 关键字 |
| `--syntax-string` | `--status-success` | 字符串、属性值 |
| `--syntax-number` | `--status-warning` | 数字、常量 |
| `--syntax-type` | `--status-info` | 类型、命名空间、注解 |
| `--syntax-tag` | `--status-danger` | 标签名、元标签 |
| `--syntax-attribute` | `--status-info` 与 `--status-success` 各半 | 属性名、JSON 的键 |
| `--syntax-regexp` | `--status-danger` 与 `--status-warning` 各半 | 正则、转义 |
| `--syntax-variable` | `--text-main`（不混） | 变量、标识符 |
| `--syntax-punctuation` | `--text-secondary`（不混） | 分隔符、运算符、括号 |

- 这组取值由脚本在八套配色（nbook、macos 的亮暗，护眼绿、护眼米黄的亮暗）上量过：对 `--bg-main` 的对比度除注释外都不低于 4.5、注释不低于 3；常相邻的成分（JSON 的键、字符串值、数字、`true`；CSS 的属性名与数值；HTML 的标签、属性名、属性值）两两色差不低于 15。个别配色里正则与标签、关键字相近（它的强调色本来就取在状态色旁边），正则少见，接受。脚本与结果随实现入库作证据，实施时按截图微调比例。
- 主题包要自己的色板时在 `vars.css` 里改判，**只许写成配色变量的引用或 `color-mix()`，不写字面色**：护眼主题与“我的主题”以 nbook 或 macos 为基底，主题包写死的颜色会原样落到它们的绿底、米黄底上。这次 nbook、macos 都不改判。
- 不进声明式主题的 `vars` 白名单（`THEME_ROLE_VARS`）：开发者定了“用户覆盖以后再做”。代价是护眼两套与“我的主题”只能用推导出的颜色。
- nb-ui 一侧要动的：`tokens.css` 的声明、`theme/tokens.ts` 的分组与文件头的分工说明（语法色是这份名单里第一组随配色变的颜色）、`@notnotype/nb-ui/theme` 入口导出、`packages/nb-ui/docs/authoring-themes.md` 的“能改哪些变量”；应用一侧 Lab 变量页签的分组表 `lab/web/lab-tokens.ts`。
- 消费方现在只有 Monaco；以后 Markdown 代码块、JSON 查看器做着色时用同一组。

### 3.4 Monaco 主题：`web/code/monaco-theme.ts`

- `inherit: false`：规则只有自己写的十几条前缀规则（Monaco 按前缀匹配：`string` 管 `string.key.json` 之外的全部字符串，`string.key` 另写）：`comment`、`keyword`、`string`、`string.key`（属性）、`number`、`constant`、`regexp`、`string.escape`、`type`、`namespace`、`annotation`、`tag`、`metatag`、`attribute.name`、`attribute.value`、`variable`、`delimiter`、`operator`、`invalid`（危险色加下划线），加 `emphasis`、`strong` 两条字形。没有规则的 token 落到前景色。
- `colors`：现有的背景、前景、行号、光标、当前行之外，加选区 `editor.selectionBackground`（取 `--selection-bg`，配色契约里已有）；失焦选区与“相同内容”高亮在 `inherit: false` 时由选区色自动派生；缩进线两色取 `--border-color`、`--border-strong`。查找框等部件的颜色来自 Monaco 按明暗给的缺省值，与 `inherit` 无关，不变。
- 括号对着色关掉（`bracketPairColorization: {enabled: false}`）：它用三个固定的主题色，不归 token 规则管；关掉后括号按 `delimiter` 着色，由 `--syntax-punctuation` 管。
- **颜色换算**改成两步，替掉现有的 `hex()`：把取值设到一个临时元素的 `color` 上读计算值（解掉 `var()`、`light-dark()`），再填进 1×1 画布用 `getImageData` 读回 RGBA，输出 `#rrggbb` 或 `#rrggbbaa`。四套自带配色的 `--selection-bg` 都是 `rgba()`，语法色的缺省是 `color-mix()`，旧办法都换不了。读不出时用后备色并记一条诊断。主题或明暗变了重新生成，沿用现有的 `MutationObserver`。
- 底色仍是 `--bg-main`，不在本 Task 改（见待确认项 6）。

## 4. Spec 与文档改动

- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：新增输出“源码编辑器的右键菜单”（各项、只读、没选区时的整行、键盘、查找框里不出、何时关闭、贡献位置）与“语法配色”（跟随主题、哪些成分一种颜色、括号）；验收场景；实现合同与证据。
- [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)：位置表加 `editor.code-context` 一行（另有的字段 `icon`、`extensions`；当前文件是被右击的编辑器的文件）。
- [`theme/system.md`](../../../../../docs/specs/theme/system.md)：角色变量加 `--syntax-*` 一组与“主题包改判不写字面色”；“例外”里把 Monaco 语法高亮拿掉；Monaco 主题一句改成“颜色读计算值并换算，认 `color-mix()` 与带透明度的写法”。
- 组件文档：`CodeContextMenu.md`（新）、`MonacoControl.md`；nb-ui 的 `authoring-themes.md`。

## 5. 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | Spec 三处（主工作区 master） | `docs:check`、`governance:check` |
| 2 | nb-ui 的 `--syntax-*` 与登记、文档；`monaco-theme.ts`（规则、换算、选区、缩进线）与括号着色开关；测试 | nb-ui 的 token 测试、编辑器的 Bun 测试、typecheck |
| 3 | 共用的读剪贴板函数（Markdown 菜单改用它）；菜单位置 `editor.code-context`；`context-menu.ts`、`CodeContextMenu.vue`、`MonacoControl.vue` 接线、文案；Lab 场景（带一个最小的 `EditorMenus`，菜单上是真文字） | 编辑器与 Markdown 的 Bun 与组件测试、typecheck、`nbdev shot` 看 Lab 场景 |
| 4 | e2e 与截图证据 | 见第 7 节 |

## 6. 验收映射

| 判据 | 覆盖 |
|---|---|
| 内置项随只读、选区、能否格式化变化；每项的执行方式 | `context-menu.test.ts`（纯函数） |
| 读剪贴板的三种失败 | `clipboard-read.test.ts`（注入读取器）；Markdown 菜单的既有用例照过 |
| 贡献项出现、按后缀筛选、`resource` 参数；右击非活动组时取被右击的文件 | `editor/code-context-menu.test.ts`（真实命令注册表与测试插件，写法照 `title-actions.test.ts`） |
| 真实浏览器的菜单：右击出现应用的菜单、Monaco 与浏览器的都不出现；剪切后正文与剪贴板都变；整行复制后菜单粘贴插成整行；全选、查找、替换、更改所有匹配项（先点别的面板再右击也在且有效）、格式化（JSON）；多选区时右击其中一个选区内不收掉选区；点在选区外光标移过去；右击查找输入框不出应用菜单、焦点不动；菜单键与 Shift+F10 在光标处打开，两个编辑组各按各的；Escape 后焦点回编辑器，点外面不抢焦点；滚动、换文件时关闭；只读文件只有复制、全选、查找 | `e2e/editor-code-menu.e2e.ts`（新；剪贴板用 Playwright 的权限授予） |
| 语法色取自 token、换主题与明暗后变化；`color-mix()` 与 `rgba()` 换算得对 | `e2e/editor-types.e2e.ts` 加一例：读关键字、字符串、注释、括号的计算颜色与选区色，等于临时元素上同一变量的计算色（不用画布求期望）；切到暗色、护眼绿后再读 |
| 规则表覆盖样例里出现的 token | `monaco-theme.test.ts`：规则表的形状；e2e 里对 `.ts`、`.json`、`.css`、`.html`、`.md` 样例读每种 `mtk` 的颜色都在语法色或前景色里 |
| 语法色读得清、相邻成分分得开 | 色板脚本（证据）加 e2e 里按色值算对比度：八套组合，除注释外不低于 4.5，注释不低于 3 |
| nb-ui 登记 | `tokens.test.ts` |

## 7. 验证

- 合入前 e2e 清单（7 个）：`editor-code-menu`、`editor-types`、`editor-code-settings`、`editor-area`、`themes`、`lab-scenes`、`markdown-editing`（共用的读剪贴板与 `EditorMenus`）。实施中只重跑改动覆盖的文件。
- `bun run test:affected --typecheck`（nb-ui 改了 token，依赖它的包都会选中）、`docs:check`、`governance:check`。
- 截图做成 `report` 产物给开发者看：`.ts`、`.json`、`.css`、`.html`、`.md`（这款应用里用源码编辑器打开最多的是 Markdown 源码）五个样例，在 nbook、macos、护眼绿、护眼米黄的亮暗下各一张；另有一张“有选区、菜单打开”。
- 未验证边界：真实键盘的菜单键、Windows 与 macOS；Safari、Firefox 的剪贴板权限（沿用 Markdown 正文菜单的做法）。

## 8. 不做与风险

- **不做**：用户在设置里覆盖语法色、声明式主题覆盖语法色；查找框、建议框等 Monaco 部件的换肤；Markdown 代码块的语法着色；TextMate 语法；菜单里的“自动换行”开关（可以后加）；改源码编辑器的底色。
- **风险 1：读 Monaco 的内部模块取剪贴板元数据。** 升级后路径或形状变了，粘贴退化成“按纯文本插在光标处”；由 e2e 的整行粘贴一例发现。
- **风险 2：推导出的语法色不够好看。** 可读性与区分度有脚本和 e2e 兜底，好不好看由开发者看截图定；要调只改 `tokens.css` 的十行。
- **风险 3：`inherit: false` 后漏写规则的成分变成前景色。** 比落到基底的蓝更符合“跟随主题”；e2e 对五种样例核对。
- **风险 4：捕获阶段拦掉 `contextmenu` 后 Monaco 某些部件自己的右键行为。** 浮层类目标一律放过；滚动条、小地图本来就没有菜单。

## 待确认项

1. 菜单项用自己维护的封闭的表，每项执行 Monaco 的命令（“菜单项来自 Monaco 的动作”按此理解）；以后语言贡献带来的动作要改表才出现。
2. 内置九项的清单与“不放撤销、重做、转到行”；没选区时剪切、复制作用于整行；只显示五项各平台一致的快捷键。
3. 新开位置 `editor.code-context`（带 `extensions`），不复用 `editor.body-context`。
4. 语法色做成角色变量、缺省由配色推导并往正文字色加深 25%；nbook、macos 不单独配色板；不进声明式主题的白名单。
5. 十个变量的划分与来源；关掉括号对着色；`invalid` 用危险色加下划线。
6. 源码编辑器的底色保持 `--bg-main`。它与 Markdown 稿纸的 `--bg-panel` 不是同一档（nbook 亮色下一个偏灰、一个偏白），是否统一请开发者看截图定，另建 Task。
7. 顺手接上选区色与缩进线颜色。
