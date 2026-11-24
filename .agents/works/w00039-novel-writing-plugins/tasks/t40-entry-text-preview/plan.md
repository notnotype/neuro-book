# t40 实施计划：条目主文字的分屏预览与源文字高亮

状态：第 1 稿（2026-11-24）。开发者当天在 t39 交付后说：“可以再做一个分屏编辑（试试预览）。然后是代码编辑可以用 Monaco 这个组件来实现，还有文本高亮。”开发者要的是先用起来，本稿没有先交确认：主会话自定的几处记进[待确认清单](../../pending-confirmations.md)。

## 1. Context

t39 把主文字改成整篇源文字的编辑，渲染结果要提交以后才看得到。期望结果：编辑时旁边就有渲染后的样子（字段的值、条目引用的名字都是真的），写错了当场知道在哪一行；源文字按条目的写法着色。

查到的现状（都从代码读出，2026-11-24）：

- 编辑用的输入框已经是 Monaco（编辑器插件交出的 `CodeInput`，退路是普通文本框），语言是 `markdown`。条目的花括号与标签在这门语言里没有专门的颜色。
- Monaco 自带的 `mdx` 不能直接用：它把花括号里的内容交给 JavaScript 的分词，那份规则把认不出的字符标成 `invalid`，中文字段名（`{character.外观}`）会被画成红色下划线。
- 内核只会渲染存下来的块（`render`）。网页端在运行时不能引 nb-canon 的渲染链（author-ui 的实现合同），所以预览只能由世界服务算。
- 窗口的读取层会留着最近 64 个不用的读取：每次按键换一份源文字去读，会留下 64 份整篇加语法树。预览不走读取层。
- 条目页的内容列封顶 760 像素，左右各半放不下。

约束：内核只加一条只读的方法，不改写入、不改写法；富文本、换解析器照旧搁置（t38）。

依据的 Spec：[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md)（加输出 16）、[`canon/project.md`](../../../../../docs/specs/canon/project.md)（方法表加一行）、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（加输出 48，改“不承诺”一条与输出 39 的最后一句），都是 planned。

## 2. 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 源文字着色 | 经贡献点 `editor.languages` 登记一门语言 `canon-entry`，手写 Monarch 规则 | 编辑器区现成的口子，别的插件登记语言就是这样做；否决 Monaco 自带的 `mdx`（中文字段名成了红色下划线，还要多加载一门 JavaScript 的规则）与 `markdown`（花括号没有颜色） |
| 停顿后再渲染 | 自己写的定时器（十来行） | 应用包没有 `@vueuse/core`（只有 nb-ui 用），不为它加依赖 |

## 3. 关键设计

### 3.1 内核与世界服务（`packages/nb-canon`、`packages/neuro-book/src/plugins/canon/shared`、`backend`）

- `render/entry.ts` 加 `renderSourceForAuthor(world, entry, source, position, mode)`：求值的上下文与 `renderEntryForAuthor` 相同（同一个 `context`），把 `source` 当作这个条目的主文字渲染成一块（块 id 固定为 `source`）。不写入、不查写入的白名单以外的东西：出错时照输出 4 给纯文本与诊断（行、列）。条目不存在、那一章或那条线读不到时的返回与 `renderEntryForAuthor` 相同。
- `service.ts` 加 `renderSource(entry, source, position, mode)`，带读取戳。
- 远程合同加 `renderSource: {entry, source, position?, mode}`（读），不收视图令牌（同 `textBlocks`：作者界面用）；`backend/remote.ts` 转给服务，结果照 `read` 的预算（超过得 `too-large`）。

### 3.2 预览的读取（`canon/web/text-preview.ts` 新）

`useTextPreview({call, input, version, delay})`：

- `input()` 给 `{entry, source, position, mode}` 或 null（预览没开着）。从 null 变成有、或世界版本变了：马上读；只是 `source` 变了：停顿 `delay`（缺省 250 毫秒）以后读。
- 只认最后发出的那一次：早先发出的晚回来不换上。
- 结果分三样：`block`（最近一次读得出来的语法树，出错时留着上一次的）、`problem`（这一次的源文字写得不对：行、列、原因；读得出来就是 null）、`failure`（读取本身失败：连接断着、结果太大）。
- 不走窗口的读取层（见 Context），直接 `call`。

### 3.3 界面（`canon/web/components/`）

- `EntryTextEditor.vue`：
  - 属性加 `preview: boolean`（预览开着）、`previewNote: string`（预览栏顶上要写的一句：写得不对的行与原因、读不出来的原因；空串不写）、`previewStale: boolean`（栏里是上一次读得出来的样子）；事件加 `update:preview`；插槽 `preview`（宿主放渲染结果）。
  - 状态行在“插入”左边加“预览”按钮（`aria-pressed`）。
  - 编辑区是一个网格：预览开着、这个组件的宽度不小于 880 像素时左右各半（左边输入框，右边预览栏）；窄于它时预览栏排在输入框下面。
  - 左右分屏时预览栏吸在页头下面、自己滚动（高度不超过看得到的区域），输入框照旧随内容长高、跟着页面滚。作者打字以后，预览栏滚到光标所在那一行对应的段落（预览里的每个段落带着它在源文字里的行号）。
  - 预览栏的出现与消失有过渡；栏里是旧样子时变淡。
