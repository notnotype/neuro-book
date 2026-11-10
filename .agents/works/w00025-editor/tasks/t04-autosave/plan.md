# t04 实施计划：自动保存（第二稿）

第二稿按[第一稿的设计审查](evidences/design-review-disposition.txt)修订（fable 子代理，12 条：重要 5、建议 7）。

## 1. Context

- **为什么做**：编辑器只有手动保存（Ctrl+S、“未保存 N 个”），[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 把自动保存列在“不承诺”。t01 定下这一期要做，开发者 2026-10-15 同意：做成设置项，模式参照 VS Code，缺省“失焦时保存”。
- **期望结果**：写作时不用想着保存；保存不了的情形（磁盘冲突、未裁决输入、写不出、文件被删）仍然交给用户，不被自动保存盖过去。
- **开发者已确认的决定**：四种模式（关闭、停手若干毫秒后、失焦时、窗口失焦时）；缺省“失焦时”。其余都是本计划的推荐，照 autonomous-delivery 先做，记进 [待确认清单](../../pending-confirmations.md)。
- **工作方式**：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出）；Spec 与记录在主工作区的 master 上改。本会话的审查不用 omp，改派 fable 子代理（开发者 2026-11-10）。
- **不在范围**：未保存的修改跨页面刷新保留（仍是“不承诺”）；保存时格式化；按文件类型分别配置。配置项照缺省两层都能改（用户与作品），不另做限制。

## 2. 技术选型

无通用问题：定时用宿主时钟 `RuntimeClock`（`clockKey`，测试里换 `ManualClock`），设置用 `defineSetting`，响应用 `@vue/reactivity` 的 `watch`，都是编辑器区已在用的。

## 3. 参照：VS Code 的自动保存

对照的是 VS Code 的 `EditorAutoSave`、`FilesConfigurationService`、`TextFileEditorModel.save` 与 `EditorGroupView` 的关闭确认（作者与审查者都凭记忆，没有联网核对）：

| VS Code 的行为或设置 | 本计划 |
|---|---|
| `files.autoSave`: `off`、`afterDelay`、`onFocusChange`、`onWindowChange` | 做，同名四个值 |
| `files.autoSaveDelay`（毫秒，缺省 1000，最小 0） | 做，缺省 1000，最小 100 |
| 失焦时：活动编辑器失焦（编辑器部件一级，查找框不算）、换活动编辑器时保存它 | 做：视图发 `leave`，换下活动标签也算一次 |
| 窗口失焦在 `onFocusChange` 与 `onWindowChange` 两种模式下都保存全部 | 做 |
| `afterDelay` 模式下失焦不触发 | 做，同 |
| 文档处于保存冲突或上次保存出错时，自动保存跳过它，直到手动保存 | 做，另加本应用特有的几种（见 4.1） |
| 条件恢复后补存（“等条件”的表） | 做：可自动保存从假变真时重排 |
| 改了自动保存的设置，立即按新模式把 dirty 的文档存一次 | 做 |
| 自动保存失败与冲突有通知，带“重试”“比较”“覆盖” | 部分：冲突条已有“重新载入”“覆盖”；保存失败的横幅加“重试保存”；不另发通知 |
| 关闭 dirty 的编辑器：`onFocusChange` 下先保存不问；`onWindowChange` 只在桌面版的 Windows、Linux 上这样；短延迟的 `afterDelay` 把它当作正在保存直接关（模型不随标签丢弃）；保存失败再问 | 做，推广到全部三种开启的模式：这里文档随标签丢弃，所以等保存完成再关（推荐，待确认） |
| 延迟不超过 1000 毫秒的 `afterDelay` 下隐藏未保存圆点 | 不做：圆点如实显示，它是自动保存停下时用户唯一看得到的信号 |
| “文件 › 自动保存”菜单项与切换命令 | 不做：只有设置项（待确认） |
| `files.autoSaveWorkspaceFilesOnly`、`files.autoSaveWhenNoErrors` | 不做：没有工作区外的文件，也没有诊断 |
| 未命名文件不自动保存；按资源临时停用（Agent 正在改时） | 不适用：没有未命名文件；Agent 写的是磁盘，不是编辑器里的文档 |
| 桌面版关窗时先保存全部 | 网页做不到，保留离开确认；离开时顺手发一次保存（4.4） |

## 4. 关键设计

### 4.1 `packages/neuro-book/src/plugins/editor/web/auto-save.ts`（新）

不带界面，由 `createEditorArea` 创建并持有：

```ts
export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange" | "onWindowChange";
export interface AutoSaveSettings { readonly mode: AutoSaveMode; readonly delay: number }
export interface AutoSave {
    /** 用户离开了一份文档的视图：视图发 `leave`，或它被换下活动标签。 */
    viewLeft(document: TextDocument | null): void;
    /** 窗口失去焦点或页面被隐藏。 */
    windowBlurred(): void;
    /** 页面要离开了：不管哪种开启的模式，把能存的发出去（不等结果）。 */
    leaving(): void;
    /** 关闭标签前：这份需要结算的文档该不该不问就先保存（4.3）。 */
    savesOnClose(document: TextDocument): boolean;
    dispose(): void;
}
export function createAutoSave(options: {
    readonly documents: DocumentStore;
    readonly openDocuments: ComputedRef<ReadonlyArray<TextDocument>>;
    readonly clock: RuntimeClock;
    readonly settings: () => AutoSaveSettings;   // 响应式读取
    readonly report: (error: unknown) => void;
}): AutoSave;
```

- **没有阻碍**（`unobstructed(document)`，响应式）：文档还在 store 里、`writable`、`status === "ready"`，没有磁盘冲突（`conflict`）、“磁盘已变化”（`diskChanged`）、未裁决输入（`unresolved`）、写不出（`blocked`）、订阅结束（`ended`），也没有被本模块的失败闸挡住。**可自动保存** = 没有阻碍且 `dirty`。逐条的理由：
  - `deleted`：手动保存会在原路径重建文件（输出 18），这要用户决定；
  - 冲突、未裁决、写不出：`store.save` 本来就拒绝，不发无用的保存；
  - 磁盘已变化：这次保存的基线已经过期，结果只能是冲突，还会和用户正要点的“重新载入”竞争、挡住资源管理器的改名；等用户处理；
  - **失败闸**：某份文档的一次自动保存失败（冲突、未裁决、写不出之外的结果码）后，本模块记下它，不再自动保存这份文档；文档变干净，或它的 `saveProblem` 被清掉（一次手动保存成功、结果未知被核对为已落盘、重新载入）时复位。不借用 `saveProblem` 本身：手动保存失败之后，自动保存还可以再试一次。
- **触发**（模式不匹配时都是空操作）：
  - `viewLeft(document)`：`onFocusChange` 下保存这份文档；
  - `windowBlurred()`：`onFocusChange` 或 `onWindowChange` 下保存全部打开的文档；
  - `afterDelay`：`watch` 每份打开文档的 `revision` 与“可自动保存”：修订变了，或可自动保存从假变真，就重排一次 `clock.schedule(…, delay)`；不可自动保存、文档关闭、模式离开 `afterDelay`、`dispose` 时取消。定时按文档对象记（改名只换地址）。到点时这份文档有视图**手里还有没交出的输入或正在组字**（`documents.pending(document)`，见 4.2）就顺延一个 `delay`，不强制结算：否则会把输入法的半截拼音写进正文并落盘。`delay` 改了只影响之后排的定时；
  - 设置从别的模式换成任一开启的模式时，立即把可自动保存的文档存一次；
  - `leaving()`：模式不是 `off` 时把可自动保存的文档都发出保存。
- **保存**：先 `documents.settle(document)`（`afterDelay` 到点时已确认没有待交的输入，结算是空操作），判“可自动保存”，再 `documents.save(document)`。`save` 对已丢弃的文档同步抛错，调用前核对 `documents.get(地址) === document`，并把同步异常与 Promise 的拒绝都交 `report`。失败不另提示：结果在文档的 `saveProblem`、`conflict` 上，界面照现有规则显示；失败闸按上面的规则落下。
- 不变量：自动保存只调 `settle`、`pending` 与 `save`，不改正文、不裁决、不覆盖；同一份文档的保存仍由 store 排队（输出 14）。

### 4.2 控件合同、`web/documents/store.ts`、两个控件

- `TextEditorBinding.attach(flush, pending?)`：第二个参数可选，返回“这个视图手里有还没交给文档的输入，或正在组字”。store 的 `attachView` 一并登记，新增 `pending(document): boolean`（任一视图为真即真）。Markdown 控件交 `() => timer !== null || view.composing`（它停手 150 毫秒才交、组字期间不交）；源码编辑器按它现有的缓冲情况交（没有缓冲就不传）。
- 控件事件加可选的 `leave()`：用户的焦点离开了这个视图。源码编辑器在 `onDidBlurEditorWidget` 时发（焦点进它自己的查找框不算离开）；Markdown 控件在编辑内核 blur 时发：焦点进它自己的下拉菜单、右键菜单与链接、注音的输入框也算离开，这时保存的是操作中途的正文，操作完成后再变 dirty、下次离开再存，写进 Spec。现有的 `focus(boolean)` 语义不动（它喂的是“编辑器区有没有焦点”）。
- store 的 `adopt`（采纳磁盘内容：重新载入、外部修改）清掉 `saveProblem`：正文已经是磁盘内容，那次失败的保存不再相关。现在重新载入之后横幅仍写“保存失败”，一并修掉，用例补在 `documents.test.ts` 的还原一组。

### 4.3 `web/area.ts`、`web/session.ts`、组件

- `EditorAreaOptions.autoSave?: () => AutoSaveSettings`，经 `session.ts` 透传，写法照 `enablePreview`。缺省等于 `off`：Lab 与合同测试不经插件建编辑器区，不该被设置项的缺省（失焦时）改变；注释写明这一点。
- `EditorArea` 加 `viewLeft(tabId)`、`windowBlurred()`、`leaving()`，转给 4.1。`EditorGroup.vue` 监听控件的 `leave` 调 `area.viewLeft(item.tabId)`；页面标签、字节标签没有文本文档，是空操作。
- **换下活动标签算一次离开**：`leave(groupId)` 放行（返回真）时，对被换下的那份文档调 `autoSave.viewLeft`。不靠“聚焦的元素被隐藏时浏览器发不发 blur”。
- **关闭时不问**（`closeOne`）：要询问之前，如果这个标签是文档最后一个能编辑的标签、视图自己没有未裁决输入与写不出、`autoSave.savesOnClose(document)` 为真（模式不是 `off` 且文档没有阻碍；不要求 dirty：只剩排队的保存时同样只等不问），并且这一次关闭还没有自动试过，就直接 `documents.save`；成功回到循环开头照常关闭，失败落到原来的询问。“试过”用 `closeOne` 里的局部标志记，不靠状态恰好留下记号。批量关闭经 `closeOne`，行为随之一致。
- `changeEditor`（文本换成字节编辑器）遇到在途保存时照旧拒绝，不改：失焦触发的保存还没完成时会被拒一次，重试即可（待确认清单）。
- `EditorGroup.vue` 的保存失败横幅加动作“重试保存”（执行 `area.save()`）。

### 4.4 `web/plugin.ts`

- 把两项设置读成 `autoSave: () => ({mode: settings.get(autoSaveSetting), delay: settings.get(autoSaveDelaySetting)})` 交给 session。
- 在登记 `beforeunload` 的地方加窗口的 `blur` 与 `document` 的 `visibilitychange`（`hidden` 时）监听，调 `windowBlurred()`，随 `context.signal` 移除。`blur` 里先看 `document.hasFocus()`：焦点进了同页的 iframe（HTML 预览）时它仍为真，不算窗口失焦。两个事件常常先后都到，第二次时文档已不 dirty 或并进排队的保存，不另去重。
- `beforeunload`（输出 21）照旧请求离开确认，另调一次 `leaving()`：用户在确认框里选留下时正文已经存好；不依赖它在卸载前完成。页面卸载时也会有 `visibilitychange`，这时触发的保存同样无害。

### 4.5 `shared/settings.ts` 与 `locales/`

“编辑器”分区在“标签”与“代码编辑器”之间加小组 `saving`（“保存”）：

| 键 | 形状 | 缺省 |
|---|---|---|
| `nbook.editor/autoSave` | `off`、`afterDelay`、`onFocusChange`、`onWindowChange` | `onFocusChange` |
| `nbook.editor/autoSaveDelay` | 整数 100–600000，单位毫秒 | 1000 |

设置窗口没有“按另一项的值显示或隐藏”，`autoSaveDelay` 一直显示，说明里写“只在‘停手后’时生效”。两项照缺省在用户层与作品层都能改。中英文案（含横幅的“重试保存”）进 `locales/zh-CN.json`、`en-US.json`。

## 5. Spec 与文档改动

- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：
  - “不承诺”去掉“自动保存”，留下“未保存的修改跨页面刷新保留”；
  - 控件合同：`attach` 的第二个参数与事件 `leave`；
  - 输出 4 加一句：开着自动保存且文档没有阻碍时不问，先保存，失败再问；
  - 输出 21：离开时顺手发出保存；输出 23–25 加一句（缺省模式下焦点到资源管理器时文档多半已保存，这几条询问主要留给“关闭”“停手后”与存不了的文档）；输出 26 的说明（缺省模式下条目主要在输入时与保存失败时出现）；
  - 输出 52 的设置加“保存”小组两项；
  - 新增输出 63“自动保存”：四种模式、什么算离开视图、停手从最后一次输入算且组字期间不触发、可自动保存的条件、失败后停下与怎样恢复、改设置立即存一次、窗口失焦的判据；写明缺省模式下“不保存”与“还原文件”实际上够不着（关闭不再问，去执行还原时焦点一离开正文就已保存），回退靠撤销；
  - “失败与恢复”表的保存失败一行（自动保存就此停下、重试保存）；“时序与寿命”加定时的寿命；
  - 验收场景 35–39，Smoke、实现合同（不变量一条）、证据。
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)、[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)：有逐项列举编辑器设置的地方就补上（实施时核对）。
- 组件文档 `EditorGroup.md`（`leave` 与“重试保存”）、`MonacoControl.md`。

