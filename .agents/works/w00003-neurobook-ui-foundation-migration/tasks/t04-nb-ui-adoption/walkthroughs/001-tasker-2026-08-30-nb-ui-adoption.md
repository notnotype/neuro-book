---
schema: nbook.walkthrough/v1
taskId: t04-nb-ui-adoption
sequence: 1
role: tasker
status: in-progress
createdAt: 2026-08-30T00:00:00Z
---

# t04 接入 nb-ui 与第一个消费者

## 已完成

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

- `packages/nb-ui` 许可证由 `PolyForm-Noncommercial-1.0.0` 改为 `AGPL-3.0-only`，`LICENSE` 替换为与仓库根一致的 AGPL 全文，`PROJECT-STATUS.md` 的许可证描述同步更新。
- `packages/neuro-book` 新增 `@notnotype/nb-ui` workspace 依赖，`bun install --linker hoisted` 更新 `bun.lock`（25 行新增、4 行删除）。
- `nuxt.config.ts` 在 reset 之后、领域样式之前加入 `@notnotype/nb-ui/styles.css`，并新增 `build.transpile`。未启用 nb-ui 的 Nuxt module。
- `JsonViewer.vue` 工具栏六个按钮全部切换到 nb-ui。三个动作按钮（复制、展开全部、折叠全部）用 `IconButton`，尺寸 `sm`；三个模式按钮（文本、树形、表格）用 `ToggleGroup` 的纯图标形态，单选。`.json-viewer__icon-button`、`.json-viewer__mode-button`、`.json-viewer__modes` 的全部样式已删除，文件内这三个类名出现次数均为 0。
- `packages/nb-ui/tsconfig.json` 不再继承 `playground/.nuxt/tsconfig.json`，改为自包含；新增 `playground/tsconfig.json` 承接 Nuxt 生成类型，`typecheck` 脚本追加 `vue-tsc --noEmit -p playground`。
- 新增 `app/components/common/JsonViewer.md`，本仓库第一份组件文档。

## 已验证

- 主应用 `typecheck`：无输出，退出码 0。执行前先运行 `generate` 补上新 worktree 缺失的 Prisma client。
- `bun --cwd=packages/nb-ui run typecheck`：两遍 `vue-tsc` 均无输出，退出码 0。
- `bun run docs:check`：`failures: []`。新增的组件同名文档没有触发文档结构检查。
- nb-ui 与主应用的 CSS 变量声明无同名冲突：nb-ui 声明 94 个（不含 `--tw-*`），主应用 `theme-vars.css` 声明 66 个，交集为 0。
- nb-ui 的 `dist/nb-ui.css` 中唯一的通配选择器是 Tailwind 的变量初始化块，只设置 `--tw-*`，不改变任何视觉属性；没有裸元素选择器重设现有元素样式。
- 开发服务可以正常启动并提供页面：修复 tsconfig 后重启，此前报错的 `packages/nb-ui/src/components/index.ts` 能正常返回转换后的 JS，日志中 `failed to resolve` 与 `Internal server error` 计数均为 0，根页面 http 200。

## 命令形式修正

仓库 `AGENTS.md` 的「常用命令」里 `bun --cwd packages/neuro-book run …` 不工作，会直接打印 `bun run` 用法并以 0 退出——看起来像什么都没发生，因此很难被发现。

实跑确定的规律是位置决定的，不是等号决定的：`--cwd` 写在 `run` **前面**时必须用等号形式，空格形式失效；写在 `run` **后面**时空格与等号都正常。受影响的六条命令是 `dev`、`dev:runtime`、`build`、`typecheck`、`migration:check`、`generate`。同文件第 139 行的 `bun run --cwd desktop/electron typecheck` 经探针验证本就正常，未改动。

修法取 `bun run --cwd <dir> <script>`，因为这个位置下两种写法都成立，不会再踩同一个坑。开发者批准后已在主工作区的 `AGENTS.md` 上执行，并在命令块末尾补了一行失败表现说明。

这个坑仓库踩过第二次：`.agents/tasks/00156-issue131-plot-drag-verification/walkthroughs/001-leader-2026-08-25_05-30-runtime-acceptance.md` 第 21 行已记录过同一现象，`scripts/ci/workspace-workflows.test.ts` 也有断言拦截 GitHub workflow 里的该写法，但 `AGENTS.md` 自身一直没订正。

