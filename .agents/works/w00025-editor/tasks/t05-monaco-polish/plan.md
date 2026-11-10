# t05 实施计划：源码编辑器的右键菜单与语法配色

## 1. Context

- **为什么做**：源码编辑器（Monaco）有两处和产品不一致。右键菜单是 Monaco 自己画的（在 shadow DOM 里，样式、文字语言、键盘都不归应用管，插件也加不了项）；语法着色用的是 Monaco 自带的 `vs`、`vs-dark`，不随产品主题变，护眼主题下背景是绿或米黄，着色仍是为白底、黑底配的。
- **开发者已确认的决定**（2026-10-15，Task README）：右键菜单关掉 Monaco 自己的，换成应用的（nb-ui `ContextMenu`），菜单项来自 Monaco 的动作，给插件一个菜单位置；语法配色加进主题 token，用户覆盖以后再做。
- **期望结果**：右击源码看到的是与 Markdown 正文同一套外观的菜单；语法颜色由主题 token 给出，换主题、换明暗、用护眼主题或“我的主题”都跟着变。
- **工作方式**：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`，排在 t04 之后；Spec 在主工作区 master 上改。审查派 fable 子代理（开发者 2026-11-10）。

## 2. 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 菜单项从哪来 | 一张自己维护的表，逐项对应 Monaco 的公开动作（`editor.getAction(id)`、`editor.trigger`），按 `isSupported()` 与只读决定显示 | 读 Monaco 内部的 `MenuRegistry`/`MenuId.EditorContext`：内部模块没有类型、随版本变，标题只有英文，条件要用内部的 context key 服务求值 |
| 菜单外观 | nb-ui `ContextMenu`，写法照 `MarkdownContextMenu.vue` | 给 Monaco 的菜单写样式：它在 shadow DOM 里，只能改颜色 |
| 语法色的取值 | 新的一组角色变量 `--syntax-*`，缺省从配色变量推导（状态色与文字色），主题包可在 `vars.css` 改判 | 加进配色契约（33 个键）：每套配色、主题编辑器的推导、“我的主题”都要补 10 个值，声明式主题（护眼）也要各写一份 |
| Monaco 基底主题规则的覆盖核对 | 测试里读 `monaco-editor/esm/vs/editor/standalone/common/themes.js` 的 `vs`、`vs_dark` 规则表，核对我们的映射覆盖每个 token | 手抄一份清单：Monaco 升级后会悄悄漏 |

## 3. 关键设计

### 3.1 右键菜单：`packages/neuro-book/src/plugins/editor/web/components/CodeContextMenu.vue`（新，同名 `.md`）

- `MonacoControl.vue` 建编辑器时加 `contextmenu: false`，并挂 `CodeContextMenu`；菜单经注入的 `editorMenusKey` 取文字、快捷键写法与贡献项（Lab 里没有注入时只有内置项，文字用键名兜底，做法同 `codeEditorOptionsKey`）。
- **打开**：`editor.onContextMenu(e)` 里 `preventDefault`，在指针位置打开。Monaco 在关掉自带菜单时仍会聚焦并在点到选区外时把光标移到点击处（实施时在真实浏览器里核对，不成立就自己做，规则同 Markdown 正文：点在选区内保留选区）。键盘：菜单键与 Shift+F10 在光标处打开（`editor.getScrolledVisiblePosition` 加容器矩形）；Shift+F10 在 Monaco 里绑着它自己的“显示上下文菜单”，用 `editor.addCommand` 接过来。
- **关闭**：选了一项或 Escape，焦点回编辑器；点外面不抢焦点。换绑定（换文件）时关闭。
- **内置项**（文字进 `locales/` 的 `menus.*`，已有的 `cut`、`copy`、`paste`、`selectAll` 复用）：

  | 项 | 做法 | 只读时 |
  |---|---|---|
  | 剪切、复制 | 聚焦编辑器后 `document.execCommand`，与 Ctrl+X、Ctrl+C 同一条路径（Monaco 没选区时作用于整行，照旧） | 只有复制 |
  | 粘贴 | `navigator.clipboard.readText()` 后 `editor.trigger("nbook", "paste", {text})`；不支持、被拒、为空时用组顶部提示说明（`menus.notify`，与 Markdown 同文案） | 不显示 |
  | 全选 | `editor.trigger(…, "editor.action.selectAll")` | 显示 |
  | 查找 | 动作 `actions.find` | 显示 |
  | 替换 | 动作 `editor.action.startFindReplaceAction` | 不显示 |
  | 更改所有匹配项 | 动作 `editor.action.changeAll` | 不显示 |
  | 格式化文档 | 动作 `editor.action.formatDocument`，`isSupported()` 为真才显示（现在只有 JSON） | 不显示 |

  分三节：剪贴板、全选、查找与修改；之后是贡献项。快捷键只是显示（`formatKeybinding`），键位仍归 Monaco。
- **不放的**：撤销、重做（VS Code 与 Markdown 正文的菜单都没有）；转到行（应用的命令要参数，由命令面板的 `:N` 给）；Monaco 自己的命令面板（F1）。
- **动作表的测试**：`code-context-menu.ts` 里的纯函数 `codeMenuItems({supported, readonly, hasSelection})` 返回项的列表，Bun 测试核对各状态下有哪些项；动作 id 的存在由 e2e 在真实 Monaco 上核对（点每一项看效果）。

### 3.2 菜单位置 `editor.code-context`

- `shared/contracts.ts`：`EDITOR_CODE_CONTEXT_POINT = "editor.code-context"`、`menuLocation`（字段同 `editor.body-context`：`icon`，`context: "resource"` 收到 `{address}`）、校验函数；`web/plugin.ts` 里照 `editor.body-context` 登记贡献点、`MenuItemRegistry`、交给 `createEditorMenus` 的 `items`。
- 不复用 `editor.body-context`：那个位置的贡献项默认自己在 Markdown 富文本里（格式类动作），两种正文的菜单各一个位置，贡献方要两边都出现就各贡献一次。
- 只读时不显示贡献项（同 Markdown 正文）。

### 3.3 语法色的 token：`packages/nb-ui/src/tokens.css`、`src/theme/tokens.ts`

角色变量新增一组（`nbThemeSyntaxTokens`，并入 `nbThemeTokens`）：

| 变量 | 缺省 | 用在 |
|---|---|---|
| `--syntax-comment` | `var(--text-muted)` | 注释 |
| `--syntax-keyword` | `var(--accent-main)` | 关键字 |
| `--syntax-string` | `var(--status-success)` | 字符串、属性值 |
| `--syntax-number` | `var(--status-warning)` | 数字、常量 |
| `--syntax-type` | `var(--status-info)` | 类型、命名空间、注解 |
| `--syntax-tag` | `var(--status-danger)` | 标签名、元标签 |
| `--syntax-attribute` | `var(--status-warning)` | 属性名、JSON 的键 |
| `--syntax-regexp` | `var(--status-danger)` | 正则、转义 |
| `--syntax-variable` | `var(--text-main)` | 变量、标识符 |
| `--syntax-punctuation` | `var(--text-secondary)` | 分隔符、运算符 |

- 缺省全部由配色变量推导：四套自带配色、护眼主题、“我的主题”不用各写一份就有成套的语法色，状态色本来就按“在底色上读得清”校过（护眼主题的 e2e 量过对比度）。
- 主题包想要自己的语法色板时在 `vars.css` 里按明暗改判；这次 nbook、macos 先用缺省，截图或对比度不合格的再在主题包里改（见第 7 节）。
- 不进声明式主题的 `vars` 白名单（`THEME_ROLE_VARS`）：那份名单公开后不能改名，“用户覆盖以后再做”。
- 消费方现在只有 Monaco；以后 Markdown 代码块、JSON 查看器做着色时用同一组。

### 3.4 Monaco 主题：`web/code/monaco-theme.ts`

- `buildMonacoTheme` 在现有的 `colors` 之外生成 `rules`：一张 `SYNTAX_RULES` 表把 Monaco 的 token 名映射到上面的变量（前缀匹配由 Monaco 做：`string` 管 `string.sql`）。`inherit` 保持为真（编辑器部件的颜色仍来自基底），所以基底主题里写了专门颜色的 token（`string.key.json`、`attribute.value.number`、`keyword.flow` 等四十多个）都要在表里有对应，否则它们仍是基底的颜色。
- 取值：变量在根元素上的计算值经现有的 `hex()` 换成 `#rrggbb`（去掉 `#` 交给 Monaco）；换算不了时用基底的颜色。主题或明暗变了重新生成，沿用现有的 `MutationObserver`。
- `strong`、`emphasis` 只有字形，不改。`invalid` 用 `--status-danger`。
- 另把选区色接上：`editor.selectionBackground` 取 `--selection-bg`（配色契约里已有，Monaco 现在用基底的蓝）。