## 6. 切片

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| 1 | Spec（主工作区 master） | 5 | `bun run docs:check`、`governance:check` |
| 2 | store 的 `pending` 与 `adopt` 清 `saveProblem`；`auto-save.ts`；area 与 session 接线、换标签、关闭时不问；`auto-save.test.ts`、`documents.test.ts` | 4.1–4.3 | 编辑器的 Bun 测试文件 |
| 3 | 设置项、文案、`plugin.ts` 的窗口监听、控件的 `pending` 与 `leave`、`EditorGroup.vue` 的接线与“重试保存”；组件测试 | 4.2–4.5 | 编辑器、Markdown 的 Bun 与组件测试，`bun run typecheck` |
| 4 | e2e：新文件 `e2e/editor-autosave.e2e.ts`；现有用例先静态过一遍，前提是“输入后失焦仍未保存”的在启动处写 `"nbook.editor/autoSave": "off"`；`workbench-titlebar` 那条把断言移出回调 | 7、8 | 见第 8 节 |

每片单独提交；Spec 在主工作区路径限定提交。

## 7. 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 63 离开视图时保存、其它模式不触发；换下活动标签也保存 | `auto-save.test.ts`“离开视图” |
| 输出 63 窗口失焦在两种模式下保存全部 | `auto-save.test.ts`“窗口失焦” |
| 输出 63 停手后：到点保存、继续输入重排、手动保存后不再写、视图有待交输入时顺延 | `auto-save.test.ts`“停手后”（`ManualClock`，写入次数用 `createLinkTap` 数） |
| 输出 63 条件恢复后补存：结果未知核对成功、采用当前正文、手动保存慢于延迟 | 同上 |
| 输出 63 不自动保存：冲突、磁盘已变化、未裁决、写不出、被删除、只读 | `auto-save.test.ts`“不自动保存的情形” |
| 输出 63 失败闸：自动保存失败后停下；重新载入后再输入、手动保存成功后恢复 | 同上（真实 Files 场地，目录设只读造成失败） |
| 输出 63 改设置立即存一次、切走取消定时；离开时发出保存 | `auto-save.test.ts`“设置变化” |
| 输出 63 租约期间触发的保存等租约结束、改名后存到新地址；自己的写入回声不让文档出现“磁盘已变化”或冲突 | `auto-save.test.ts`“与资源管理器、磁盘事件” |
| 输出 4 关闭时不问、保存失败再问、保存期间继续输入、另一组打开同一文件、批量关闭遇失败停在询问；`off` 照旧问 | `auto-save.test.ts`“关闭”；`area.test.ts` 的原用例不改 |
| 还原后不再显示保存失败 | `documents.test.ts` 的还原一组 |
| 控件发 `leave` 到文档落盘；横幅“重试保存” | `EditorGroup.dom.test.ts` |
| Markdown 控件的 `pending` 在组字与缓冲时为真 | `MarkdownControl.dom.test.ts` |
| 输出 52 设置项与缺省 | `locales.test.ts`、e2e |
| 场景 35–39 | `e2e/editor-autosave.e2e.ts`：真实键盘输入后点资源管理器，磁盘更新、圆点消失；键盘换到同组另一个标签，旧文件落盘；输入后关闭标签不询问；设置改成“关闭”后失焦仍未保存；“停手后”到点保存，组字期间不保存（CDP `Input.imeSetComposition`，写法照 `markdown-input.e2e.ts`）；源码编辑器按 Ctrl+F 进查找框不保存；窗口失焦（见第 9 节风险 3） |