`packages/nb-workflow/README.md`、`vitepress/locales/zh-Hans/monorepo.md` 与 `vitepress/locales/en-US/monorepo.md` 仍带同一写法，超出本 Task 范围，未改动。

## 未验证

- 浏览器行为、桌面与 `390×844` 视觉、六个按钮的实际点击结果与焦点环，均未运行。
- 没有覆盖 JsonViewer 工具栏的自动化测试。仓库内唯一引用该组件的测试文件不在 vitest 的 include 范围内，不构成回归防线。
- 产品构建未运行，样式在真实构建下的层叠顺序未验证。

## Nuxt 子目录 index.vue 命名探针

在 `novel-ide`（带前缀）与 `common`（免前缀）两个目录各放一对探针组件后运行 `nuxi prepare`，读取生成的 `.nuxt/components.d.ts`：

| 源文件 | 注册名 |
|---|---|
| `novel-ide/NamingProbe/index.vue` | `NovelIdeNamingProbe` |
| `novel-ide/NamingProbeFlat.vue` | `NovelIdeNamingProbeFlat` |
| `common/ProbeCommon/index.vue` | `ProbeCommon` |
| `common/ProbeCommonFlat.vue` | `ProbeCommonFlat` |

结论：`Foo/index.vue` 与 `Foo.vue` 得到完全相同的注册名，`index` 不进入组件名，免前缀目录同样成立。**组件目录化不会改变任何组件名，也不改变现有的同名碰撞情况。**探针已删除，仓库中不留该形态的组件。

**开发者已拍板：不目录化。**技术上可行不构成采用理由，组件保持 `Foo.vue` 与同目录 `Foo.md` 并列的扁平形态。连带定下 fixture 位置——按 t04 README 记录的分支，不目录化即集中放在开发专用目录并按整目录排除，Lab 建立时按此执行，不再重议。

## 发现一：nb-ui 的 tsconfig 继承一个 gitignore 的生成物

`packages/nb-ui/tsconfig.json` 原本第一行是 `"extends": "./playground/.nuxt/tsconfig.json"`，而该路径由 `.gitignore` 排除，是 `nuxt prepare playground` 的产物。任何新克隆或新 worktree 里这个文件都不存在，nb-ui 的根 tsconfig 因此无法解析。

这是 nb-ui 自身的既有缺陷，不是 t04 引入的；但 t04 让主应用第一次编译 nb-ui 源码，Vite 会为它转换的每个 `.ts` 文件向上找最近的 tsconfig 并解析 `extends` 链，于是缺陷变成主应用的 `Internal server error`，开发服务无法使用。

修复放在缺陷所属的包：根 tsconfig 改为自包含，playground 的 Nuxt 类型移到 `playground/tsconfig.json`，`typecheck` 脚本补上对 playground 的第二遍检查以免类型覆盖被悄悄削掉。两遍 `vue-tsc` 均无输出，此前担心的潜藏类型错误没有出现。

考虑过但否决的两个办法：让开发者先跑一次 `nuxt prepare playground`（把每台机器的手工步骤当依赖，CI 与新克隆仍然会坏），以及在主应用里用 `vite.esbuild.tsconfigRaw` 覆盖（在错误的包里加全局 hack）。

对照仓库里其余包：nb-history、nb-workflow、nb-memory、neuro-book-contracts 的 tsconfig 都是自包含的，nb-ui 是唯一的例外。

## 发现二：模式按钮可以迁移，ToggleGroup 覆盖这个形态

本走查的初版曾结论「nb-ui 没有组件覆盖纯图标加选中态」，该结论错误，当时只看了 `IconButton` 与 `SegmentedControl`，漏掉 `ToggleGroup`。

`ToggleGroup` 的 `label` 可选，只给 `iconClass` 即为纯图标；底层 reka-ui 最终渲染 `<button type="button" aria-pressed="…" data-state="on|off">`，并由 roving focus 提供方向键切换，选中语义完整。三个模式按钮已据此迁移。

一处必须挡住的行为差异：reka-ui 单选模式下再次点击当前项会把值设为空以取消选择（`useSingleOrMultipleValue.changeModelValue`）。查看器必须始终处于某个模式，因此 `switchMode` 对空值直接返回，保持原模式。这与旧按钮「点击当前模式无变化」的表现一致。

