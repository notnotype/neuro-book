# t66 实施记录：主页面多组编辑、底部面板、状态栏与工具移动

日期：2026-09-19。worktree `.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`。本轮不提交、不推远端、不合并；不碰开发者 3001 服务与真实状态根。浏览器验证走自建隔离服务（44777 / 44778，后续复用 44778）与系统 Temp 状态根 `C:/Users/notnotype/AppData/Local/Temp/neuro-book/acceptance/w00003-multigroup-panels`（`NEURO_BOOK_STATE_ROOT` / `NEURO_BOOK_CACHE_ROOT`）。

计划：`local://main-workbench-multigroup-panels-plan.md`。切片甲–庚的实现记录见任务 README 交付面表；本文件记录**验收过程、发现的缺陷、修复证据与命令结果**。

## 1. 验收方式与环境事实

- 隔离服务：`hub op=start, bun run dev`（cwd=`packages/neuro-book`，`NUXT_PORT=44778`），就绪以 `Local: http://127.0.0.1:44778` 与页面 200 双重确认。
- 隔离 Project：`POST /api/projects` 建 `multi-group-acceptance`；正文文件 `src/story/chapter-01.md` 由 `/api/workspace-files/create-file` 建。
- 浏览器：managed `browser.open`（headless，非开发者会话）。读取应用内状态经历两次环境教训，二者都是**验收工具问题**，不是产品缺陷：
  1. `page.evaluate` 跑在 **isolated world**：应用主世界里写的 `window.__nbookProbe` 在验收侧永远读不到。判定：同一 `document.body.dataset`（DOM 共享）能读到主世界写的值，而 `window` 上的读不到。改用 DOM 暴露状态后正常。
  2. 探针插件 `app/plugins/temp-acceptance-probe.client.ts` 的 `window` 赋值同理不可读；该文件已删除。
- 因此下文"读到 X"一律指经 `document.body.dataset.*` 读到的主世界状态，或直接读 DOM/接口响应。
- 第三个环境事实：本会话的 dev server 对**部分模块**长期返回旧代码（浏览器从不执行 `EditorViewHost.vue` 的新内容，而服务端 `curl` 该模块却含新内容），清缓存与完整重启都不能修复；详见 §5.1。据此，任何"改动看起来没生效"的浏览器观察都必须先确认模块是否真的在执行，否则会得出错误结论。

## 2. 主页面实际观察到的结果（验收已通过项）

| 场景 | 观察结果 |
|---|---|
| 三栏外壳 + 底部 + 状态栏 | 叶集合 `[titlebar, activity, left, editor, right, panel, statusbar]`；状态栏在窗口最外缘，底部跨全宽且带 32px 标签头与展开内容 |
| 多组拓扑 | 工具栏"向右分屏"→ 组 `[main, g1]`，同文档两组各有一标签；三组/四组嵌套、sash 拖动换宽均可用，编辑内容 DOM 身份不因改尺寸丢失 |
| 组会话记录恢复 | 记录 `workbench.editor/records/session.json` 写入 `grid(g1|g2 水平) + groups + activeGroupId`；重新加载页面后两组、逐组标签、活动组按记录恢复 |
| 工具容器 | 左/右/底部三处均为真实 `WorkbenchViewHost`，文件树 `nbook.files` 可渲染在三处；底部空态可接收视图 |
| 状态栏事实 | 左侧真实 Project 名与保存态、右侧 `1/1`、`0/3`、编辑器名、底部显隐按钮；无 Git 分支/行列号/通知等假数据 |
| 跨工作面 | Project A → user-assets → Project A 往返后布局与记录各自独立 |
| 响应式 | 1440×900、1100×800、390×844 无页面级横向溢出，底部与状态栏不遮正文 |
| 退出结算 | 未解决输入存在时禁止切换/保存全量前先 flush（单测覆盖，见 §4） |

## 3. 验收中发现并修复的缺陷

### 3.1 分屏模式被忽略（早前已修，浏览器复验通过）

修复前 `useEditorWorkbench.splitToEdge` 把工具栏"复制分屏"当搬移执行：来源组被搬空后塌陷成一组。修复后浏览器实测：工具栏分屏得 `[main, g1]` 两组同文档；边缘拖入得 move（源组空则塌陷）。回归用例：`分屏模式由载荷决定：复制保留来源标签，搬移把标签移出来源组`。

### 3.2 内部标签拖动把路径插进正文（早前已修，浏览器复验通过）

