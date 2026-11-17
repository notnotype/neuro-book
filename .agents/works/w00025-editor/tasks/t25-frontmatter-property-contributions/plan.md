# t25 frontmatter 属性的图标、显示名与类型贡献点：实施计划（第一稿）

## Context

属性面板（[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 39–51，t10）现在的图标与输入类型都由值推断：文字、数字、勾选、日期、列表、表示不了的各一个图标，同时是改类型的按钮；属性名原样显示。t10 决定 6 的附言问“要不要提供贡献点”，开发者 2026-11-17 答“可以给图标、类型提供贡献点”。本 Task 加一个贡献点，插件按属性名给图标、显示名与类型；设定插件想让“视角”这类属性有自己的图标与名字是最早的使用者（以后再加“指向角色条目”这类新输入类型，见“不做”）。

依据：`markdown-editing.md` 的属性面板与它“不承诺”里的最后一项；已有的纯数据贡献点是先例（`markdown.dialects`：顶层声明、`implementation: "none"`；`editor.languages` 的显示名是 `DisplayText`）。

开发者已确认的决定：只有“可以给图标、类型提供贡献点”这一条（2026-11-17）。下面的形状与规则是我的推荐，见“待确认”。

## 技术选型

无新依赖。声明的校验用 TypeBox（贡献点的 `schema`，同 `markdown.dialects`）；文字用已有的 `DisplayText` 与窗口翻译端口；图标用 Iconify 类名（同菜单贡献的 `icon`）。

## 关键设计

### 贡献点 `markdown.properties`（`packages/neuro-book/src/plugins/markdown/shared/properties.ts`）

- 拥有者 `nbook.markdown`；`implementation: "none"`，只有声明，写在贡献方插件描述的顶层 `contributions`；贡献 id 以贡献方插件 id 加 `.` 开头（`idPrefix: "plugin"`）。
- 声明：`{name: string, icon?: string, label?: Text, kind?: "text" | "number" | "checkbox" | "date" | "list"}`。`name` 是属性名，精确、区分大小写地等于 frontmatter 里键的文字，非空、不含控制字符；至少给 `icon`、`label`、`kind` 之一。`icon` 是 Iconify 类名（`i-lucide-user`）。`label` 是文字（字符串、文字引用或按语言的表，同 `DisplayText`）。`kind` 只能是面板已有的五种可编辑类型，不含表示不了的“{ }”。
- 位置与注册：同 `markdown.dialects`，浏览器与项目两个位置都登记这个贡献点（顶层声明在每个位置都要有拥有者，项目位置不使用它）；`shared/plugin.ts` 与浏览器入口的 `contributionPoints` 各加一条。
- 多个声明给同一个名字：贡献 id 码元顺序最小的整条生效，其余忽略；每个被忽略的声明记一次诊断（`markdown.properties.conflict`，同一对不重复记）。

### 面板怎样用（`packages/nb-markdown/src/editor/properties/MarkdownProperties.vue`）

nb-markdown 不认贡献点，只加一个可选属性 `describe?: (name: string) => PropertyDescription | null`，`PropertyDescription = {icon?: string, label?: string, kind?: EditableKind}`，`label` 已经是当前语言的字符串；不传时与现在一样。

- **图标**：这一行的类型图标换成声明的图标；它仍是改类型的按钮，点了出同一个类型菜单（菜单里每种类型的图标不变，当前类型照旧打勾），按钮的可访问名称与提示写出当前类型。
- **显示名**：属性名一列、收起时的摘要、各输入的可访问名称显示 `label`，名称上的 `title` 带真名；点名字改名时输入框里是真名（改的是文件里的键）。没有 `label` 的显示真名。
- **类型**：只管值为空（`名字:`）的行：这一行按声明的类型输入（现在空值固定按文字）。优先级：这次挂载里用户在类型菜单选过的 > 声明的 > 文字。有值的行仍按值推断，声明不改它；值与声明的类型不符（例如声明日期、值是一段文字）时照值显示，不报错、不改写。类型菜单、换类型的规则（输出 46）不变；声明的类型不让菜单置灰别的项。

### 取得声明（`packages/neuro-book/src/plugins/markdown/web/`）

- `properties-catalog.ts`：`createPropertyDescriptions({declarations, text, report})` 按名字查声明（先过滤出 `name` 相同的、按 id 取最小、记冲突），返回 `describe(name)`；`label` 经窗口翻译端口 `text.t()` 解析（读的时候解析，所以在渲染里调用时跟着界面语言变）。每次调用现查 `declarations.list`（运行时按存活登记推导，不缓存），所以插件装卸之后下一次渲染生效；面板正显示着时插件增减不即时重画，是已知限制。
- `plugin.ts`：入口依赖加 `windowTextKey`（可选，没有时 `label` 退回声明里的字符串或不显示），建好 `describe`，经 Vue 注入键 `markdownPropertiesDescribeKey` 交给组件（同 `markdownPropertiesOpenKey`）。
- `MarkdownControl.vue`：注入后传给 `MarkdownProperties` 的 `describe`；没有注入（Lab、组件测试）时不传。

### 文档与场景

- `MarkdownProperties.md`、`MarkdownControl.md` 补新属性与行为；Lab：`MarkdownProperties` 的场景加一个带声明的（图标、显示名、空值按日期输入）与英文界面的。
- Spec：`markdown-editing.md` 新增输出 59–61（贡献点与声明、面板怎样用、冲突与不合格的声明）、验收场景 31，删“不承诺”最后一项；`CHANGELOG` 的 `## [Unreleased]` 加一条。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/markdown-editing.md` | 输出 59（贡献点 `markdown.properties`：声明形状、校验、冲突）、60（图标、显示名、类型怎样用，与输出 40、42、46 的关系）、61（失败：声明不合格被拒、同名冲突），场景 31，“不承诺”去掉按属性名的贡献点；公开接口一节补贡献点 id |
| `packages/nb-markdown/src/editor/properties/MarkdownProperties.md`、`markdown/web/components/MarkdownControl.md` | `describe` 属性与注入 |
| `packages/neuro-book/CHANGELOG.md` | `[Unreleased]` 加“插件可以按属性名给 frontmatter 属性指定图标、显示名和类型” |

## 切片

1. **合同与取得**：`shared/properties.ts`（声明 schema、校验、点的定义）、两个位置的登记、`properties-catalog.ts`、`plugin.ts` 的注入、`describe` 单元测试（冲突、解析语言、不合格被拒）；一个提交。
2. **面板与界面**：`MarkdownProperties.vue` 的 `describe`（图标、显示名、空值类型）与 DOM 测试、`MarkdownControl.vue` 的传递、Lab 场景、两份组件文档；一个提交。
3. **收口**：Spec、CHANGELOG、一条经真实应用（`createApplication`，测试插件顶层声明）的 DOM 用例，一次前端审查（Sonnet）；合入。

审查：本 Task 是前端加一个纯数据的贡献点，按“任务简单”降级：只做前端实现审查（Claude Sonnet），不另做设计审查。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 59（声明形状与校验） | `markdown/shared/properties.test.ts`：合格的收、`name` 为空或含控制字符、什么都没给、`kind` 不是五种之一、`icon` 不是类名、id 不带插件前缀都被拒 |
| 输出 59（冲突） | `properties-catalog.test.ts`：同名两条，id 小的生效、另一条记诊断、同一对只记一次 |
| 输出 60（图标、显示名） | `MarkdownProperties.dom.test.ts`：图标换了、点了仍出类型菜单且当前类型打勾、显示名出现在名字列与摘要、点名字改名时输入框是真名、写回改的是真键；没有声明的行不变 |
| 输出 60（类型） | 同上：空值按声明的类型输入（日期输入、数字框）；用户选过的类型盖过声明；有值的行不受声明影响；值与声明不符时照值显示 |
| 输出 61、场景 31 | `plugin.dom.test.ts` 同类的集成用例：真实的插件运行时里，测试插件顶层声明一条，打开带这个属性的文件，面板按声明显示；声明不合格被贡献点拒绝（原因经插件宿主查询）、不生效；同名冲突记一次诊断；界面语言经真实的窗口翻译引擎切换后显示名跟着变；场景 31 的“点显示名改名”“选文字盖过声明”两步在 `MarkdownProperties.dom.test.ts`（面板层，与插件运行时没有交互） |

## 验证

- 每片：`tsc --noEmit`、两份 `vue-tsc`、nb-markdown 的 `bun run typecheck`，受影响的 `bun test` 与 vitest 文件；组件变了出 Lab 截图看一眼。
- 不写新的 e2e：真实浏览器里没有新的输入路径（图标与显示名是渲染，类型沿用已有的输入），集成用例经真实的插件运行时；合入前重跑 `markdown-properties.e2e.ts` 一个文件，确认没有声明时行为不变。
- 未验证、留给开发者：设定插件真实贡献时的外观（本 Task 没有真实的贡献者）。

## 不做与风险

- 不做：新的输入类型（“指向角色条目”这类：要一个贡献实现的输入组件，另开 Task）；按文件夹类型限定声明（以后加可选字段 `folderKinds`，字段只追加）；用户在界面里改声明；把图标写进 frontmatter；`tags`、`aliases` 这类键的内置特殊处理（t10 的非承诺）；全书统一类型（同名属性强制同一种类型）。
- 风险：贡献的图标类名要在构建里有对应的 CSS，同菜单贡献的 `icon`（UnoCSS 静态扫描源码里的类名），第三方插件没有构建进应用时图标可能不显示；写进 Spec 的已知限制。
- 风险：顶层声明在项目位置也要有拥有者，实施时先照 `markdown.dialects` 的做法登记，用测试确认项目位置的插件实例没有“未知贡献点”的诊断。

## 待确认（我的推荐，开发者可改）

1. **类型只管空值**：声明的 `kind` 只决定空值行按什么输入，有值的行仍按值推断，不改写；不做新类型。（备选：声明了类型就把能无损转换的值按它显示。更强，但“显示与文件里写的不一致”要处理，先不做。）
2. **图标替换类型图标，按钮仍是改类型菜单**；不并排显示两个图标。
3. **显示名替换属性名一列，真名只在悬停与改名时出现**。
4. **范围是整部作品、按属性名**，不分文件夹类型。
5. **同名冲突：id 最小的整条生效，其余忽略并记诊断**；不逐字段合并。
6. **没有真实的贡献者时的验收**：用测试插件经真实插件运行时验证，Lab 里放一个场景；设定插件（w00039 一系）以后自己贡献。
