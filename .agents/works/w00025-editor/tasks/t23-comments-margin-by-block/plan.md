# t23 批注：Ctrl 悬停与小符号打开，页边按段排位：实施计划

## 1. Context

开发者 2026-11-12 试用 t22 后提了第二轮反馈，同一天看过方案并确认（“可以”）。依据的 Spec：[`docs/specs/workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 29、30、32、33、38（新）与验收 11–16、21、22（新）；上一个 Task 见 [t22](../t22-comments-feedback/README.md)。

开发者的反馈（原话）：

1. 不要悬停才弹；可以做成按住 Ctrl 悬停、点击立刻弹；批注加一个小符号，点这个符号才弹。
2. 页边：批注和段落顶部对齐；批注最小高度是一个段的高度；下一段没有批注时，本段批注的最大高度升级成两倍段高；一段有多个批注时用一个批注的位置展示多个（tab 或左右切换）；批注展开时，要编辑的话可以直接浮动，或者像现在一样临时增高挤占别的批注。

已确认的决定（方案会话里）：

- D1 高度规则：最高默认等于段高，下一段没有批注时放宽到两倍，**但不越过下一段的底边**（免得压到后面的槽位）；最小高度**封顶约 8 行意见**（长段一句话不拖出一张空卡）；一行的短段也至少放得下一行意见（卡片稍高于段，后面的往下让）。
- D2 页边卡片**去掉底行**：编辑、删除按钮悬停、当前、有焦点时浮在右上角；“第 i 条，共 n 条”与跨整份文档的上一条、下一条只留在浮层；同段切换用 `‹ 1/3 ›`。
- D3 展开与编辑**浮着**：槽位的位置与占位不变，别的卡片不动（不用“挤占”）。
- D4 小符号：画在批注末尾，只在页边没画出来时出现；同处结束的几条合成一个、带条数；Ctrl 在 macOS 上 ⌘ 也行；触屏用小符号。“段”：文字块（段落、标题、列表项、引用与提示块里的段落），表格按行，整块批注按里面第一个文字块，跨段按起点所在的段。

我自己定的细节（不再问开发者，列进待确认清单）：
- 光标走进批注只是成为当前（底色、按钮），不展开；展开只由点卡片、点编辑触发，光标走动、打字、Esc 收回。理由：编辑正文时大卡片不该跟着光标弹出来盖住后面的卡片。
- 点开的卡片（小符号、Ctrl 点击）鼠标离开不收；Ctrl 悬停出来的离开后 0.25 秒收。
- Ctrl 判断为 `ctrlKey || metaKey`，不做平台判断（macOS 上 Ctrl 加点击是右键，⌘ 可用）。

工作方式：Task 记录在主工作区；代码在 `.worktree/w00025-t23-comments-margin-by-block`（分支 `feat/w00025-t23-comments-margin-by-block`）。设计开发者已确认，不做计划审查，只做一次实现审查（前端，Sonnet 子代理）。视觉不先出静态稿：先在 Lab 做场景，截图给开发者看一轮再调。

## 2. 技术选型

无新依赖。小符号用 ProseMirror 挂件装饰（不用 CSS 伪元素：一条批注可能被别的格式切成几个 DOM 元素，伪元素落不到“最后一截”上，也点不准）。图标用 CSS `mask` 画 lucide 的气泡路径（nb-markdown 不依赖 UnoCSS 图标类）。动画只用 CSS 过渡与令牌。

## 3. 关键设计

### 3.1 `packages/nb-markdown`（`src/editor/comments.ts` 与 `src/display/markdown.css`）

- **段的判断**（只看文档，纯函数，导出）：
  - `territoryAt(doc, pos)`：位置所在的“段”的起点位置。位置在文字块里取最里面的文字块，在表格里取所在的 `tableRow`；位置是“块之前”（块批注、块菜单）时往里下降到第一个文字块或第一行（`tableRow`）；叶子块（图片、分割线）取自己。
  - `territoryOf(doc, info)`：`territoryAt(doc, info.start)`。
  - `nextTerritory(doc, pos)`：文档里下一个段的起点位置，没有为 null（`nodesBetween` 从 `pos` 这一段的末尾往后找第一个文字块、`tableRow` 或叶子块）。
- **挂件装饰 `MarkdownCommentMarkers`**（新扩展，加进 `markdown-editor-extensions.ts`）：插件状态存 `DecorationSet`，文档变了才按 `listComments(doc)` 重算（每个事务本来就有一遍，0.1ms 量级）；每条批注在 `info.end` 处（行内是最后一截的末尾，块批注是块里最后一个文字之后）一个挂件，同一位置的几条合并，数字是条数。挂件 spec：`side: 1`、`marks: []`（画在批注标记之外）、`stopEvent: () => true`、`ignoreSelection: true`、`key: "comment-marker-" + 条数`（位置变了复用同一个 DOM，打字时不重建）。DOM：`<span class="nb-comment-marker" contenteditable="false" data-comment-marker data-count="2" role="button" aria-label="…">`；文案由宿主经扩展选项 `label` 传入，nb-markdown 不认识翻译。
- `commentsEndingAt(doc, pos)`：在这个位置结束的批注（点符号时用，比 `commentsAtPos` 窄：不含只是盖过这个位置或从这里开始的）。
- `display/markdown.css`：`.nb-comment-marker` 占约一个字宽、批注色、`mask` 图标、`cursor: pointer`、`user-select: none`；带条数时图标后面一个小数字；悬停与键盘焦点时加深。页边画出来时隐藏的规则写在宿主（见 3.3）。
- 导出：`territoryAt`、`territoryOf`、`nextTerritory`、`commentsEndingAt`、`MarkdownCommentMarkers`（经 `editor/index.ts`）。

### 3.2 `MarkdownCommentCard.vue`（同名 .md 先改）

- 浮层（`variant="float"`）不变。
- 页边（`variant="margin"`）：
  - 去掉底行与 `-webkit-line-clamp: 3`；意见区用 CSS 变量 `--lines`（宿主给的行数）限行，`expanded` 时不限（最多约 12 行再滚动）。
  - 右上角控件 `.controls`（绝对定位，背景不透明）：编辑、删除在 `current`、悬停、焦点里时显现（`opacity` 加 `visibility`，不占位）；有 `pager`（`{index, count}`）时左边常显 `‹ 1/3 ›`，意见第一行为它让位（意见区开头放一个同尺寸的 `float: right` 占位）。点 `‹ ›` 发 `previous`、`next`（页边里是“同段的上一条下一条”，由页边映射，不是整份文档的）。
  - “写”：同一张卡片，意见处变文本框，下面一行右边取消、保存（展开后空间够）。
  - 新 props：`expanded?: boolean`、`pager?: {index: number; count: number}`；`current` 只管按钮显现与底色，不再决定行数。

### 3.3 `MarkdownCommentLayer.vue`、`MarkdownCommentMargin.vue`、`margin-layout.ts`

**Layer（状态机变薄）**

- 删 `hoverDelay`、`openTimer`、`suppressed` 的计时部分；保留 `closeTimer`（收悬停的）与 `overCard`。
- `viewing: {pos, ending: boolean, pinned: boolean} | null`：`ending` 为真时卡片里的批注是 `commentsEndingAt(doc, pos)`，否则 `commentsAtPos`；`pinned` 为真是点开的。
- 打开：
  - `pointermove`：`ctrlKey || metaKey` 且指针在 `comment`、`.nb-comment-block` 上，没被收起（`suppressed`）、没被挡住、页边没画、没在写：立刻 `openAtPointer`（悬停的，`pinned: false`）。指针不在批注上、不在卡片上：悬停的 `scheduleClose`；点开的不收。
  - `keydown` / `keyup`（`document`）：Ctrl 或 ⌘ 按下且指针（记着最后位置）在批注上：同上。
  - `pointerdown`：目标在小符号上不处理；Ctrl 或 ⌘ 且在批注上：`openAtPointer` 并 `pinned: true`；其余：`closeView(true)`（要编辑了）。`document` 上的 `pointerdown`：目标在卡片（`[data-markdown-comment-layer]`）与小符号之外且卡片是点开的：收起。
  - `mousedown`（捕获，符号上）：`preventDefault`（不移动光标与焦点）。`click`（符号）：取符号的位置（`view.posAtDOM(符号, 0)`），已经开着同一处就收起，否则 `viewing = {pos, ending: true, pinned: true}`。
- 收起、`suppressed`、`closeAll`、`onTransaction` 的收起规则同 t22（输入、非空选区、Esc 等）；点开的不因 `pointerleave` 收。
- 页边相关：`marginSlots` 取代 `marginItems`（见下）；`expanded: CommentRef | null` 与 `current` 一样每个选区或文档事务清掉，`select(info, {expand})` 里在 `gotoComment` 之后设。

**槽位数据（Layer 算，Margin 画）**

```ts
interface MarginSlot {
    key: string;                      // 槽位身份：这一段的位置经事务映射后沿用的 key（slotKeys，同 t22 的 blockKeys 做法）
    anchor: number;                   // 段的起点位置
    next: number | null;              // 下一段的起点位置
    nextCommented: boolean;
    entries: ReadonlyArray<{info: CommentInfo | null}>; // 同段的批注，按输出 31 的先后；待写的新批注 info 为 null
    active: number;                   // 显示哪一条：写着的，否则光标所在的，否则上次看的（activeMemory），否则第一条
    mode: "idle" | "current" | "write";
    expanded: boolean;
}
```

- 分组：`list.value` 按 `territoryOf` 分到 `Map<anchor, entries>`，槽位按 `anchor` 排。待写的新批注：自己一个槽位（key `pending`，锚在 `territoryAt(选区起点)`，块批注在块的位置），`write`、`expanded`，不参与别的槽位的排位。
- `activeMemory: Map<slotKey, 批注 key>`：槽位当前显示哪一条的记忆，随 `current`、`write` 更新，文档换时清。

**Margin（排位与高度）**

- 几何（每次排位量）：`element = view.nodeDOM(anchor)` 的盒子（量不到、高度 0 时往上找有盒子的祖先，同 `topOf` 的回退）得 `top`、`height`；`next` 同样量得 `nextBottom`。`minH = max(oneLine, min(H, MIN_CAP))`，`maxH = max(minH, nextCommented ? H : min(2H, nextBottom - top))`，减去槽位之间的 4px 空。`lines = max(1, floor((maxH - chrome) / lineHeight))`，`chrome` 与 `lineHeight` 从卡片的计算样式读（不写死）。
- 槽位的闲置高度 `idleHeight = clamp(卡片自然高度, minH, maxH)`；自然高度读卡片根的 `offsetHeight`（意见按 `--lines` 限行后的高度）。读不到时（还没渲染）按 `minH`。
- 展开：卡片（外层“面”）位置 `absolute`、`z-index` 抬高，高度从 `idleHeight` 过渡到 `clamp(自然高度, idleHeight, EXPAND_MAX)`；槽位本身的高度锁在 `idleHeight`（别的槽位的排位只用这个）。`current` 的 z-index 居中，写着的最高。
- 排位：按 `anchor` 排的槽位，`top = 段顶边`，非展开的槽位之间留 `ITEM_GAP` 作兜底往下让；展开的槽位不进这条链。
- 动画（只消费令牌）：沿用 t22 的 `ready` 下一帧显示、入场、`top` 过渡、淡出；新增 `height` 过渡（`--motion-move`、`--ease-layout`）；同段切条目没有动画。
- `MarkdownControl.vue`：给 `data-comment-margin` 下的小符号加 `display: none` 的规则（`:global` 或 `:deep`）；扩展选项传 `label`。

### 3.4 同名 `.md`、Lab、测试

- 先改 `MarkdownCommentCard.md`、`MarkdownCommentLayer.md`、`MarkdownCommentMargin.md`、`MarkdownControl.md`（如有符号隐藏的说明）；组件规范：改行为先改文档。
- Lab：把 t22 的“批注：页边开着”与新增场景合并为“批注页边：一段多条、短段、长段、下一段有无批注”（数据覆盖四种槽位）；批注的浮层场景补两条结束在同处的批注。
- 测试：见验收映射。

## 4. Spec 与文档改动

已在主工作区 master 完成（输出 29、30、32、33、38、验收 11–16、21、22、实现合同三条）。Task README、Work README、`pending-confirmations.md` 随进展更新。

## 5. 切片

1. **Spec 与 Task 记录**（master，已做）。
2. **nb-markdown**：`territoryAt/Of`、`nextTerritory`、`commentsEndingAt`、`MarkdownCommentMarkers` 与 CSS；测试写在 `comments.dom.test.ts`。验证：`bun run --cwd packages/nb-markdown test`、类型检查。
3. **前端：打开方式**：改 `MarkdownCommentLayer.md`/`.vue`（Ctrl 悬停、小符号、点开的）、`MarkdownControl.vue`（符号隐藏、`label`）；改 `MarkdownCommentLayer.dom.test.ts`、`MarkdownControl.dom.test.ts`。验证：受影响的 dom 测试、`typecheck`。
4. **前端：页边**：改 `MarkdownCommentCard`、`MarkdownCommentMargin`、`margin-layout.ts`、Layer 的槽位数据；更新 `.md`、dom 测试、Lab 场景。验证同上。
5. **e2e 与取证**：改 `markdown-comments.e2e.ts`（悬停改 Ctrl、符号、槽位几何、同段切换、展开浮着）；跑 `markdown-comments`、`markdown-editing`、`editor-area`；Lab 取证（nbook、macos × 亮、暗，390px）给开发者看一轮，按反馈再调。
6. **实现审查**（Sonnet，前端）与修正；合入 master。

## 6. 验收映射

| 行为 | 覆盖 |
| --- | --- |
| 小符号：每个结束处一个、同处合并带条数；点它出卡片、光标与焦点不变；不进文件、撤销历史、剪贴板；页边画着不出；只读也画 | `comments.dom.test.ts`（装饰与位置）、`MarkdownCommentLayer.dom.test.ts`（点符号）、e2e 一例（真实布局里可见、可点、不移动光标） |
| Ctrl（⌘）悬停、Ctrl 点击立刻出；先停后按 Ctrl 也出；没按 Ctrl 的悬停与点击、方向键、打字不出 | `MarkdownCommentLayer.dom.test.ts`（真实 `PointerEvent` 与 `KeyboardEvent`）、e2e 一例（Playwright 的 `keyboard.down("Control")`） |
| 点开的卡片鼠标离开不收，点别处、Esc、再点符号收；悬停的离开收；经过空白不收 | 同上 |
| 槽位顶边对段顶；高度在 `minH`、`maxH` 之间；下一段有无批注；不越过下一段底边 | `margin-layout.ts` 纯函数的 bun 测试（几何输入）、`MarkdownCommentMargin.dom.test.ts`、e2e 量真实几何 |
| 同段几条批注一个槽位、`‹ 1/3 ›` 切换、光标进入自动切 | `MarkdownCommentMargin.dom.test.ts`、e2e |
| 展开浮着、别的槽位不动；Esc、光标走动收回；写同样 | e2e 量别的槽位的 `top` 前后相等、被展开的卡片高度增加；dom 测试 |
| 动画：槽位入场、`top` 与 `height` 过渡；减少动态效果时没有 | e2e 开回动效读过渡中的计算样式（同 t22 的做法）、取证多帧采样 |

## 7. 验证

合入前跑一次：`markdown-comments`、`markdown-editing`、`editor-area`（标题条相关）、`lab-scenes`（改了 Lab 场景，既有的 ThemeEditor 404 在 master 上同样失败）。先构建三份产物。UI 取证：nbook、macos 两主题 × 亮、暗，量槽位几何与展开前后别的槽位位置，390px 视口；截图（亮色）交开发者看一轮。

明确留下的未验证：真实输入法在符号旁的行为（挂件改变折行，不在组字时动）、macOS 真机的 ⌘ 悬停与点击、触屏的小符号点击（用 `pointerType: "touch"` 的事件近似）。

## 8. 不做与风险

- 不做：页边里悬停正文高亮对应的卡片；同段切条目的动画；小符号的键盘焦点（键盘走 Ctrl+Alt+M 与页边）。
- 风险：
  - 挂件在行尾与光标：`side: 1`、`ignoreSelection`，Chrome 里 `contenteditable=false` 的行内元素在行尾时光标可能要多按一次方向键；e2e 与手测覆盖，有问题时改 `display: inline-block` 的零宽方案。
  - 挂件位置变了复用 DOM 是否真的不重建：dom 测试读 DOM 节点引用相等。
  - 槽位高度依赖卡片自然高度，两步收敛（几何 → 限行 → 量高度）：用 `ready` 等两者都有再显示，高度过渡掩盖第二步的微调；量打字时的帧时间不比 t22 差。
  - 展开卡片盖住后面的槽位，点后面的槽位会先让写着的卡片失焦收起，再选中：与 t22 的“点别的卡片”一致。
