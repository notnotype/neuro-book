# t39 实施计划：条目主文字的整篇编辑

状态：第 3 稿（2026-11-24）。第 1、2 稿是富文本（开发者确认过）；前端设计审查（[报告](evidences/design-review-frontend-sonnet.txt)、[处理](evidences/design-review-resolution.txt)）指出富文本建在第二套解析器上要补的东西很多，开发者改定：“先做乙，这种模式用起来也还算顺手，以后再做实时预览。也不阻塞。同意尽快把垂直切片做通，用起来。”本稿是乙：整篇源文字的编辑。

## 1. Context

开发者试用 t28 的按块编辑后说“编辑起来不顺畅，查看起来也不好看”，定“第一版没必要分节”（[调研记录](../../research/2026-11-24-entry-text-direction.md)）。期望结果：作者点“编辑”，在一个输入框里写整篇主文字的源文字，引用设定组的数据，提交后在阅读视图里看到结果。

约束：内核与写法（`{字段}`、`<Ref>`、`<Image>`）不动；不做富文本、不做实时预览（以后）；尽快做通、能用。

依据的 Spec：[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输出 39、44 到 47 与验收 16（本稿同步改写，planned）；[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 68、69（t28 已做）。

## 2. 技术选型

无新的通用问题。输入框用 t28 接好的代码输入框（编辑器插件交出的 Monaco 组件，退路是 `PlainSourceInput`）；暂存、提交、多窗口用 t28 的稿会话。

## 3. 关键设计（`packages/neuro-book/src/plugins/canon/web/`）

### 3.1 整篇的稿（`text-whole.ts` 新，`text-draft.ts`、`text-drafts.ts` 小改）

- `TextDraft` 加可选字段 `whole: {base: string; text: string}`：`base` 是开始编辑（或作者上一次在冲突里认下）时读到的整篇，`text` 是作者的整篇。暂存的格式同步加这个可选字段。
- `text-whole.ts`（纯函数）：
  - `joinBlocks(read)`：各块的原文用一个空行连起来。
  - `wholeProblem(read)`：这次读到的块能不能整篇改：有被剧情变更碰过的块（改第一块的字不是写到初值，或别的块删不了，用 `allowed`）给 `story`；块数超过 `SUBMIT_OPS_MAX` 给 `too-many`；能改给 null。
  - `wholeDraft(read, at, whole)`：在这次读到的块上重新编出稿：`text` 与 `joinBlocks(read)` 相同时是没有改动的稿；否则第一块 `setText` 成整篇、其余 `removeBlock`，没有块时 `addAfter(null)`，整篇为空白时全部删掉。结果带着 `whole`。
  - `realign(draft, read)`：会话每次重读后调用（代替 `rebase`）：读到的整篇记作 `theirs`；`wholeProblem(read)` 非空给一条冲突 `{kind: "whole", mine, theirs, locked: 原因}`；`theirs` 与 `base`、与 `text` 都不同给 `{kind: "whole", mine, theirs}`；否则没有冲突。稿一律换成 `wholeDraft(read, at, whole)`。
  - 没有 `whole` 的旧稿（t28 的按块的稿）：`realign` 先把它换算成整篇（各块现在的文字连起来），`base` 取 `theirs`。
- `text-draft.ts`：`Conflict` 加 `whole` 这一种；`resolve` 对它：`mine` 把 `whole.base` 设成 `theirs`（认下别处的版本、以我的为准），`theirs` 回到没有改动的稿。拆与并的函数不动。
- `text-drafts.ts`：`align` 里有 `whole` 的稿、与读进来的没有 `whole` 却有改动的稿走 `realign`；`begin` 建的稿带 `whole`（`base` 与 `text` 都是读到的整篇）；暂存的 schema 加 `whole`。别的（冻结、结局不明、另一窗口）不动。

### 3.2 文字分页（`text-tab.ts`、`components/EntryTextEditor.vue`、`TextConflictDialog.vue`、`EntryPageHost.vue`、`EntryText.vue`）

- `text-tab.ts`：编辑视图的属性从块的列表换成 `text`（稿的整篇；读不出块时也给稿里的）与 `problem`（内核拒收的原因、行、列）；动作只剩 `update(text)`、`insert(snippet, offset)`、提交、放弃、另一窗口的两个选择、再试。`start()` 在 `wholeProblem` 非空时不进编辑、返回原因。冲突只有一条，对话框的两个选择对应 `mine`、`theirs`；`locked` 的只能照现在的来。
- `EntryTextEditor.vue`：状态行与各状态照旧（正在确认、另一个窗口也在改、读不出位置时只列稿），块的列表换成一个输入框，去掉块的增、拆、并、删、恢复；状态行加“插入”（nb-ui 的下拉菜单，条目有字段时才出）：本条目各设定组的字段。插入的位置取输入框的 `cursorOffset()`，取不到时接在末尾。条目引用要另接条目选择器的对话框，这一版不做。
- `TextConflictDialog.vue`：仍是并排对照加选择，条目只有一条，标题里的“第 N 块”换成“主文字”。
- `EntryPageHost.vue`：接上面的属性与动作；删掉每块的剧情菜单、文末“在剧情里加一块”与它们的对话框代码（`text-tab.ts` 的 `storyWrite` 一并删）。
- `EntryText.vue`：去掉 `story` 属性与剧情菜单；排版改用章节的正文样式（`@notnotype/nb-markdown/markdown.css` 的类），值按钮、来历照旧。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/canon/author-ui.md` | “不承诺”两条、输出 9、10 的措辞、输出 39、44 改写、45 到 47 的措辞、输出 43 去掉“主文字的块”、验收 16 改写（已随本稿改好，planned） |
| 组件同名 `.md` | `EntryTextEditor.md`、`EntryText.md`、`TextConflictDialog.md`、`EntryPageHost.md` |
| `pending-confirmations.md` | 多块并成一块改掉 `text[块]` 引用（已知限制）；超过 50 块、有随剧情变的段落的条目进不了编辑；空条目仍要点一下“开始写”；拿掉主文字的剧情菜单 |

## 5. 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | 3.1 整篇的稿与会话 | `text-whole.test.ts`、`text-drafts-link.test.ts`（真实世界服务）、typecheck |
| S2 | 3.2 宿主逻辑、编辑视图、对话框、页面接线，删掉按块的界面与剧情菜单 | `text-tab.test.ts`、相关 dom 测试、typecheck |
| S3 | 阅读视图换章节的排版；Lab 场景与截图（亮色，含 390 宽） | dom 测试、`nbdev shot` |
| S4 | e2e（`canon-write` 里按块编辑与剧情菜单的用例改写）、实现审查（Sonnet）、合入 | 重新构建后跑受影响的 e2e 文件 |

## 6. 验收映射

| 场景（Spec author-ui） | 覆盖 |
|---|---|
| 输出 39：点“编辑”得到读到的各块连成的整篇；提交后是一块 | `text-tab.test.ts`（真实世界服务）；e2e |
| 输出 39：有随剧情变的段落、超过 50 块的条目进不了编辑并写原因 | `text-whole.test.ts`；`text-tab.test.ts` |
| 输出 39：“插入”在光标处写入字段的写法 | `EntryTextEditor.dom.test.ts`；e2e |
| 输出 44：别处没动整篇时不问（别处改了别的东西）；别处改了、加了块、删了块都问一次；两边一样不问 | `text-whole.test.ts`；`text-drafts-link.test.ts` |
| 输出 44：选“我的”以我的为准；选“现在的”回到阅读视图；再被改要再问 | `text-tab.test.ts` |
| 输出 44：内核拒收时原因写在输入框下面，稿还在 | `text-tab.test.ts` |
| 输出 45、46：暂存、圆点、位置锁定、结局不明、另一窗口 | 现有用例改成整篇后保留 |
| t28 的按块的稿读进来换算成整篇 | `text-drafts-link.test.ts` |
| 验收 16 | e2e `canon-write` |

## 7. 验证

各片跑受影响的测试；S4 重新构建三份产物后跑 `e2e/canon-write.e2e.ts` 与 `e2e/canon-author.e2e.ts`（1440 视口）。真实浏览器里走一遍：打开星瑕、点“编辑”、改一句、插入一个字段、提交、看阅读视图。没有验证的边界：两个窗口同时编辑沿用 t28 的用例。

## 8. 不做与风险

- 不做：富文本、实时预览、主文字的剧情变化、换解析器与换写法、标签登记表、沙箱块。
- 已知限制：多块的条目提交后并成一块，别处对 `text[块]` 的引用会变；空条目仍要点一下“开始写”。
- 风险：`realign` 每次重读都重新编稿，依赖“稿里只有整篇是真相”；用真实世界服务的用例覆盖别处加块、删块、改字三种。
- 留下的债：`text-draft.ts` 的拆与并与 `rebase` 的按块冲突没有调用方，t38 定了以后要么用上、要么删。
