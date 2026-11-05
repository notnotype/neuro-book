---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.menus
owners:
  - nbook.commands
---

# 菜单项

## 目标与非目标

**目标**：插件把自己的命令放进别的插件拥有的菜单位置——标题栏菜单、视图标题、资源管理器右键、编辑区标题。位置由它的拥有者定义：画在哪里、菜单项能收到什么参数、有没有“当前文件”。本 Spec 定所有位置共用的部分：菜单项的形状、显示与可用、排序与分隔、勾选、按后缀过滤与参数。各位置自己的规则写在拥有者的 Spec 里（见“输入与前置条件”的位置表）。

**非目标**：

- 子菜单、按住修饰键换成另一条命令、菜单项上报运行状态（忙碌）。
- 按语言过滤：只按文件后缀；有语言登记之后再加。
- 插件运行期启用与禁用时菜单项的增减：随 [`runtime.plugin-hot-plug`](../runtime/plugin-hot-plug.md)。

## 术语与参与者

- **菜单位置**：拥有者插件定义的一个贡献点（[`runtime.plugins`](../runtime/plugins.md) 的贡献点），规定菜单项画在哪里、能声明哪些字段、执行时能收到什么参数、有没有当前文件。
- **菜单项**：菜单位置上的一条贡献，意思是“在这里放这条命令”。贡献 id 就是菜单项 id。
- **当前文件**：位置此刻作用的文件或文件集合（例如资源管理器里被右键的选择、编辑组的活动标签）。没有当前文件的位置不接受按后缀过滤。
- 参与者：贡献菜单项的插件（贡献方）、定义位置并画出菜单的插件（拥有者）、命令服务（[`workbench.commands`](commands.md)）与公开状态（[`state.public-state`](../state/public-state.md)）。

## 输入与前置条件

菜单项写在贡献方的浏览器入口下，随这个入口激活出现、停止消失；它只有声明，实现交一个空对象（内核只能对整个贡献点规定要不要实现，同工作台的活动栏条目）。共同形状：

```ts
interface MenuItemDeclaration {
    readonly command: string;                       // 要执行的命令 id
    readonly section: string;                       // 分节名：同节连在一起，节之间画分隔线
    readonly order?: number;                        // 节内顺序，缺省 0
    readonly label?: Text;                          // 缺省用命令的标题；文字值见 ui/i18n
    readonly toggled?: string;                      // 布尔公开键：画成勾选项
    readonly when?: {readonly requires: ReadonlyArray<string>}; // 布尔公开键，全部为真才显示
    readonly args?: Readonly<Record<string, unknown>>; // 固定参数，例如 {part: "sidebar"}
    // 下面四个字段只在位置表里列出它的位置可用
    readonly context?: string;                      // 位置规定的参数名；声明了时参数是位置给的对象
    readonly extensions?: ReadonlyArray<string>;    // 当前文件的后缀，例如 [".md"]
    readonly icon?: string;                         // 图标类名
    readonly placement?: "inline" | "menu";         // 按钮还是收进“⋯”，缺省 inline
}
```

| 位置 | 贡献点 | 拥有者 | 另有的字段 | `context` 与参数 | 当前文件 | 规则 |
|---|---|---|---|---|---|---|
| 标题栏菜单 | `workbench.titlebar-menu` | `nbook.workbench` | `group`（`file`、`edit`、`view`、`help`，必填） | 无 | 无 | [`ui.workbench-shell`](../ui/workbench-shell.md) 外壳四输出 29 |
| 视图标题 | `workbench.view-title` | `nbook.workbench` | `view`（视图 id，必填）、`icon`、`placement` | `"instance"` → `{viewId, generation}` | 无 | [`workbench.views`](views.md) 输出 10、11 |
| 资源管理器右键 | `explorer.context` | `nbook.explorer` | `extensions` | `"selection"` → `{addresses}` | 被右键的选择 | [`workbench.files-explorer`](files-explorer.md) 的“右键菜单” |
| 编辑区标题 | `editor.title` | `nbook.editor` | `icon`、`placement`、`extensions` | `"resource"` → `{address}` | 编辑组的活动标签 | [`workbench.editor`](editor.md) 输出 34 |
| 编辑器标签右键 | `editor.tab-context` | `nbook.editor` | `extensions` | `"resource"` → `{address}` | 被右击的文件标签（页面标签没有当前文件） | [`workbench.editor`](editor.md) 输出 57 |
| Markdown 固定工具栏（planned） | `editor.toolbar` | `nbook.editor` | `icon`、`placement` | `"resource"` → `{address}` | 无 | [`workbench.markdown-editing`](markdown-editing.md) 输出 1、3 |
| Markdown 选区菜单（planned） | `editor.selection` | `nbook.editor` | `icon` | 同上 | 无 | 同上，输出 6 |
| Markdown 斜杠菜单（planned） | `editor.slash` | `nbook.editor` | `icon` | 同上 | 无 | 同上，输出 11 |
| Markdown 块菜单（planned） | `editor.block` | `nbook.editor` | `icon` | 同上 | 无 | 同上，输出 17 |
| Markdown 正文右键（planned） | `editor.body-context` | `nbook.editor` | `icon` | 同上 | 无 | 同上，输出 20 |