测试都在真实 Files 场地上跑，断言磁盘内容与文档状态，不断言内部调用。

## 8. 验证

- 实施中：改了什么跑覆盖它的 Bun 与组件测试文件；e2e 只跑 `editor-autosave`。
- 合入前跑一次（10 个文件，超过 8 个）：`NB_E2E_WIDE="自动保存缺省改为失焦时保存，凡是输入后失焦的用例都可能受影响，要确认关掉自动保存的用例与缺省模式下的其余用例都成立"`，文件为 `editor-autosave`、`editor-area`、`editor-types`、`markdown-editing`、`markdown-input`、`files-explorer`、`workbench-shell`、`workbench-titlebar`、`bookshelf-stats`、`settings`。跑之前先静态过一遍这些文件：断言放在“只在某条件下才触发的回调”里的用例不会失败、只会空过，要逐个读。
- `bun run test:affected --typecheck`、`docs:check`、`governance:check`。
- 变异检查：去掉“没有阻碍”里的各个条件、去掉重排定时、去掉顺延、把 `savesOnClose` 写死为假、去掉失败闸的复位，对应用例应失败。
- 未验证边界：真实窗口切换（操作系统层面的失焦）只按事件模拟；触摸设备上的失焦。

## 9. 不做与风险

- **不做**：跨刷新保留未保存修改；短延迟下隐藏未保存圆点；“文件 › 自动保存”菜单项、切换命令与状态栏上的模式显示；连接恢复时自动重试（靠横幅的“重试保存”与状态栏的错误态）；保存前的快照或本地历史；资源管理器复制前的询问（输出 23）不因自动保存改变；“停手后”模式不区分会被别的程序即时读取的文件（设置文件、插件源码每次停手都落盘）；关闭时等保存期间不另给进度提示（手动选“保存”之后今天也没有）。
- **风险 1：Markdown 自己的菜单与输入框算离开。** 保存不改正文、不动光标，后果是多几次写入、磁盘上短暂有操作中途的正文；`markdown-editing.e2e.ts` 的现有用例在缺省模式下照跑，核对正文与光标不受影响。
- **风险 2：缺省值改变现有 e2e。** 见第 8 节；关掉自动保存的用例测的是手动保存的合同，这个合同在 `off` 下仍然有效，不算放宽断言。
- **风险 3：窗口失焦的 e2e。** 无头 Chrome 里另开一页多半不会让原页变 `hidden`；在页面里派发 `blur`、`visibilitychange` 事件，并在证据里写明是模拟。`document.hasFocus()` 的过滤用“焦点在 HTML 预览的 iframe 里时不保存”的用例兜底。
- **风险 4：`afterDelay` 下状态栏“未保存 N 个”与标签圆点会闪。** 缺省模式不受影响；如实显示。

## 待确认项

1. 关闭时不问推广到三种开启的模式，等保存完成再关（VS Code 只对失焦时这样做，短延迟是直接关）。连带的后果：缺省模式下“不保存”与“还原文件”实际上够不着，回退靠撤销。
2. `afterDelay` 下不隐藏未保存圆点与状态栏条目。
3. `autoSaveDelay` 的范围 100–600000 毫秒、缺省 1000；两项设置在用户层与作品层都能改。
4. 文件被其它来源删除后不自动重建；磁盘已变化时不自动保存；一次自动保存失败后停下，直到文档变干净或一次保存成功。
5. 窗口失焦的判据：窗口 `blur`（焦点进同页 iframe 不算）或页面 `visibilitychange` 为 `hidden`。
6. 不做“文件 › 自动保存”菜单项、切换命令与状态栏显示；不做连接恢复时的自动重试与本地历史。
7. Markdown 自己的菜单与输入框拿走焦点也算离开视图；源码编辑器的查找框不算。
