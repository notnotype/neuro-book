# t23 实施计划：评审板页面里作答、侧栏确认，给页面更多地方

## Context

开发者 2026-11-10 在 t22 评审板第 13 题写道：评审板现在是中间 HTML、右边答题，题多了找不到题对应的材料，中间的页面也太小；可以把答题内嵌到 HTML 里，nbdev 提供一套评审板模板。随后两问定了：

- **页面里填，侧栏确认**：答题控件放进页面里每道题的材料旁边；页面里填的只进草稿（t21 已存在本机），提交仍在面板自己的界面上按。页面是会话写的，脚本能伪造任何取值；这样它最多改动草稿，提交前开发者看得见，不能替开发者提交。
- **空间**：横向给页面更多地方，另外“垂直高度可以省一点”。
- t22 第 3 条（手机上“页面 | 答题”两个切换）并进来做。
- 模板参考开发者的 visualize 经验（`~/.claude/skills/visualize/references/design-rules.md`）：一节一问、结论（推荐）写在题下第一行、候选用同一个例子并排、不写引导句与图注这类补丁文字。

依据：[面板合同](../../../../../packages/dev-panel/docs/panel.md)的产物页一行与“两个来源”、[文件格式](../../../../../packages/dev-panel/docs/file-formats.md)的提问标记、[Proposal](../../../../../docs/proposals/dev-panel.md) 第六条（产物放另一个来源）。Proposal 原本写“答案经 `postMessage` 交给外壳”，t10 推迟、之后定为外壳不听 iframe；本计划改成“iframe 只能改草稿”，在 Proposal 末尾追加一条决策记录。开发者 11-02 定本 session 不做代码审查。

## 技术选型

- 页面里的控件：nbdev 自己写一个不依赖任何库的浏览器脚本（桥接脚本），由产物来源注入页面。不用 Vue 或 nb-ui：页面是会话写的任意 HTML，脚本要小、不碰页面的样式与全局变量。控件放在 Shadow DOM 里，页面的 CSS 影响不到它。
- 脚本的转译：用 Bun 自带的 `Bun.Transpiler`，服务启动时把 TS 转成 JS 缓存起来。不进 Vite 构建：它不属于面板前端，也不该等前端构建。
- 侧栏可拖宽度：用 nb-ui 的 `Splitter`（外壳的左栏已经在用），不手写拖动。

## 关键设计

### `packages/dev-panel/src/server/serve.ts`、新增 `src/server/artifact-bridge.ts`

- 产物来源上 `.html` 的回应：读成文字，在 `</body>` 前（没有就在末尾）插入 `<script src="/a/<前缀>/_nbdev/answer-bridge.js" defer></script>`；其余文件照旧流式回应。只改回应，磁盘文件、`contentHash` 不变。
- `/a/<前缀>/_nbdev/answer-bridge.js`：回转译好的脚本，`Content-Type: text/javascript`，CSP 与其它产物文件相同。原来这个保留路径回 404（留着就是为了页内答复）。
- 新增 `artifact-bridge.ts` 负责读源码、转译、缓存与插入标签，`serve.ts` 只调用它。

### 新增 `packages/dev-panel/src/bridge/answer-bridge.ts`（在页面里运行）

- 不在面板的 iframe 里（`window.parent === window`，例如“单独打开”）时什么也不做，页面照旧是只读的稿。
- 加载后给父窗口发 `{type: "nbdev:ready"}`；只收 `event.source === window.parent` 的消息：
  - `nbdev:state`：题表（题号、类型、题目、选项与推荐、必答、状态：待答、已答、已关闭）、每题的草稿取值、已答的答案文字、表单是否只读及原因。脚本按题号找 `[data-nbdev-question]` 元素，在它末尾放一个 Shadow DOM 的控件块：待答的题给单选、多选、确认或文字控件，标出必答与“已填，未提交”；已答的题只写答案与“在右边改答”；页面上没有元素的题（`ask` 登记的）不显示。再收到 `state` 时就地更新，不重建正在输入的文字框。
  - `nbdev:reveal`：把那道题滚进视口并闪一下边框。
- 开发者在控件里改了取值：发 `{type: "nbdev:draft", id, value}`（清空发 `value: null`）。脚本不提交，也没有提交按钮。

### 新增 `packages/dev-panel/src/web/host/artifact-bridge.ts`（外壳一侧）

- `useArtifactBridge({frame, questions, draft, disabledReason, onDraft})`：页面拿 iframe 的 `contentWindow`（`ArtifactFrame` 经 `ready` 事件交出），在 `window` 上听 `message`；`event.source` 不是这个 iframe 的一律丢掉。
- `nbdev:draft` 的校验：题号在最新一版的待答题里（已答的题在侧栏改答），表单不是只读，取值按核心的 `validateAnswerValue` 合法（`null` 表示清空）；通过才写进草稿，并记 `fromPage[题号] = true`。不合法的丢掉并写一条 `console.warn`。
- 收到 `nbdev:ready` 与题表、草稿、只读原因变化时发 `nbdev:state`（`targetOrigin` 只能写 `*`：沙箱 iframe 是不透明来源）。
- `reveal(id)` 发 `nbdev:reveal`。

### `src/web/host/answers.ts`、`src/web/parts/AnswerForm.vue`