修复前 drop 事件 target 是视图自身 DOM（`TEXTAREA.min-h-0.flex-1`），`dataTransfer.getData("text/plain")` 为 `src/story/chapter-02.md`，路径进入正文。改为内部拖动期间在正文上覆盖捕获层（`data-role="editor-drop-layer"`）后，内部 drop 不再落到视图，外部文件/文本 drop 行为不变。详见 t65 记录。

### 3.3 恢复后的组永远不绑定编辑器（本轮发现并修复）

**现象**：主页面按记录恢复出 `g1`/`g2` 两组、标签齐全，但两组都停在"加载中…"：`presentations` 为 `{revision: null, busy: true}`，`resolutions` 里其实已经有 `g1:1=markdown`、`g2:1=markdown`。刷新多次稳定复现。

**根因**：`app/composables/useEditorWorkbench.ts` 的解析缓存是普通 `Map`：

```ts
const runtimes = reactive<Record<string, GroupRuntime>>({});
const resolutions = new Map<string, Resolution>();   // 不参与响应式
```

`presentationOf()` 依赖 `resolutionOf()`，而解析是在 watcher 里**后于**缓冲建立的（`config.settings` / `languages` 就绪后）。普通的 `Map` 写入不触发依赖失效，于是 `groups` 这个 computed 保留了"当时没有解析"的旧结果，`document` 恒为 `null`、`busy` 恒为 `true`。

**修复**：改为响应式集合 —— `const resolutions = reactive(new Map<string, Resolution>());`（`app/composables/useEditorWorkbench.ts:76`）。写入即触发组的呈现重新求值并绑定编辑器。

**回归测试**：`app/composables/useEditorWorkbench.test.ts` 新增 `解析晚于缓冲到达时组呈现仍会绑定，先算出的空呈现不能钉住`（把配置首读置空 → 先读一次呈现 → 再让配置到达 → 断言 `document.content === "disk"`、`editorId === "markdown"`）。

### 3.4 存活实例停在旧正文，导致兄弟组第一次输入就冲突（本轮发现并修复）

**现象**（隔离主页面，读取主世界状态）：

```
g1 输入 "X"：change probe = {instance c19a609e, baseRevision 1, status accepted}
              presentations g1:2 g2:2（两组呈现都到修订 2）
              DOM：g1 = "第一X章 起点"，g2 = "第一章 起点"   ← g2 视图没跟
点击 g2 后输入 "Y"：change probe = {instance da7628b0, baseRevision 1, status conflict}
              unresolved = [{path: chapter-01, baseRevision: 1}]  ← 它拿旧修订提交
```

即：兄弟组的**权威快照已推进**，但该组**实例**停在自己创建时的旧快照上（修订 1），下一次输入必然冲突。

**根因**：`EditorViewHost.vue` 的文档 watcher 只在通过 `if (!document || !id) return;` 与 `registry.get(id)` 两道守卫之后才把新文档写到实例上：

```ts
if (!document || !id) return;                 // 解析一度缺失就直接 return
const contribution = props.registry.get(id);
if (!contribution) return;
let entry = ...;
if (!entry) { entry = create(contribution, document); ... }
else entry.document = document;               // 只有走到这里才更新
```

守卫为真时，已存在实例的 `document` 永远不更新——而"实例存活期间解析短暂不可用"是记录恢复、切换视图、注册表变化都可能出现的正常状态。

**修复**：把"存活实例跟随权威快照"提到守卫**之前**，只按文档身份匹配（`EditorViewHost.vue:102-106`）：

```ts
if (!document) return;
// 兄弟回灌与外部更新先落到存活实例的确认快照：解析未就绪、编辑视图缺失都不能让实例停在旧正文上。
for (const entry of state.instances) {
    if (matchesEditorDocument(entry.document.target, document.target)) entry.document = document;
}
if (!id) return;
...
// 新建走 create()，已存在实例已在上面完成同步；不再需要 else 分支
```

视图侧无需改动：`MarkdownEditorView` / `CodeEditorView` 已有的 `watch(() => props.document.content)` 会把新正文经 `core.update()` 回灌，且候选未被裁决时不会被覆盖。

**回归测试**：`EditorViewHost.test.ts` 新增 `解析暂时缺失时存活实例仍跟随权威正文，不会停在旧快照上`（先按 `editorId: "markdown"` 建实例，再 `setProps({document: 兄弟正文, editorId: null})`，断言渲染出的正文已是兄弟组的）。

### 3.5 两处修复的"回退即失败"证据