| 规则 | 不满足时 |
|---|---|
| 只接受浏览器入口的贡献 | 声明被拒（`invalid-declaration`） |
| 菜单项 id 至多 128 个字符、点分小写段；`nbook.*` 插件写 `nbook.` 开头，其它插件以自己的插件 id 加 `.` 开头 | 同上 |
| `command`、`section` 非空，`section` 至多 64 个字符；`order` 是 -1000000 到 1000000 的整数；`label` 是文字（见 [`ui/i18n`](../ui/i18n.md)） | 同上 |
| 字段属于这个位置（共同字段加位置表里“另有的字段”与 `context`）；`context` 是这个位置规定的名字；`args` 与 `context` 不同时出现 | 同上 |
| `extensions` 至少一项、至多 16 项，每项以 `.` 开头、后面至少一个字符、不含 `/`、`\` 与空白 | 同上 |
| `placement` 为 `inline`（或省略）时有 `icon` | 同上 |
| 声明不认识的字段 | 同上 |

前置：拥有者的入口已激活；它激活时读本位置已接受的全部菜单项。

## 输出与可观察行为

1. **显示**：一条菜单项只在下面几条都满足时显示：这条贡献已交付、还没撤回（见“时序与寿命”）；命令在命令目录里（提供命令的入口已激活）；`when` 的每个键在公开状态里已就绪且为真；声明了 `extensions` 时位置此刻有当前文件且匹配（第 3 条）；声明了 `context` 时位置此刻给得出这个参数（资源管理器右键与编辑区标题在有当前文件时给得出；视图标题总给得出，实例还没建立时按 [`workbench.views`](views.md) 输出 10 禁用）。
2. **可用与文字**：显示的菜单项可用与否取命令自己的 `when`（[`workbench.commands`](commands.md) 的可用性求值），不可用时禁用，悬停与读屏给出命令给的原因（文字值，按当前显示语言翻译，切换语言后随之换）。标题取 `label`，没有时取命令的标题；快捷键取命令声明的键位，按平台写法。
3. **后缀匹配**：当前文件的文件名（地址最后一段）不分大小写地以某个后缀结尾就算匹配（`.MD` 匹配 `.md`，`a.nb.json` 匹配 `.nb.json` 与 `.json`）；当前文件是多个时每一个都匹配才算；文件夹不匹配任何后缀。
4. **排序与分隔**：同一位置（标题栏菜单是同一组，视图标题是同一视图）里，菜单项按 `section` 的码元顺序分节，节内按 `order` 从小到大，同值按菜单项 id 的码元顺序。节之间画一条分隔线；没有显示项的节不画，所以分隔线不出现在两端，也不连着出现。
5. **勾选**：声明了 `toggled` 的菜单项是勾选项，键在公开状态里已就绪且为真时勾上，否则不勾。
6. **执行**：点了经命令服务执行 `command`，来源是 `user`。参数是 `args`（没有时为 `{}`）；声明了 `context` 时参数是位置此刻给出的对象（位置表）。命令不接受这个参数时与从命令面板执行失败一样处理，界面不另提示。
7. **按钮形态**（视图标题、编辑区标题）：`placement` 为 `inline` 的画成图标按钮（位置规定按钮个数的上限；放不下的按钮回到它所在的节、收进“⋯”：拥有者自己的动作一节在前，贡献的各节在后，节内顺序不变），可访问名称与悬停提示是标题，禁用时悬停提示是原因；`menu` 的收进这个位置末尾的“⋯”下拉，“⋯”的可访问名称是“更多操作”，没有显示的 `menu` 项时不画“⋯”。按钮与“⋯”里的项都按第 4 条排序（按钮之间不画分隔）。
8. **随状态更新**：命令登记与撤回、命令可用性、公开状态变化时，显示中的按钮与再次打开的菜单按新的状态重新求值；打开着的下拉里命令被撤回的项不再执行。
9. **文字引用的命名空间**：菜单项没有约定键（`label` 不写时取命令的标题，见第 2 条），登记时只把声明里没写 `ns` 的文字引用补成贡献方插件 id（[`ui.i18n`](../ui/i18n.md) 的“约定键”）。

## 状态与转换

菜单项没有自己的状态：每次显示都由“已接受的声明 × 命令目录 × 公开状态 × 当前文件”算出。

时序与寿命：

- 拥有者在自己的入口激活时读已接受的菜单项声明；这次激活期间声明集合不变。之后才登记的插件的菜单项，要等拥有者下一次激活才可能出现。
- 菜单项从贡献方入口的这次激活交付（`published`）起显示，到这条贡献撤回为止；入口再次激活、重新交付后又显示。入口开始停止到撤回送达之间，已经画出的项可能还在：视图标题、资源管理器右键与编辑区标题的项点了以后由拥有者按当下的交付状态重新核对，已不再交付的不执行。
- 菜单项引用的命令可以由别的插件提供：那个插件的入口停止、命令撤回时这一项不显示，命令重新登记后又显示。
- 参数取哪一刻的当前文件由位置定：资源管理器右键取打开菜单时被右键的选择，编辑区标题取点下去时这个组的活动标签，编辑器标签右键取打开菜单时被右击的标签。

## 副作用与数据

无：菜单项是声明，不持久化；执行的副作用归命令。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 声明不合格 | 该条 `rejected`（`invalid-declaration`，原因可查询），同插件其它贡献照常（[`runtime.plugins`](../runtime/plugins.md) 输出 15） |
| 位置的拥有者没有装 | 该条 `pending`（`unknown-point`），贡献方照样交空实现，不显示、不记诊断 |
| 命令不在目录里 | 不显示（输出 1） |
| 执行失败 | 按命令服务的结果处理（输出 6） |

## 边界与兼容

- 公开接口：菜单项的声明形状与各位置的贡献点 id。字段只追加；新增位置时在位置表里加一行。
- 信任边界：菜单项只能引用命令，执行一律经命令服务，命令自己的 `when` 与参数校验照常生效；位置给出的参数只含位置表里列出的东西。

## 验收与 Smoke

1. Given 测试插件往四个位置各贡献菜单项（其中资源管理器右键与编辑区标题各一条 `extensions: [".md"]` 且带 `context` 的），When 右键 `a.md`、右键 `b.txt`、在编辑组里切换 `a.md` 与 `b.txt` 的标签，Then 带后缀的项只在 `a.md` 时出现，点了命令收到的地址是 `a.md`；同节的项挨在一起、节之间一条分隔线。
2. Given 标题栏菜单，When 不装编辑器插件打开工作台，Then 编辑器贡献的项都不出现，“编辑”组整组不画，其余组里不留多余的分隔线。
3. Given 一条菜单项的命令有 `when` 且此刻不满足，When 打开它所在的菜单，Then 这一项禁用、悬停是原因；When 条件满足，Then 不重开页面它就变成可用。

Smoke：`e2e/workbench-titlebar.e2e.ts`、`e2e/workbench-views.e2e.ts`、`e2e/files-explorer.e2e.ts`、`e2e/editor-area.e2e.ts` 里的菜单用例（测试插件 `test.menus`）。

## 实现合同

- 公开入口：命令插件的 `plugins/commands/shared/contracts.ts`（`MenuItemDeclaration`、`menuLocation`、`menuItemValidator`、`arrangeMenu`、`matchesExtensions`、`MenuItemRegistry`、`menuImplementations`）；各位置的贡献点 id 与声明类型从各拥有者的 `shared/contracts.ts` 导出（`WORKBENCH_TITLEBAR_MENU_POINT`、`WORKBENCH_VIEW_TITLE_POINT`、`EXPLORER_CONTEXT_POINT`、`EDITOR_TITLE_POINT`、`EDITOR_TAB_CONTEXT_POINT`）；标题行的按钮与“⋯”是共享前端组件 `src/ui/menus/TitleActions.vue` 与 `title-actions.ts`。
- owner 与依赖方向：共同合同归 `nbook.commands`，只依赖内核的贡献类型与命令的键位写法；每个位置的拥有者依赖它，定义自己的贡献点、给出当前文件与参数并执行；贡献方只引用拥有者的 `shared/contracts.ts`；`src/ui/menus` 不认识命令与插件。
- 不变量：贡献点要求实现、菜单项交空实现，`MenuItemRegistry` 只给出已交付且没撤回的项，撤回推进它的版本、读它的 computed 随之重算（`workbench/titlebar-menu.test.ts`）。拥有者执行时按菜单项 id（贡献 id 或自己的 key）重新找回声明，不按显示位置（`workbench/view-actions.test.ts`、`editor/title-actions.test.ts`）。放不下的按钮回到它所在的节，拥有者自己的一节在前（`ui/menus/title-actions.test.ts`）。

## 证据

- 实现入口：共同合同 [`commands/shared/menus.ts`](../../../packages/neuro-book/src/plugins/commands/shared/menus.ts)（经命令插件的 `shared/contracts.ts` 导出）；位置 [`workbench/shared/menus.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/menus.ts)、[`explorer/shared/contracts.ts`](../../../packages/neuro-book/src/plugins/explorer/shared/contracts.ts)、[`editor/shared/contracts.ts`](../../../packages/neuro-book/src/plugins/editor/shared/contracts.ts)；标题行的按钮与“⋯” [`ui/menus/TitleActions.vue`](../../../packages/neuro-book/src/ui/menus/TitleActions.vue)、[`ui/menus/title-actions.ts`](../../../packages/neuro-book/src/ui/menus/title-actions.ts)
- 合同测试：[`commands/shared/menus.test.ts`](../../../packages/neuro-book/src/plugins/commands/shared/menus.test.ts)（输出 1–5 与规则表：真实命令注册表）、[`workbench/titlebar-menu.test.ts`](../../../packages/neuro-book/src/plugins/workbench/titlebar-menu.test.ts)（真实内核：组与节、贡献方入口停止、引用别的插件的命令、校验）、[`workbench/view-actions.test.ts`](../../../packages/neuro-book/src/plugins/workbench/view-actions.test.ts)、[`editor/title-actions.test.ts`](../../../packages/neuro-book/src/plugins/editor/title-actions.test.ts)、组件测试 `TitleActions.dom.test.ts`、`FilesExplorerActions.dom.test.ts` 的贡献项一例、nb-ui `ContextMenu.test.ts` 的勾选项一例
- Smoke：验收 1 由 [`workbench-views.e2e.ts`](../../../packages/neuro-book/e2e/workbench-views.e2e.ts)（视图标题）、[`files-explorer.e2e.ts`](../../../packages/neuro-book/e2e/files-explorer.e2e.ts)（资源管理器右键）、[`editor-area.e2e.ts`](../../../packages/neuro-book/e2e/editor-area.e2e.ts)（编辑区标题）里各自新增的一例覆盖，测试插件 `test.menus`；标题栏菜单的条目由 [`workbench-titlebar.e2e.ts`](../../../packages/neuro-book/e2e/workbench-titlebar.e2e.ts) 逐项比对；验收 2、3 由 `titlebar-menu.test.ts` 与 `menus.test.ts` 覆盖
- 批准依据：[可扩展应用平台](../../proposals/extensible-application-platform.md)（accepted）“插件的浏览器部分”一节：菜单位置由拥有者定义并规定菜单项收到的参数与局部上下文；开发者 2026-10-13 确认第一版做四处位置与按后缀的局部条件、同日批准晋升 `implemented`（记录在主工作区 master 的 `.agents/works/w00017-application-runtime-architecture/tasks/t84-menu-contributions/design.md`）。