- `EntryText.vue`：加 `interactive`（缺省真）。为假时值与条目引用画成文字、不是按钮（预览里不展开来历、不跳走）。块一级的元素带 `data-source-line`。
- `EntryPage.vue`：加 `wide`。为真时页头与内容列的上限从 760 放到 1520 像素（左右两栏各不超过 760）；在根上给出两个 CSS 变量：页头吸顶时的高度与滚动区看得到的高度，预览栏按它们定吸顶的位置与最大高度。
- `EntryPageHost.vue`：`state.preview`（记在标签上，缺省开）；在编辑、文字分页、预览开着时 `wide`，并用 `useTextPreview` 读、把结果放进 `preview` 插槽。
- `entry-page.ts`：`EntryPageState` 加 `preview`。

### 3.4 语言（`canon/web/entry-language.ts` 新、`canon/web/plugin.ts`）

- 语言 id `canon-entry`，别名 `Canon Entry`。规则：标题、列表与引用的记号、分隔线、代码（围栏与行内）、强调与加粗、链接照 Markdown 的画法；`{` 到配对的 `}` 是表达式，里面的名字（含中文）是变量、`.` 与 `[` `]` 是分隔符、字符串、数、运算符各自着色，`{/* */}` 是注释；`<Ref …/>`、`<Image …/>` 这类标签的名字、属性名、属性值各自着色；反斜杠转义（`\{`）不进表达式。
- 认不出的字符一律按正文画（`defaultToken` 为空），不标 `invalid`。
- `plugin.ts` 把它登记到 `editor.languages`；`EntryPageHost` 给编辑视图 `language="canon-entry"`。编辑器区没登记它时（Lab）照旧按纯文本。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/canon/rendering.md` | 加输出 16（planned）：按给的源文字渲染 |
| `docs/specs/canon/project.md` | 方法表加 `renderSource`（planned） |
| `docs/specs/canon/author-ui.md` | 加输出 48（planned）：编辑时的预览与着色；“不承诺”里实时预览那一条改成只剩所见即所得；输出 39 末句改；验收 16 加一句 |
| 组件同名 `.md` | `EntryTextEditor.md`、`EntryText.md`、`EntryPage.md`、`EntryPageHost.md` |
| `pending-confirmations.md` | 见第 8 节的自定项 |

## 5. 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | 3.1 内核、合同、后端 | `packages/nb-canon/tests/rendering.test.ts`、`canon.test.ts`（真实 RPC）、typecheck |
| S2 | 3.2 预览的读取 | `text-preview.test.ts`（真实世界服务）、typecheck |
| S3 | 3.3 界面、文案、Lab 场景、组件文档 | 相关 dom 测试、`nbdev shot`（亮色，含 390 宽与宽画布） |
| S4 | 3.4 语言 | e2e 里看着色 |
| S5 | e2e、实现审查（前端派 Sonnet，后端那一小段派 Sonnet）、合入 | 重新构建后跑 `canon-write`、`canon-author` |

## 6. 验收映射

| 场景 | 覆盖 |
|---|---|
| rendering 输出 16：给的源文字按条目此刻的数据渲染，字段是值、引用是名字；不写入；写得不对给行、列 | `rendering.test.ts` |
| project `renderSource`：经远程合同读得到，条目不存在为 null | `canon.test.ts` |
| author-ui 输出 48：停顿后预览换成新的；先发的晚回来不换上；写得不对时留着上一次的并给出行与原因；世界变了重读 | `text-preview.test.ts` |
| 输出 48：“预览”按钮开关预览栏；关着时不读 | `EntryTextEditor.dom.test.ts`、`entry-page.dom.test.ts` |
| 输出 48：预览里的值与引用不是按钮 | `EntryText` 的 dom 测试 |
| 输出 48：真实浏览器里打字后预览出现字段的值；源文字里标题与花括号的颜色与正文不同 | e2e `canon-write` |
| 窄处预览排在下面、没有横向滚动 | Lab 截图（390 宽） |

## 7. 验证

各片跑受影响的测试；S5 重新构建三份产物后跑 `e2e/canon-write.e2e.ts` 与 `e2e/canon-author.e2e.ts`（1440 视口）。真实浏览器里走一遍：点“编辑”、打一个字段、看右边出值、关掉预览再打开、提交。没有验证的边界：很长的条目（几万字）下预览的手感只按 t39 测过的解析速度估，没有实测。

## 8. 不做与风险

- 不做：在预览里直接改、点预览跳到源文字、两栏同步滚动（只有打字时跟到光标那一段）、源文字里给出错的位置画波浪线、富文本。
- 自定、等开发者追认的：预览缺省开着；开关记在各自的标签上，不是全局偏好；窄处预览排在输入框下面（不是换成只看预览）；分屏时整页放宽到 1520 像素。
- 风险：预览栏吸顶要量页头与滚动区的高度；量错了栏会被页头盖住或伸出屏幕。用 Lab 的宽画布截图与 e2e 里的可见性断言看住。
- 风险：每次停顿发一次整篇。条目接近 1 MiB 时预览的结果会超出一次读取的预算，预览栏写“太长，预览不了”，编辑照常。