一处可见变化：`ToggleGroup` 会给整组套一个带边框和浅底色的容器，而旧实现是三个各自独立的方块。此前两组按钮边框风格不一致（左组有边框、右组无边框）的问题随之消失。

## 发现三：ToggleGroup 的可访问名称只有 title

`IconButton` 有 `:aria-label="props.ariaLabel || props.title"`，`ToggleGroupOption` 没有 `ariaLabel` 字段，纯图标项只能靠 `title` 提供名称。`title` 是可访问名称计算的最末位来源，弱于 `aria-label`。

迁移前的旧模式按钮同样只有 `title`，因此这不是回退，且迁移额外带来了 `aria-pressed`。缺口登记在此，修法是给 nb-ui 的 `ToggleGroupOption` 补 `ariaLabel`，属于公共组件的接口扩展，不在本 Task 范围内。

## 发现四：nb-ui 依赖宿主提供两个未定义变量

nb-ui 引用 106 个自定义属性。逐一比对后，`--overlay-bg` 与 `--shadow-panel` 既不由 `dist/nb-ui.css` 声明，也不在主应用 `theme-vars.css` 中，且在部分用法上没有兜底值。nb-ui 自己的 README 也把这两个列为需要宿主提供的变量。

本 Task 不受影响，`IconButton` 与 `ToggleGroup` 均未使用它们。但迁移浮层与面板类组件（Dialog、Dropdown、Panel）时会得到空值，需要在对应切片前补齐宿主变量或为它们提供兜底。

## 发现五：组件文档的详略分档没有覆盖配方偏离

JsonViewer 的标签为 `state:local` 与 `env:clipboard`，不落在五种推荐配方内，属于档位 D 配方偏离。组件规范的详略分档表只写了纯零件、受控零件、领域视图、宿主与流式宿主，没有说配方偏离该写多少。

本次按「写出 Lab 演示不出来的部分」处理，完整写了六节。已在 `2ebe5e0c` 为配方偏离补上默认档位：按「验证」一节推导的可验证程度取档，并要求为造成偏离的那条隐藏通道写理由。按新规则回看，JsonViewer 归领域视图一档，本次属于超写。

## 发现六：散文写法会整个漏掉一个事件

`JsonViewer.md` 初版把 props 与 emits 翻译成中文散文，结果漏了 `validation-change` 事件——实现中每次内容变化都会用 `JSON.parse` 试一次并把成败发给父组件，文档里没有它，「不支持」一节还反着写了「不对外报告校验结果」。

这不是一次疏忽，是散文写法的固有漏洞：类型声明少一项，读的人有明确的缺口可以对照实现发现；散文少一段，读的人无从知道少了什么。

开发者据此改定组件文档的写法：props、emits、slots 直接写 TypeScript 类型声明，含义、默认值与是否受控写在类型的注释里；文档的判据加一条「读的人不看实现就知道这个组件是什么、能做什么、有什么别处没有的特点、用的时候要注意什么」；正文新增可选的「注意事项」一节。相应地，开头概述对所有档位都必写——Lab 摆得出组件有哪些状态，摆不出为什么会有这个组件。

规范已按此更新，`JsonViewer.md` 已按新规范重写：补回 `validation-change`，订正「不支持」一节，新增三条注意事项（`maxHeight` 默认 300 不是不限制、`mode` 不是只读初始值、传字符串与传对象是两条路径）。

## 发现七：干净上下文评审给出 36 条，其中一条推翻了实现描述

开发者要求用一个没读过本会话的模型审查 `JsonViewer.md`，重点看表述。文档正文直接贴进提示词、不给文件路径，评审方拿不到源码，只能就文档本身发问。

外部模型路线三次失败：haiku 与 deepseek-v4-pro 均 429，gpt-5.6-luna 返回 400 要求先在代理上启用 1M 上下文。最终改用默认模型的干净上下文子代理，「换厂商模型」这一维度未达成。

评审返回 20 条「真会导致用错」与 16 条「吹毛求疵」。按能否从代码验证分三类处置：