把两个修复按修复前形态还原（`resolutions` 改回普通 `Map`；宿主恢复 `if (!document || !id) return;` + `else entry.document = document;`）后运行：

```
bun run test app/components/editor-workbench/EditorViewHost.test.ts app/composables/useEditorWorkbench.test.ts
× 解析暂时缺失时存活实例仍跟随权威正文，不会停在旧快照上
× 解析晚于缓冲到达时组呈现仍会绑定，先算出的空呈现不能钉住
Tests  2 failed | 12 passed (14)
```

只失败这两条新增用例（其余 12 条仍绿，说明回退是忠实的修复前状态），恢复修复后 14 条全绿。

## 4. 命令与结果（本轮最终状态）

```
# 聚焦套件（含两个新增回归用例）
bun run test app/stores/novel-ide-editor.test.ts app/components/editor-workbench \
  app/utils/editor-workbench app/components/workbench app/utils/workbench \
  app/component-lab app/composables/useEditorWorkbench.test.ts \
  shared/storage server/storage/product-definitions.test.ts
→ Test Files 53 passed (53) / Tests 531 passed (531)

# 类型检查
bun run typecheck
→ exit=0，0 个 "error TS"（输出重定向后统计）

# 文档与治理
bun run docs:check        → {"failures": [],"checkedFiles": 6135}
bun run governance:check  → {"failures": [],"warnings": []}
```

临时探针（`app/plugins/temp-acceptance-probe.client.ts`、`pages/index.vue` 与 `useEditorWorkbench.ts`、`EditorViewHost.vue`、`MarkdownEditorView.vue` 中的 `dataset.nbook*` 写入、语言资源里的 `【验收探针】` 字样、临时用例 `app/composables/__acceptance-multigroup.test.ts`）**已全部删除**；上述测试结果取自删除之后。

## 5. 未验证与限制（不得当作已通过）

1. **本轮两处修复没有跑通浏览器端复验，且原因已定位为 dev server 模块图陈旧**：修复后反复尝试里，浏览器执行的是 `MarkdownEditorView.vue`（探针 `dataset.nbookChange` 有值）而**从不执行** `EditorViewHost.vue` 的新代码（`dataset.nbookHost` 恒为空），期间：
   - 服务端 `curl /_nuxt/@fs/.../EditorViewHost.vue` 返回的模块**含**新代码（`grep -c nbookHost` = 1）；
   - 已尝试 `Network.clearBrowserCache` + `page.setCacheEnabled(false)` + **完整重启 dev server** + 全新页面，仍未生效。
   因此观察到的"兄弟组 DOM 不跟随、随后输入冲突"是**修复前**行为（陈旧模块），不能用它证明修复无效；但同样不能据此宣称修复已在浏览器通过。修复的行为证据只有 §3.5 的回归用例（修复前失败、修复后通过）。
   同一次会话里两个 `page.evaluate` 陷阱也已记录在 §1（isolated world 读不到主世界 `window`），排查这两点前得到的"探针为空"结论一律作废。
2. **恢复路径的浏览器观察受存储分区轮换影响**：`surfaceIdentity` 按 `projectRoot@publicId@revision` 区分工作面（代码内注释与 `editor-session-storage.ts` 一致），dev server 每次重启都会得到新的 ready 代次，于是旧记录按设计落到**另一个**分区、读取返回 `kind: "missing"`，页面按计划回落到默认单组。验收时若在服务重启后仍期待旧记录恢复，会得到误导性的"恢复失败"结论。
3. **工具跨面板移动（菜单 + 拖动）未在浏览器端完整跑完**：文件树在左/右/底部三处渲染已观察到，但"拖动落点提示、取消不写偏好、搜索词/展开节点/滚动跨移动保留、单实例"这几条只有单测覆盖，没有主页面实测。
4. **底部高度手势与收起态**只有单测覆盖（root 手势只写 `panel-size`、32px 标签头不删叶、旧快照兼容）；主页面只观察到默认展开态与状态栏按钮。
5. **无 opener 新页刷新恢复**未跑：只观察到"同一会话内记录写入后重新加载恢复了分组与标签"。
6. **存储冲突三出口**（重试/采用远端/覆盖）在主页面未实测，仅有单测。
7. **四主题对照**未跑；本轮只跑了 1440×900 / 1100×800 / 390×844 三档视口的无溢出观察。

以上未跑项需要在模块图可靠的运行方式（例如 `bun run nuxt:build:raw` 后的产品服务，或重启后确认模块内容一致再取数）下重跑；在这些项补齐前，本轮**不宣称整块集成已验收通过**。