## 4. Spec 与文档改动

- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：新增输出“源码编辑器的右键菜单”（内置项、只读、键盘、贡献位置）与“语法配色”（跟随主题、哪些 token）；验收场景；实现合同与证据。
- [`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)：位置表加 `editor.code-context` 一行。
- [`theme/system.md`](../../../../../docs/specs/theme/system.md)：“变量体系”的角色变量加 `--syntax-*` 一组；“例外”里把 Monaco 语法高亮从“不进入配色契约”的清单里拿掉，改写成“语法色是角色变量，缺省由配色推导”；Monaco 主题一句补上语法规则。
- 组件文档：`CodeContextMenu.md`（新）、`MonacoControl.md`（右键菜单、语法色）。nb-ui 的 token 文档里有角色变量清单的地方补上（实施时核对 `packages/nb-ui/docs/`）。

## 5. 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | Spec 三处（主工作区 master） | `docs:check`、`governance:check` |
| 2 | nb-ui 的 `--syntax-*` 与登记；`monaco-theme.ts` 的规则表与选区色；`monaco-theme.test.ts` | nb-ui 的 `tokens.test`、`bun test src/plugins/editor`、typecheck |
| 3 | 菜单位置 `editor.code-context`、`code-context-menu.ts`、`CodeContextMenu.vue`、`MonacoControl.vue` 接线、文案；Lab 场景按 `fixtures/index.dom.test.ts` 的门禁登记 | 编辑器的 Bun 与组件测试、typecheck、`nbdev shot` 看 Lab 场景 |
| 4 | e2e 与截图证据 | 见第 7 节 |

## 6. 验收映射

| 判据 | 覆盖 |
|---|---|
| 右键菜单的内置项随只读、选区、`isSupported` 变化 | `code-context-menu.test.ts` |
| 贡献项出现、按后缀筛选、`resource` 参数 | `editor/code-context-menu.test.ts`（真实命令注册表与测试插件 `test-menus.ts`，写法照 `title-actions.test.ts`） |
| 真实浏览器：右击出现应用的菜单、Monaco 的不出现；剪切、复制、粘贴、全选、查找、替换、更改所有匹配项、格式化（JSON）各点一次看效果；点在选区外光标移过去；菜单键与 Shift+F10；Escape 后焦点回编辑器；只读文件只有复制、全选、查找 | `e2e/editor-types.e2e.ts` 新增一例（剪贴板用 Playwright 的权限授予） |
| 基底主题的每个 token 都有映射 | `monaco-theme.test.ts`（读 Monaco 的 `themes.js`） |
| 语法色取自 token、换主题与明暗后变化 | e2e：打开 `.ts` 文件，读关键字、字符串、注释几个 token 的计算颜色，等于根元素上对应变量的解析值；切到暗色、护眼绿后再读一次 |
| 语法色读得清 | e2e 里按色值算对比度：四套自带组合与两套护眼主题（亮暗），除注释外不低于 4.5，注释不低于 3 |

## 7. 验证

- 合入前 e2e 清单：`editor-types`、`editor-code-settings`、`editor-area`（Monaco 的用例）、`themes`、`lab-scenes`（新 Lab 场景）、`markdown-editing`（共用 `EditorMenus`）。实施中只重跑改动覆盖的文件。
- `bun run test:affected --typecheck`（nb-ui 改了 token，依赖它的包都会选中）、`docs:check`、`governance:check`。
- 截图：亮色下 nbook、macos、护眼绿、护眼米黄各一张（`.ts`、`.json`、`.html` 的样例），暗色各一张，做成 `report` 产物给开发者看语法色的实际效果。
- 未验证边界：真实的操作系统菜单键只按 Playwright 的按键模拟；Safari、Firefox 上的 `execCommand` 与剪贴板权限没有实测（沿用 Markdown 正文菜单的做法）。

## 8. 不做与风险

- **不做**：用户在设置里覆盖语法色；查找框、建议框等 Monaco 部件的换肤（仍是基底的颜色）；Markdown 代码块的语法着色；TextMate 语法。
- **风险 1：关掉自带菜单后的键盘入口。** Shift+F10 被 Monaco 的动作吃掉、菜单键事件的坐标不可靠，都要在真实浏览器里试；由 e2e 的键盘用例兜底。
- **风险 2：缺省推导出的语法色不好看或撞色。** 关键字与类型在 `--accent-main` 与 `--status-info` 相近的配色里几乎同色。这是可接受的缺省（颜色少而稳），不合格的由主题包改判；最终由开发者看截图定。
- **风险 3：`color-mix()` 之类的取值换不成十六进制。** `hex()` 经画布换算，换不了时退回基底的颜色；e2e 的“等于变量解析值”一条会暴露退回的情形。
- **风险 4：Monaco 升级改了动作 id 或基底规则表。** 前者由 e2e 逐项点击兜底，后者由 `monaco-theme.test.ts` 兜底。

## 待确认项

1. 菜单项用自己维护的表，不读 Monaco 的内部菜单登记（“菜单项来自 Monaco 的动作”按“每一项执行的是 Monaco 的动作”理解）。
2. 内置项的清单（不含撤销、重做、转到行、Monaco 的命令面板）。
3. 新开位置 `editor.code-context`，不复用 `editor.body-context`。
4. 语法色做成角色变量、缺省由配色推导，不进配色契约；nbook、macos 先不单独配色板。
5. 十个变量的划分与映射。
6. 顺手把 Monaco 的选区色接到 `--selection-bg`。
