# t04 实施计划：自动保存

## 1. Context

- **为什么做**：编辑器只有手动保存（Ctrl+S、“未保存 N 个”），[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 把自动保存列在“不承诺”。t01 定下这一期要做，开发者 2026-10-15 同意：做成设置项，模式参照 VS Code，缺省“失焦时保存”。
- **期望结果**：写作时不用想着保存；保存不了的情形（磁盘冲突、未裁决输入、写不出、文件被删）仍然交给用户，不被自动保存盖过去。
- **开发者已确认的决定**：四种模式（关闭、停手若干毫秒后、失焦时、窗口失焦时）；缺省“失焦时”。其余都是本计划的推荐，照 autonomous-delivery 先做，记进 [待确认清单](../../pending-confirmations.md)。
- **工作方式**：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出）；Spec 与记录在主工作区的 master 上改。本会话的审查不用 omp，改派 fable 子代理（开发者 2026-11-10）。
- **不在范围**：未保存的修改跨页面刷新保留（仍是“不承诺”）；保存时格式化；按文件类型或按作品分别配置。

## 2. 技术选型

无通用问题：定时用宿主时钟 `RuntimeClock`（`clockKey`，测试里换 `ManualClock`），设置用 `defineSetting`，响应用 `@vue/reactivity` 的 `watch`，都是编辑器区已在用的。

## 3. 参照：VS Code 的自动保存

读的是 VS Code 的 `EditorAutoSave`、`FilesConfigurationService` 与 `TextFileEditorModel.save`（凭记忆整理，审查时请对照源码核对）：

| VS Code 的行为或设置 | 本计划 |
|---|---|
| `files.autoSave`: `off`、`afterDelay`、`onFocusChange`、`onWindowChange` | 做，同名四个值 |
| `files.autoSaveDelay`（毫秒，缺省 1000） | 做，缺省 1000 |
| 失焦时：活动编辑器失焦、换活动编辑器时保存它 | 做：某个标签的控件失焦就保存它的文档 |
| 窗口失焦在 `onFocusChange` 与 `onWindowChange` 两种模式下都保存全部 | 做 |
| `afterDelay` 模式下失焦不触发 | 做，同 |
| 文档处于保存冲突或上次保存出错时，自动保存跳过它，直到用户手动保存 | 做，另加本应用特有的几种（见 4.1 的“可自动保存”） |
| 关闭 dirty 的编辑器：`onFocusChange` 下直接保存不问；保存失败再问 | 做，并推广到全部三种开启的模式（推荐，待确认） |
| 延迟很短的 `afterDelay` 下隐藏标签上的未保存圆点 | 不做：圆点如实显示 |
| `files.autoSaveWorkspaceFilesOnly`、`files.autoSaveWhenNoErrors` | 不做：没有工作区外的文件，也没有诊断 |
| 未命名文件不自动保存 | 不适用：没有未命名文件 |

## 4. 关键设计

### 4.1 `packages/neuro-book/src/plugins/editor/web/auto-save.ts`（新）

一个不带界面的模块，由 `createEditorArea` 创建并持有：

```ts
export type AutoSaveMode = "off" | "afterDelay" | "onFocusChange" | "onWindowChange";
export interface AutoSaveSettings { readonly mode: AutoSaveMode; readonly delay: number }
export interface AutoSave {
    /** 一个标签的视图失去焦点（控件 `focus(false)`）。 */
    viewBlurred(document: TextDocument | null): void;
    /** 窗口失去焦点或页面被隐藏。 */
    windowBlurred(): void;
    /** 关闭标签前：这种模式下该不该不问就先保存（4.3）。 */
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

- **可自动保存**（`eligible(document)`，先 `documents.settle(document)` 再判）：`dirty`、`writable`、`status === "ready"`，并且没有磁盘冲突（`conflict`）、未裁决输入（`unresolved`）、写不出（`blocked`）、订阅结束（`ended`）、上次保存的错误（`saveProblem`）。逐条的理由：
  - `deleted`：手动保存会在原路径重建文件（输出 18），这是要用户决定的事，自动保存不替他重建；
  - 冲突、未裁决、写不出：`store.save` 本来就拒绝，这里提前跳过，不发无用的保存、不留下 `saveProblem`；
  - `saveProblem`：上次保存失败（断线、权限）后停下，直到一次手动保存成功，避免 `afterDelay` 下反复重试；状态栏的“未保存”条目此时已是错误状态（输出 26）。
  - dirty 且“磁盘已变化”的文档**照常尝试**：保存得到磁盘冲突，组顶部出现冲突条（输出 15），之后因冲突而跳过。这样用户在失焦时就看到冲突，不用等到手动保存。
- **触发**：
  - `viewBlurred(document)`：模式是 `onFocusChange` 时保存这份文档；
  - `windowBlurred()`：模式是 `onFocusChange` 或 `onWindowChange` 时保存全部打开的文档；
  - `afterDelay`：`watch` 每份打开的文档的 `revision` 与 `dirty`；dirty 的文档每次修订变化都重排一次 `clock.schedule(…, delay)`，到点保存；文档变干净、关闭、模式离开 `afterDelay` 时取消；模式切到 `afterDelay` 时给已经 dirty 的文档排上。`delay` 改了只影响之后排的定时。
- **保存**：直接 `documents.save(document)`（它自己排队、等租约、结算视图输入），失败不提示：结果已在文档的 `saveProblem`、`conflict` 上，界面照现有规则显示。Promise 的拒绝交 `report`。
- 不变量：自动保存只调 `settle` 与 `save`，不改正文、不裁决、不覆盖；同一份文档的保存仍由 store 排队（输出 14）。

### 4.2 `web/area.ts`、`web/session.ts`、`web/components/EditorGroup.vue`

- `EditorAreaOptions.autoSave?: () => AutoSaveSettings`（缺省等于 `off`，现有 Bun 与组件测试不受影响），经 `session.ts` 透传，写法照 `enablePreview`。
- `EditorArea` 加 `viewBlurred(tabId)` 与 `windowBlurred()`，转给 4.1。`EditorGroup.vue` 的 `@focus` 处理在 `focused` 为假时多调一次 `area.viewBlurred(item.tabId)`。
- 页面标签、字节标签没有文本文档，`viewBlurred` 对它们是空操作。

### 4.3 关闭时不问（`area.ts` 的 `closeOne`）

`closeOne` 在要询问之前：这个标签是文档最后一个能编辑的标签、`autoSave.savesOnClose(document)` 为真（模式不是 `off` 且文档可自动保存）时，不弹“保存 / 不保存 / 取消”，直接 `documents.save`；成功则回到循环开头照常关闭，失败则落到原来的询问（只试一次，之后 `saveProblem` 使它不再可自动保存）。视图自己有未裁决输入或写不出时照旧询问。批量关闭经 `closeOne`，行为随之一致。

### 4.4 `web/plugin.ts`

- 把两项设置读成 `autoSave: () => ({mode: settings.get(autoSaveSetting), delay: settings.get(autoSaveDelaySetting)})` 交给 session。
- 在登记 `beforeunload` 的地方加窗口的 `blur` 与 `document` 的 `visibilitychange`（`hidden` 时）监听，调 `session.area.value?.windowBlurred()`，随 `context.signal` 移除。
- `beforeunload`（输出 21）不变：离开时仍有未保存的就请求确认。页面卸载时发出的保存不保证完成，所以不在这里触发自动保存。

### 4.5 `shared/settings.ts` 与 `locales/`

“编辑器”分区在“标签”与“代码编辑器”之间加小组 `saving`（“保存”）：

| 键 | 形状 | 缺省 |
|---|---|---|
| `nbook.editor/autoSave` | `off`、`afterDelay`、`onFocusChange`、`onWindowChange` | `onFocusChange` |
| `nbook.editor/autoSaveDelay` | 整数 100–600000，单位毫秒 | 1000 |

设置窗口没有“按另一项的值显示或隐藏”，`autoSaveDelay` 一直显示，说明里写“只在‘停手后’时生效”。中英文案进 `locales/zh-CN.json`、`en-US.json`。

## 5. Spec 与文档改动

- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：
  - “不承诺”去掉“自动保存”，留下“未保存的修改跨页面刷新保留”；
  - 输出 4 加一句：开着自动保存且文档可自动保存时不问，先保存，失败再问；
  - 输出 52 的设置加“保存”小组两项；
  - 新增输出 63“自动保存”（四种模式、触发、可自动保存的条件、失败后停下、与输出 14、15、18、61 的关系）；
  - 验收场景 35–38，Smoke、实现合同（不变量一条）、证据。
- [`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)、[`settings/configuration.md`](../../../../../docs/specs/settings/configuration.md)：有逐项列举编辑器设置的地方就补上，没有就不动（实施时核对）。
- Work README：推进顺序与分支一节更新；待确认清单新建。