- `AnswerDraft` 加 `fromPage: Record<string, boolean>`；`parseAnswerDraft` 对 t21 存下的、没有这一项的草稿补成空的。在侧栏里改了这道题就去掉标记。
- 待答题旁标“页面里填的”；题目可以点，点了发 `reveal`（新 emit），页面滚到那道题的材料。

### `src/web/pages/ArtifactPage.vue`、`App.vue`、路由

- **纵向**：产物页用 `PageShell` 的 `compact`（会话页那种一行页头：面包屑接标题，版本、单独打开、关闭评审在同一行右端，发布时间并进这一行）；“页面是当前版本”的说明只在看的不是最新一版时出现。t22 的“代码已更新可以关”另做，也省一行。
- **横向**：路由元信息 `focus: true`（产物页）。进页面时外壳把左栏收起，但不写进偏好；离开时恢复原样；在页面里手动展开就照开发者的。侧栏与页面之间换成 `Splitter`：侧栏缺省 24rem，可拖（最小 18rem），宽度记在偏好里；可以收起，收起后页面下面一条提交栏：“待答 N · 已改 M 题 [提交 M 题] [展开答题栏]”。
- **手机**（窄于 1024px）：页头下面“页面 | 答题（N）”两个切换，有待答时默认答题；页面一栏占满剩下的高度，下面同一条提交栏。切换不重建表单，草稿不丢。

### 模板：新增 `packages/dev-panel/docs/examples/review-board.html`

- 一节一问：节标题就是要问的事（问句）；标题下第一行加粗写推荐与一句理由；候选并排（`grid-template-columns: repeat(n, minmax(0, 1fr))`），用同一个例子；题的材料都在这一节里，桥接脚本把控件放在节末。
- 不写引导句、图注、复述标题的说明行；“直接修、不用答”的事列成一张表，不提问；已定的题收到页面最后。
- 一轮只问要定的事，题多时拆几轮（t22 第 1 轮 13 题，开发者说难找）。
- 亮色、正文 16px、内容列封顶，在 1440 宽、左栏收起时页面区约 1000px 也好读。

## Spec 与文档改动

- `packages/dev-panel/docs/panel.md`：“两个来源”写桥接脚本与注入；产物页一行改成新版式与“页面里填、侧栏提交”；“前端”补 `focus` 路由与左栏自动收起。
- `packages/dev-panel/docs/file-formats.md`：提问标记一节写“面板里打开时，每道题的元素末尾会出现答题控件”。
- `src/web/parts/AnswerForm.md`、`ArtifactFrame.md`：新的事件与“页面里填的”。
- `docs/proposals/dev-panel.md`：末尾追加决策记录（iframe 只改草稿，不提交）。
- `.agents/skills/design-review/SKILL.md`：评审板照模板写，一轮的题数，模板里的写法规则。

## 切片

1. 产物来源注入与桥接脚本（服务端两节、`answer-bridge.ts`）。提交边界：页面里能看到控件、能发消息，外壳还不听。
2. 外壳一侧（`host/artifact-bridge.ts`、草稿的 `fromPage`、侧栏标记与点题跳转）。
3. 纵向与横向空间（compact 页头、说明行、左栏自动收起、侧栏可拖可收、提交栏）。
4. 手机的两个切换。
5. 模板、design-review、各文档。

每片：`bun run --cwd packages/dev-panel typecheck`、受影响的测试文件、`build:web`；涉及界面的片在隔离面板上截图。

## 验收映射

- 产物 HTML 的回应带脚本标签、其它文件不变、`_nbdev/answer-bridge.js` 能取到：`tests/panel-server.test.ts` 加用例。
- 外壳的消息校验（别的来源、未知题号、已答的题、只读时、不合法的取值都丢掉；合法的写进草稿并标“页面里填的”）：新的 `tests/web-artifact-bridge.test.ts`，用假的 `window` 与 iframe 窗口。
- 桥接脚本按题表画控件、发草稿消息、单独打开时什么也不做：同一文件里用 jsdom（`tests/web-jsdom.d.ts` 已有）跑脚本。
- 端到端：隔离面板上用浏览器在页面里选一项、打字，侧栏出现“页面里填的”，在侧栏或提交栏提交，答复写进 `answers/`；刷新后草稿还在。

## 验证

- 上面的单测与 `typecheck`、`build:web`、`governance:check`、`docs:check`。
- 隔离面板（`/dev/shm` 临时仓库）上 1440 与 390 两种宽度截图：页面区的宽度、页头高度、左栏进出产物页时收起与恢复、侧栏拖宽与收起、手机两个切换。
- 未验证（写进 Task README）：会话写的页面里自带的脚本与控件块的冲突只试模板与现有几块评审板。

## 不做与风险

- 不做页面里直接提交，也不做页面里改答（已答的题在侧栏改）。
- 页面能读到推给它的草稿（包括还没提交的文字）。产物来源的 CSP 没有限制 `connect-src`，页面脚本理论上能把它发出去；这和页面现在能做的事同一量级，这次不收紧，记为已知风险。
- 注入改了 HTML 回应的长度：`HEAD` 与 `Content-Length` 按改过的内容算，测试覆盖。
- 会话写的页面若自己也给题元素塞了控件，会出现两套；模板与 design-review 写明不要自己写答题控件。
