---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.editor
owners:
  - nbook.editor
---

# 编辑器区

## 目标与非目标

主页面的编辑器区：插件 `nbook.editor` 把打开的文件放进编辑组与标签，持有每份打开文件的权威正文与磁盘基线，用 Markdown 富文本或源码编辑器编辑，按基线保存并处理冲突与外部修改；资源管理器复制、移动、删除前经它结算未保存的修改；页面因服务端重启或项目关闭进入终态时，未保存的正文仍可取回。

不承诺：

- 拖动标签换组、拖到边缘拆分、固定标签与多行标签条（随编辑器拖放另行交付）；面包屑、编辑器工具栏、状态栏的文档项。
- 自动保存；未保存的修改跨页面刷新保留。
- Markdown 富文本里的批注侧栏、选区浮动菜单、斜杠命令、Agent 与 AI 引用、工作区引用标签、frontmatter 面板（这些语法在正文里原样保留，见输出 19）。
- 差异比较界面；跨文件撤销；同一文档在两个组里共享撤销历史。
- 预读；`project://`、`user://` 之外的方案。
- [files-explorer 的性能标准](files-explorer.md#打开与切换)在参考机器上的测量另行交付；本 Spec 只规定结构上的保证（输出 7、10）。

## 术语与参与者

- **文档**：一份打开文件在本窗口里的权威正文、磁盘基线与状态，按资源地址唯一；同一文件在几个组里打开也只有一份文档。
- **磁盘基线**：沿 [workspace.files](../workspace/files.md#读取与保存)，读取或保存时确认的内容哈希。
- **dirty**：文档正文与它的基线对应的正文不同。
- **编辑组**：编辑器区里一个有自己标签条与内容区的窗格；组按 grid 排列。
- **标签**：文档在一个组里的打开实例，记着用哪种编辑器；`preview` 标签会被同组下一次 preview 打开替换，`permanent` 不会。
- **视图**：标签在内容区里的编辑器实例，有自己的光标、滚动与撤销历史；同组同种编辑器共用一个控件，切换文档时换内容与视图状态。
- **输入回执**：视图把输入交给文档时带上它看到的正文修订；修订已过期且内容不同时，这份输入不进入正文，成为**未裁决输入**，留在产生它的视图里等用户裁决。
- **磁盘冲突**：保存时磁盘基线已经不是文档的基线。
- **文档身份**：`{workspaceKey, generation, documentId, path}`，沿[命令目录](commands.md)`nbook.editor.go-to-line` 的四字段；改名只换 `path`，项目换代换 `generation`。

## 输入与前置条件

- 插件 `nbook.editor` 只有浏览器入口；依赖 `nbook.files` 的文件客户端、命令服务、Storage、窗口的项目绑定、配置、宿主时钟与宿主的抢救能力（[runtime.browser-host](../runtime/browser-host.md)）。
- 编辑器槽：工作台的贡献点 `workbench.editor-area`（[ui.workbench-shell](../ui/workbench-shell.md)）。
- 打开：命令 `nbook.editor.open {address, mode: "preview" | "permanent", editor?: "markdown" | "code"}`；`editor` 缺省按类型：`.md` 为 `markdown`，其余可编辑文本为 `code`。
- 命令（`editor` 域；参数为 `{}` 的作用于活动编辑组的活动标签）：

  | 命令 | 参数 | `when` | `effect` | agent 暴露 | 编辑器区内的键位 |
  |---|---|---|---|---|---|
  | `nbook.editor.open` | 见上 | 无 | read | auto | — |
  | `nbook.editor.save` | `{}` | `dirty` | write | confirm | Ctrl+S |
  | `nbook.editor.save-all` | `{}` | 无 | write | confirm | — |
  | `nbook.editor.revert` | `{}` | `active` | write | never | — |
  | `nbook.editor.close` | `{}` | `active` | read | auto | Ctrl+W |
  | `nbook.editor.close-others` | `{}` | `active` | read | auto | — |
  | `nbook.editor.split-right` | `{}` | `active` | read | auto | Ctrl+\\ |
  | `nbook.editor.split-down` | `{}` | `active` | read | auto | — |
  | `nbook.editor.reopen-with` | `{editor}` | `active` | read | auto | — |

  `when` 列写 `nbook.editor/` 下的公开键名。`revert` 丢弃未保存修改，对 Agent 不开放。键位只在编辑器区有焦点时由编辑器区处理并执行同一命令，不写成全局键位，`when` 也不含焦点：命令面板取得焦点时这些命令仍可选。第一批的 `nbook.editor.focus`、`nbook.edit.undo`、`nbook.edit.redo`、`nbook.editor.go-to-line` 由本插件登记，`when` 改用下面的公开键，其余声明不变。
- 公开状态（布尔）：`nbook.editor/focused`（编辑区获得焦点）、`nbook.editor/active`（有活动视图）、`nbook.editor/writable`（活动视图可写）、`nbook.editor/lineNavigation`（活动视图支持行导航）、`nbook.editor/dirty`（活动文档 dirty），对应命令目录第一批的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`。
- 文档协调服务 `documentCoordinatorKey`（`nbook.editor` 的共享合同），资源管理器作为可选依赖使用：

  ```ts
  interface DocumentCoordinator {
      /** 地址本身或其后代里需要结算的文档。 */
      affected(addresses: ReadonlyArray<string>): ReadonlyArray<{address: string; state: "dirty" | "saving" | "unresolved" | "conflict"}>;
      /** 结算这些文档的视图输入、等在途保存，然后挡住它们的新保存直到 end；有未裁决输入或磁盘冲突时为 blocked。 */
      begin(addresses: ReadonlyArray<string>): Promise<{ok: true; lease: Lease} | {ok: false; reason: "blocked"; documents: ReadonlyArray<string>}>;
      /** 保存这些地址下的 dirty 文档，逐项结果。 */
      save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{address: string; ok: boolean; code?: string}>>;
      /** 本窗口的保存形成了从 token 起的身份链时返回链尾的令牌，否则原样返回。 */
      translate(address: string, token: string): string;
      /** 用户确认删除并删除成功后：关闭这些地址及其后代的标签、丢弃正文。 */
      close(addresses: ReadonlyArray<string>): void;
  }
  interface Lease {
      /** moved 给出成功项的实际目标，文档随之改地址；unknown 时租约保持，直到再次 end。 */
      end(result: {kind: "done"; moved?: ReadonlyArray<{from: string; to: string}>} | {kind: "unknown"}): void;
  }
  ```

## 输出与可观察行为

**编辑组与标签**

1. 单击打开（`preview`）替换本组已有的 preview 标签；目标已在本组打开时只激活它。`permanent` 打开、在标签里编辑或双击标签都把 preview 转为 permanent。
2. 打开在活动组进行；活动组是最近获得焦点或执行过打开的组。拆分在活动组右侧或下方新建组、打开同一文档，新组成为活动组；两个组的视图共用一份文档，各有自己的撤销历史。
3. 关闭标签后同组激活它右侧的标签（没有时左侧）；组里最后一个标签关闭且还有别的组时，组随之关闭，焦点到相邻组。
4. 关闭文档的最后一个标签、或 preview 替换掉它时，文档 dirty 或有未裁决输入就询问“保存 / 不保存 / 取消”，默认在取消；文档仍在别的组打开时不问。
5. 绑定项目的窗口把组的布局、每组的标签（地址、编辑器、preview）与活动项存进 project/local 记录 `editor.session`，不存正文；重新打开时按记录恢复，标签先出现，正文按打开流程读取。读不到的标签显示原因，不静默删除。未绑定项目的窗口只在内存里。

**打开与切换**

6. 点击后同一帧切换活动标签；目标文档没就绪时内容区空白，800 毫秒后仍未就绪才在组顶部显示进度条（[files-explorer 打开与切换](files-explorer.md#打开与切换)）；不显示旧文件的正文。
7. 打开成功以正确正文可编辑为完成点；读取失败在内容区显示原因与重试，不显示空白编辑器。已打开、视图状态还在的文档切回不读磁盘，控件不重建。
8. 快速连续打开时只有最后一次意图生效；先发出的读取迟到不改变活动标签与焦点。
9. 换文档前先结算旧视图的输入；旧视图有未裁决输入时不换，提示先裁决。
10. 切回已打开的文档恢复它在该组的光标、滚动与撤销历史：A 中输入、切到 B 输入、回到 A，撤销与重做只作用于 A 的输入。

**文档与保存**

11. 同一地址并发打开只读一次。读取在该方案的变更订阅就绪之后才发出；读取在途时该文件有变化，结果回来后再读一次。
12. 同一文档在几个组里的视图共用正文：一个视图的输入被接受后其它视图随之更新，更新不进入它们的撤销历史。
13. 两个视图基于同一修订输入了不同内容时，后到的成为未裁决输入：所在组顶部给出“采用当前正文”（丢弃这份输入）与“保留本视图的内容”（以最新修订重新提交，再冲突仍保留）。未裁决输入阻止该文档的保存，并计入第 4、21 条的询问。
14. 保存以开始时的正文与基线为快照，同一文档的保存排队、不并发；成功后基线推进到快照，保存期间的新输入保持 dirty（[files 验收 4](../workspace/files.md#验收与-smoke)）。保存失败保持 dirty 并说明；结果未知时重读磁盘：哈希等于快照即为已保存，否则保持 dirty 并说明。
15. 保存遇磁盘冲突时，组顶部给出“重新载入磁盘版本”（丢弃修改）与“覆盖磁盘版本”（以冲突带回的当前基线写入）；冲突未处理前普通保存不发出写入。
16. 文件有变化时（含本插件自己的保存产生的事件）读一次核对：读到的内容等于本窗口已提交或正在提交的正文时不更新视图；否则文档不 dirty 就用读到的正文更新视图，dirty 就只标“磁盘已变化”，下一次保存得到磁盘冲突。
17. 改名或移动（`renamed` 事件，或资源管理器的移动成功）把地址本身及其后代的文档与标签改到新地址，正文、dirty、未裁决输入与视图状态保留，文档身份的 `path` 随之改变。
18. 被其它来源删除（`deleted` 事件）的文档标“已删除”并只读，正文保留；dirty 的“保存”在原路径排他新建空文件后写入，原路径已被占用时说明冲突并保持 dirty；“关闭”丢弃。`resync` 时对全部打开文档按第 11、16 条核对；订阅 `ended` 时该方案下的文档不可保存，组顶部说明原因。正文超过文件服务上限时打开失败并说明 `too-large`。

**编辑器**

19. `.md` 缺省用 Markdown 富文本编辑器。打开后不编辑，切走、关闭或保存都不改变磁盘字节；编辑后保存，未编辑的行字节不变（含换行符、列表标记、方言写法），编辑过的行按编辑器的写法写出。frontmatter 不进入富文本，原样保留。项目方言（批注、注音、双语、对齐、文字标记、内嵌 HTML、硬换行）往返后语义不变；工作区与领域链接按普通链接保留源码。
20. 其余可编辑文本用源码编辑器；Markdown 也可以“用源码编辑器重新打开”，选择记在标签上。只读文档的视图不接受输入；撤销、重做、跳转到行按命令目录作用于活动视图。

**离开与终态**

21. 有 dirty、未裁决输入或在途保存的文档时离开或刷新页面，先结算视图输入，再请求浏览器的离开确认。
22. 页面转入服务端已重启、项目已关闭或版本不一致的终态页时，终态页列出本窗口未保存的正文（文件路径与可复制的文本，含未裁决输入）。

**资源管理器的结算**

23. 复制的源包含需要结算的文档时，在冻结源之前询问“先保存再复制 / 复制磁盘版本 / 取消”，默认在取消；先保存失败或冲突时不复制并说明。
24. 移动、拖动与改名提交前取得租约：视图输入结算、在途保存完成、新的保存排队；有未裁决输入或磁盘冲突的文档时不提交并说明。剪贴板或拖动冻结的源身份经 `translate` 换成本窗口保存后的身份：剪切后保存再粘贴照常移动，外部替换仍为 `source-changed`。成功项按第 17 条改地址，失败项不动；结果未知时租约保持，资源管理器核对或放弃后才释放。
25. 删除确认列出将丢失未保存修改的文档；删除成功的项关闭标签、丢弃正文（第 18 条只适用于其它来源的删除）。

## 状态与转换

| 文档状态 | 进入 | 离开 |
|---|---|---|
| loading | 第一次被打开 | 读到为 ready；失败为 failed |
| ready | 读到或重新载入 | 其它来源删除为 deleted；订阅结束为只读 |
| failed | 读取失败 | 重试；标签关闭时丢弃 |
| deleted | 其它来源删除 | 保存重建为 ready；关闭丢弃 |

dirty、saving（有在途保存）、unresolved（有未裁决输入）、conflict（磁盘冲突）、disk-changed（dirty 时磁盘已变化）是 ready 与 deleted 上的标记；租约期间保存排队。

时序与寿命：

- 文档在第一个标签打开时建立，最后一个标签关闭时丢弃；需要结算的文档在标签关闭前已结算（第 4 条）。
- 视图的输入经输入回执交给文档：被接受才算进入正文。切换、保存、关闭、离开与资源管理器的操作之前先同步结算视图输入。
- 每次视图绑定文档都签发新的绑定标识；换文档、关闭标签、项目换代后，旧绑定的回调不再改变任何文档或视图。
- 读取结果只在目标仍存活、输入修订未前进、不 dirty、无在途保存与冲突时替换正文；否则只更新“磁盘已变化”的标记。
- 项目换代：旧代的文档全部作废，标签按新代重新打开；旧代的读取与保存结果不应用到新代。
- 同组同种编辑器的视图状态（Monaco 的模型与视图状态、富文本的编辑状态与撤销历史）按“文档 × 组 × 编辑器”保留到标签关闭；只淘汰不 dirty、无未裁决输入、无在途保存的非活动视图状态，每组每种最多 3 份。

## 副作用与数据

- 正文与基线只在内存；写入经 [workspace.files](../workspace/files.md) 的条件保存，写入来源为 `{kind: "user", plugin: "nbook.editor"}`。
- 记录 `editor.session`：owner `nbook.editor`，project/local，版本 1；只存布局与标签，不存正文。

## 失败与恢复

| 情形 | 表现 | 用户怎么办 |
|---|---|---|
| 读取失败（`not-found`、`not-text`、`too-large`、`permission-denied`、断线） | 内容区说明原因 | 重试或关闭 |
| 未裁决输入 | 第 13 条 | 采用当前正文或保留本视图内容 |
| 磁盘冲突 | 第 15 条 | 重新载入或覆盖 |
| 保存失败或结果未知 | 第 14 条 | 重试保存 |
| 被其它来源删除 | 第 18 条 | 保存重建或关闭 |
| 订阅结束、页面终态 | 第 18、22 条 | 复制正文后刷新 |

## 边界与兼容

- 公开接口：命令与参数、公开状态键、`documentCoordinatorKey`、贡献点 `workbench.editor-area`。
- 编辑器种类只有 `markdown` 与 `code`；第三方编辑器贡献不在本期。

## 验收与 Smoke

1. Given 资源管理器里两个 Markdown 文件，When 单击 A、单击 B、双击 B，Then 只有一个标签且最后为 permanent；编辑 B 后单击 A，A 以 preview 新开、B 保留。
2. Given 读取被扣住与手动时钟，When 打开文件，Then 标签当帧切换，799 毫秒时内容区空白、800 毫秒时出现进度条；放行后正文出现、进度条消失；放行前再打开 C，A 的结果迟到也不改变活动标签。
3. Given 编辑未保存，When 外部改写同一文件，Then 显示“磁盘已变化”，保存得到磁盘冲突；“重新载入”后正文为磁盘内容、不 dirty；另一次“覆盖”后磁盘为编辑内容。
4. Given 保存被扣住，When 继续输入再放行，Then 磁盘是保存时的正文，文档仍 dirty；同时按两次保存只发出一次写入后再发第二次。
5. Given 含全部方言、CRLF 换行与 frontmatter 的章节，When 用 Markdown 编辑器打开、不编辑、切走再关闭，Then 磁盘字节不变；编辑一个段落后保存，只有那一行变化。
6. Given 两个组打开同一文档，When 在一组输入，Then 另一组显示同样正文；两组基于同一修订输入不同内容时，后到的一组出现裁决条，裁决前不能保存。
7. Given 编辑未保存，When 在资源管理器剪切、保存、再粘贴到另一目录，Then 移动成功，标签跟到新路径，正文与 dirty 保留；复制时询问三选，删除时确认框列出该文档。
8. Given 三个标签两个组，When 刷新页面，Then 组与标签按记录恢复，活动标签的正文出现。
9. Given Monaco 与富文本各打开 A、B，When A 输入、切 B 输入、回 A 撤销与重做，Then 只作用于 A。
10. Given 一个 dirty 文档，When 服务端重启，Then 终态页列出该文件与可复制的正文。
11. Given 保存成功，When 另一窗口打开同一文件，Then 看到新正文。

Smoke：产品页 e2e `e2e/editor-area.e2e.ts`（生产构建、本机 Chrome、真实 Files）运行场景 1、3–11；场景 2 的阈值由注入时钟的组件与模型测试验收，e2e 只核对正常打开不出现进度条。

## 证据

- 批准依据：[NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 第 5 节（编辑器组件从旧包迁入）与推进顺序第 6 条；[项目文件底座与 Files 竖切](../../proposals/project-file-foundation.md)（沿用第一版切换设计）；本 Spec 的取舍见 [w00017 待确认清单](../../../.agents/works/w00017-application-runtime-architecture/pending-confirmations.md) 2026-10-09 的 t71 条目（按推荐先做，待开发者追认）。
- 实现入口：[`editor/plugin.ts`](../../../packages/neuro-book/src/plugins/editor/plugin.ts)、[`editor/web/area.ts`](../../../packages/neuro-book/src/plugins/editor/web/area.ts)、[`documents/store.ts`](../../../packages/neuro-book/src/plugins/editor/web/documents/store.ts)
- 合同测试：[`editor/documents.test.ts`](../../../packages/neuro-book/src/plugins/editor/documents.test.ts)、[`editor/area.test.ts`](../../../packages/neuro-book/src/plugins/editor/area.test.ts)、[`groups.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/groups/groups.test.ts)、[`source-merge.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/markdown/source-merge.test.ts)、[`explorer/documents.test.ts`](../../../packages/neuro-book/src/plugins/explorer/documents.test.ts)
- Smoke：[`editor-area.e2e.ts`](../../../packages/neuro-book/e2e/editor-area.e2e.ts)（产品页）、[`lab-editor.e2e.ts`](../../../packages/neuro-book/e2e/lab-editor.e2e.ts)（Lab 集成场景）