## 6. 切片

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| 1 | Spec 输出 63 等（主工作区 master） | 5 | `bun run docs:check`、`governance:check` |
| 2 | `auto-save.ts`、area 与 session 接线、关闭时不问；`auto-save.test.ts` | 4.1–4.3 | `bun test src/plugins/editor`（包目录） |
| 3 | 设置项、文案、`plugin.ts` 的窗口监听、`EditorGroup.vue`；`locales.test.ts` 等 | 4.2、4.4、4.5 | `bun run test`（编辑器与设置相关文件）、`bun run typecheck` |
| 4 | e2e：新文件 `e2e/editor-autosave.e2e.ts`；现有依赖“失焦后仍未保存”的文件在各自的启动处写 `"nbook.editor/autoSave": "off"` | 7 | 见第 8 节 |

每片单独提交；Spec 在主工作区路径限定提交。

## 7. 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 63 失焦时保存、其它模式不触发 | `auto-save.test.ts`“失焦” |
| 输出 63 窗口失焦在两种模式下保存全部 | `auto-save.test.ts`“窗口失焦” |
| 输出 63 停手后：到点保存、继续输入重排、手动保存后不再写、切换模式 | `auto-save.test.ts`“停手后”（`ManualClock`，写入次数用 `createLinkTap` 数） |
| 输出 63 跳过：冲突、未裁决、写不出、被删除、只读、上次保存失败 | `auto-save.test.ts`“不自动保存的情形” |
| 输出 63 dirty 且磁盘已变化：尝试一次、出现冲突、之后不再写 | 同上 |
| 输出 4 关闭时不问、保存失败再问、`off` 照旧问 | `auto-save.test.ts`“关闭”；`area.test.ts` 的原用例不改 |
| 输出 52 设置项与缺省 | `locales.test.ts`、设置声明的既有测试；e2e |
| 场景 35–38 | `e2e/editor-autosave.e2e.ts`：真实键盘输入后点资源管理器（失焦）磁盘更新、圆点消失；输入后关闭标签不询问；设置改成“关闭”后失焦仍未保存；“停手后”到点保存；窗口失焦（见第 9 节的风险） |