**一类：文档写错了，已订正。**最重的一条是键盘模型。文档原写「六个按钮可以逐个聚焦」，读 reka-ui 源码后确认 `ToggleGroupRoot` 的 `rovingFocus` 与 `loop` 默认均为 `true`，`RovingFocusItem` 渲染 `tabindex: isCurrentTabStop ? 0 : -1`，`handleKeydown` 只调 `focusFirst` 不触发激活。因此工具栏实际是 4 个 Tab 停靠点、方向键只移焦点不切模式、到端绕回。这是迁移到 `ToggleGroup` 后沿用旧按钮描述造成的错误，评审提出前无人发现。

同批订正：`maxHeight` 约束的是整个组件而非内容区（`containerStyle` 挂在 `.json-viewer` 根节点）；`maxHeight` 为 0 时「不把外层撑开」的保证同时失效，原文把它写成了组件的固有性质；复制取 `props.value` 而非编辑器内部状态；`mainMenuBar` 与底层同名 prop 无关且底层菜单栏恒关；`navigationBar`/`statusBar` 计入 `maxHeight`；展开折叠是递归全层级；空值判定的实际边界（`""` 与 `undefined` 不复制，`{}`、`[]`、`null`、`0` 都能复制）；组件无 slot 也无 expose。

**二类：文档说了没验证过的话，已改为如实标注。**原文「三种看法随时互切不丢当前数据」从未实测。内容非法时切模式的行为、表格模式对非同构数组的呈现，都移入「已知偏差」标为未核实。

「隐藏通道理由」里「不涉及产品数据」与开头列举的用途（工具入参出参、工作流中间结果）直接冲突——那些正是产品数据。已改写为只声明「不额外读取组件之外的数据」，并明确这一条不构成对内容敏感性的判断。误用这句做合规判断会得出错误结论。

**三类：规范缺规则，未处置，待开发者决定。**见下条。

## 发现八：组件规范缺三条规则，一次评审里生成了约一半的疑问

把 36 条按根因归并，其中约 16 条不是这份文档写得不好，而是规范没规定该写什么：

- **上游依赖的行为边界算不算本组件契约**，无规定。评审中约 10 条源于此：可编辑时的编辑交互、非法内容切模式、表格模式的适用数据、底层快捷键与搜索、底层校验器能力、主题样式、上游版本号。本次按「本组件承诺工具栏六个按钮，其余来自底层且不承诺」的口径就地补写，但这是本文档的一次性选择，不是规范。
- **扩展面要不要声明**，无规定。原文只写「没有 slot」，评审据此追问有无 expose、能否透传 attrs、想接一个「已复制」提示有没有出口。声明扩展面应当是三选一之外的固定项。
- **「已知偏差」与「照文档能重写」如何共存**，无规定。规范说文档写应当成立的行为、实现待订正，但没说重写者该照哪个做，正文也没有回指偏差一节的义务。评审在展开折叠这一条上直接卡住。

另有一条边界问题：评审要求给出引入方式与最小用法示例。规范当前禁止正文写业务代码，而 Nuxt 自动注册使得「引入方式」本身没有内容。是否要求最小用法示例待定。

## 发现八的处置：四条规则已由开发者拍板

- **上游边界**：划边界，不承诺。规范新增「上游边界」一节，要求写明本组件承诺什么、其余来自该库且升级可能变化；不逐条抄上游行为（抄不全且会随升级静默过期），也不留给读者猜。无第三方依赖的组件不写这一节。
- **扩展面**：slots、expose、attrs 是否透传三样都必须声明，没有也要写出「没有」。「没写」与「没有」是两种状态。
- **已知偏差与重写目标的冲突**：正文里被偏差影响的那句话就地加回指，订正时连同回指一起删。
- **最小用法示例**：只在用法反直觉时写，例如事件命名使常规 `v-model` 静默失效。本仓库 Nuxt 自动注册，示例只承载标签写法。

`JsonViewer.md` 已按四条补齐：新增「上游边界」一节并收拢原先散在三处的上游相关表述；声明 attrs 按 Vue 默认落到根节点；两处禁用条件加「当前实现见已知偏差」回指；补一段最小示例，因为事件名是 `update:value` 而非 `update:modelValue`，写 `v-model` 不报错但完全不生效。

组件文档的正文小节顺序至此固定为：布局、交互、数据、状态、不支持、上游边界、注意事项、隐藏通道理由，另加隔离的已知偏差。