测试都在真实 Files 场地上跑，断言磁盘内容与文档状态，不断言内部调用。

## 8. 验证

- 实施中：改了什么跑覆盖它的 Bun 与组件测试文件；e2e 只跑 `editor-autosave`。
- 合入前跑一次（9 个文件，超过 8 个）：`NB_E2E_WIDE="自动保存缺省改为失焦时保存，凡是输入后失焦的用例都可能受影响，要找出哪些文件依赖“失焦后仍未保存”"`，文件为 `editor-autosave`、`editor-area`、`editor-types`、`markdown-editing`、`markdown-input`、`files-explorer`、`workbench-shell`、`bookshelf-stats`、`settings`。失败项逐个判断：依赖手动保存语义的用例在启动处关掉自动保存；其余按产品缺陷查。
- `bun run test:affected --typecheck`、`docs:check`、`governance:check`。
- 变异检查：去掉 `eligible` 里的各个条件、去掉重排定时、把 `savesOnClose` 写死为假，对应用例应失败。
- 未验证边界：真实窗口切换（操作系统层面的失焦）只按事件模拟；触摸设备上的失焦。

## 9. 不做与风险

- **不做**：跨刷新保留未保存修改；短延迟下隐藏未保存圆点；换活动标签单独作为触发（焦点在视图里时换标签已经有失焦；焦点不在视图里的 dirty 文档由窗口失焦兜底）；资源管理器复制前的询问（输出 23）不因自动保存改变。
- **风险 1：失焦事件比预想的多。** 焦点从正文移到编辑器自己的浮层（Markdown 工具栏、选区菜单、Monaco 查找框）也会发 `focus(false)`，于是保存一次。保存不改正文、不动光标，后果只是多几次写入；由 e2e 在真实浏览器里用工具栏操作后核对正文与光标不变来兜底（`markdown-editing.e2e.ts` 的现有用例在缺省模式下照跑）。
- **风险 2：缺省值改变现有 e2e。** 见第 8 节；关掉自动保存的用例测的是手动保存的合同，这个合同在 `off` 下仍然有效，不算放宽断言。
- **风险 3：窗口失焦的 e2e。** 无头 Chrome 里未必能产生真实的窗口失焦；先试 `visibilitychange`（另开一页并切到前台），不行就在页面里派发 `blur` 事件，并在证据里写明是模拟。
- **风险 4：`afterDelay` 下状态栏“未保存 N 个”与标签圆点会闪。** 缺省模式不受影响；如实显示，是否隐藏留给开发者（待确认清单）。

## 待确认项

1. 关闭时不问推广到三种开启的模式（VS Code 只对失焦时与短延迟这样做）。
2. `afterDelay` 下不隐藏未保存圆点与状态栏条目。
3. `autoSaveDelay` 的范围 100–600000 毫秒、缺省 1000。
4. 文件被其它来源删除后不自动重建；上次保存失败后停下，直到手动保存成功。
5. 窗口失焦的判据：窗口 `blur` 或页面 `visibilitychange` 为 `hidden`。
