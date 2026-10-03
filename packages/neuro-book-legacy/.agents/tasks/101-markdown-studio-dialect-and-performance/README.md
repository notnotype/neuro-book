# Markdown Studio 方言重构与输入性能修复

## Relative documents refs

- `reference/content/markdown-dialect.md`：方言规范（本次已重写 Comment 章节，新增 Ruby / Bilingual / Raw HTML 章节）
- `app/components/markdown-studio/tiptap/`：全部方言扩展实现
- `shared/markdown-workbench.ts`：方言 parse/render 共享基建
- `docs/tasks/101-markdown-studio-dialect-and-performance/`：本任务目录

## User Request / Topic

用户要求重构优化 `MarkdownStudio.vue` / `TipTapMarkdownEditor.vue`，共 7 点：

1. 列出现有 Markdown 方言。
2. 跨行标签（`<comment>` / `<inline-comment>`）难做，评估现状。
3. 修复性能 bug：输入字符导致浏览器主线程 CPU 跑满。
4. 实现新语法（注音式双语标注，用户贴图未送达，经确认为「短语级 ruby + 段落级对照，两者都要」）。
5. 优化评论（批注）功能。
6. 排查 Markdown ↔ TipTap 转换中尖括号 / XML 标签被忽略的问题。
7. 自定义 HTML：可以做，但默认不渲染，用户点击后才渲染（用户已拍板）。

用户经 AskUserQuestion 拍板：标注形态「两者都要」；语法写法「属性式」（`<ruby text="...">` / `<bilingual text="...">`）；评论「合并为 `<comment>` 单标签双形态，旧 `<inline-comment>` 兼容读、保存统一写新标签」。

## Goal

输入不再每键触发全文序列化 / 全文扫描 / 隐藏编辑器全文同步（大文档打字 CPU 不再跑满）；`<comment>` 统一双形态（行内 + 跨段块级）；新增 ruby / bilingual 属性式语法；任何未知 HTML / XML 标签不再被静默丢弃（块级进可点击渲染的源码卡片，行内进原样 chip）。验证面：`shared/markdown-workbench.test.ts` + `markdown-editor-extensions.test.ts` round-trip 测试全绿、`bun run typecheck` 全绿；同时不回归既有 268 个 app/shared 测试。

## Current State

已实施完成（2026-07-11，含三轮用户反馈修复 + 审查修复轮）。反馈轮 2（源码模式 CPU、空文件卡片、卡片样式、整体审查、文本回退/冲突审查）、反馈轮 3（comment 混合形态 A 规范化 + B 兜底保数据、冲突提示文案）与审查修复轮（/code-review 7 findings：StructuredTextEditor 模式切换丢防抖尾巴等）全部处理：shared+app 全量 301/301、本轮文件 typecheck 干净。浏览器实测由用户自行验收。

## Decisions / Discussion

- **D1 性能根因（诊断确认）**：每次按键 = 1 次全文 Markdown 序列化（`onUpdate` 里 `getMarkdown()`）+ 约 4 次全文评论扫描（`onSelectionUpdate` / `onTransaction` / `onUpdate` / decorations props 各一次）+ 2~3 次向隐藏 Monaco 的全文推送（触发全文 re-tokenize）+ store 层全文对比。修复分三层：
  - 编辑器内 300ms 防抖序列化，blur / Ctrl+S / submit / unmount 强制 flush（保证保存和切文件永远拿到最新值）；外部 `update()` 覆盖时丢弃 pending。
  - sync 层惰性同步：rich/source 两视图互斥，隐藏编辑器只记 stale 标记，切换可见时一次性同步；`MarkdownStudio` 的 `:initial-value` 改为挂载快照，消除响应式绑定绕过惰性同步的旁路。
  - 评论列表与高亮 decoration 缓存进 ProseMirror 插件状态：docChanged 才全量重扫（1 次），光标移动只重算 active 标志（O(评论数)）；列表实质未变时保持数组 identity，向 Vue 的 emit 自动去重。
- **D2 comment 合并**：mark 名 `comment` + 块级节点 `commentBlock`，Markdown 统一 `<comment>`。形态判据：开标签后紧跟换行 = 块级；同段闭合 = 行内。`addComment` 按选区覆盖的文本块数自动选择形态，删除了旧「同 id 多 range mark」的跨段 hack（旧数据仍可聚合读取）。评论体外置 sidecar 方案被否决：正文内嵌标签是 Agent 直接读写批注的基础。
- **D3 marked 陷阱一（tokenizer 顺序）**：marked extension tokenizer「后注册的先执行」且先执行者直接胜出；MarkdownManager 按 TipTap priority 降序注册 → **priority 越低越先执行**。兜底扩展 HtmlBlock(1400) / RawInlineHtml(1390) 持最高 priority（最后执行），tokenize 内标签名单做第二道保险。新增带 tokenizer 的方言扩展 priority 必须低于 1390。
- **D4 marked 陷阱二（段落中断伪装）**：marked 检测段落中断时把 `src.slice(1)` 传给 block tokenizer 的 `start`，段中位置伪装成字符串开头——`start` 匹配 `^` 开头形态会把段内行内标签拆成两个段落。因此所有块级方言 `start` 只认 `\n<tag...>\n` 形式；真块首由 marked 主循环直接调用 `tokenize` 兜住。`findMarkdownBlockTagStart` 封装此规则。
- **D5 块级兜底捕获判据**：块级 HtmlBlock 只捕获「片段之后紧跟行尾」的完整行形态，段落以行内标签开头（`<mark>x</mark>和…`）不属于块级；行内标签独占一行也交回行内 mark（排除名单 = 方言块标签 ∪ 已知行内标签）。
- **D6 HTML 渲染安全**：sandbox iframe 只授 `allow-same-origin`（读高度自适应用），不授 `allow-scripts`——脚本与内联事件一律不执行；默认源码卡片，点击「渲染」才挂 iframe（用户拍板）。
- **D7 ruby 实现取舍**：mark + 属性式（与方言家族一致），renderHTML 输出 `<ruby><span>洞</span><rt>text</rt></ruby>` 原生排版，无需 NodeView。局限：mark 被其他格式打断时 rt 会随片段重复，方言文档已注明标注内保持纯文本。标准 `<rt>` 形式兼容读入、统一写出属性式。
- **D8 块级容器序列化分隔**：`renderChildren(node)` 默认无分隔符，多段子内容会被挤在一起；commentBlock / bilingual / align 显式传 `"\n\n"`（顺手修复 align 既有的多段序列化 bug）。
- **D9 渲染门槛收敛到显式 `<html>` 块（2026-07-10 用户反馈轮）**：首版「任意未知块级标签变可渲染卡片」误伤面过大——用户报「空文件显示 HTML 卡片」，根因是 `<br>`（硬换行序列化残留）单独成行时命中 CommonMark type 6 块级 HTML 名单，被 HtmlBlockBridge 无条件接管成卡片。重构为：
  - 新方言块 `<html>…</html>`（HtmlEmbed.ts，开闭标签独立成行）是**唯一可渲染形态**：默认源码卡片，点击「渲染」挂 iframe。
  - iframe 安全模型反转为 `sandbox="allow-scripts"`（无 allow-same-origin）：脚本可执行但运行在隔离源，拿不到 NeuroBook DOM/cookie/存储，fetch 站内接口被 CORS 拒绝；与宿主唯一通道是 postMessage bridge——iframe 内注入 `window.nbook.request(type, payload)`，宿主侧 `resolveDataApi` 路由（本版未注入=统一拒绝，**未来开放 NeuroBook 数据接口时只需在 extensions options 注入该回调**）；高度自适应同走 postMessage（隔离源读不到 contentDocument）。宿主 handler 校验 `event.source === frame.contentWindow` 防冒充。
  - HtmlBlock 兜底降级为纯源码保留块（无 NodeView、无渲染按钮，虚线边框低调样式），只承担防丢数据职责。
  - HtmlBlockBridge 增加排除：块级 html token 首标签在已知行内名单（如 `<br>`）→ 交回默认 DOM 解析路径按行内语义还原（`<br>` → hardBreak → 保存时归一为换行）。
- **D10 ProseMirror 陷阱三（空文档默认填充节点，2026-07-10 反馈轮 2）**：D9 后空文件仍出卡片，jsdom 实测根因是 ProseMirror 空文档/空块级容器的默认填充节点（`ContentMatch.defaultType`）取 schema 注册序第一个可默认创建的块节点，而 TipTap schema 顺序按扩展 priority 降序——HtmlBlock 为满足 D3 tokenizer 顺序持 1400，压过 paragraph 默认的 100，空文档被填充成空 `htmlBlock`。修复：`MarkdownParagraph.ts` 把 paragraph priority 提到 1500（全 schema 块级最高），并立规则**新增块级扩展 priority 不得超过 1500**；`empty-document-default.test.ts` 用真实 Editor 锁定该行为（空文件初始化 / setContent 空串 / 删光内容 / commentBlock 内部填充都必须是 paragraph）。
- **D11 编辑器 ↔ store 同步协议（反馈轮 2「文本回退」审查结论）**：防抖引入后「编辑器最新内容」与「store 内容」存在最长 300ms 的窗口差，审查确认三条竞态链——① 外部工具写文件触发 `syncWorkspaceFromDisk`，窗口内 store 判非 dirty → `forceDisk` 重载覆盖本地输入（文本回退主因）；② 程序化切文件（无 blur）时编辑器 unmount flush 在 `activeWorkspaceFile` 已切换后 emit，旧文件内容串位写进新文件；③ 自己保存落盘触发 watcher 回声，若此时已继续打字（dirty）会弹假冲突警告。修复协议：编辑器统一走 `useEditorChangeDebounce`（schedule / flush / cancel 语义集中一处）；store 提供 `registerActiveEditorFlush` 钩子，`persistActiveWorkspaceBuffer` / `saveCurrentFile` / `syncWorkspaceFromDisk` 开头先 flush 再取内容快照（切文件、保存、磁盘同步永远建立在编辑器最新内容上）；编辑器 unmount 从 flush 改为 **cancel**（切换入口已由 store 钩子在切换前结算，卸载时 emit 只会串位）。
- **D12 保存回声抑制**：`syncWorkspaceFromDisk` 活动文件分支在 dirty 判定前先对比磁盘节点 `mtimeMs` 与 `activeWorkspaceFile.lastSyncedMtimeMs`，相等即自己保存的 watcher 回声 → 返回 unchanged（不警告、不重载）。判定必须放 dirty 判定**之前**：保存后继续打字是正常 dirty，不是外部冲突。外部工具写入必然产生新 mtime，不会命中。
- **D13 源码模式（Monaco）每键 CPU（反馈轮 2 问题 1 根因）**：Monaco `onDidChangeContent` 每键 `getValue()` 是 O(全文) 拼接，emit 后 store 的全文 dirty 对比 + `activeWorkspaceFile` 对象重建 + `syncWorkspaceTabDirty` 重建 tabs 数组 + `hasUnsavedFileChanges` / wordCount 等 O(全文) computed 逐键全跑。修复：Monaco 接入同一 `useEditorChangeDebounce`（打字只 schedule，blur / Ctrl+S / submit / store 钩子结算，外部 `update()` 覆盖时 cancel），与 TipTap 侧协议完全一致。
- **D14 混合形态读时规范化（2026-07-10 反馈轮 3，用户拍板 A+B 的 A）**：`abc<comment>␊content␊</comment>`（开标签黏正文 + 内容跨行）实测单段内容会被行内规则吃下并产生含 `\n` 的非法 text node，多段内容则标签被 DOM 剥掉静默丢失。块级 tokenizer 因 D4 陷阱不能从段中接管、ProseMirror 块节点不能从段落中间开始——读时规范化（`normalizeMarkdownDialectBlocks`，shared 层）是支持该形态的唯一位置：开标签紧跟行尾且前有真实正文 → 开标签前插空行拆段。**三重守卫（Plan 代理对抗审查修正，实测 marked 行为得出）**：① 前缀仅空白/容器标记（`> <comment>`、`- <comment>`）视为逻辑行首不拆——嵌套块级形态今天由 marked 容器内层解析正常工作，拆了是纯回归；② 行首 ≥4 空格 / tab 的缩进代码块不拆；③ 向下（fence 感知）找到独立成行的配对闭标签才拆——无闭合悬尾拆开后会被 marked type 7 吞成连正文一起冻结的源码块，比不拆更差。另有 EOS 不算行尾（流式 chunk 悬尾不被抢拆）、fenced code 内不规范化、CRLF 剥 `\r` 判据。调用入口只有 TipTap 三处（初始 content / `update()` / `insertMarkdown`）；`replaceSelection` / `appendMarkdown`（流式 chunk 语义）与 Monaco 故意不调。规范化改写在用户下次编辑时才随防抖上报实化为 dirty。带真实正文前缀的容器行（`> abc<comment>`）拆出容器为已决策行为（合法文档优于非法 text node），测试钉住。
- **D15 兜底名单拆分 + 残片捕获 + Bridge 完整性自愈（A+B 的 B）**：多段混合形态丢标签的根因是 `KNOWN_INLINE_TAGS` 排除名单只考虑了「合法形态由自家 tokenizer 处理」，失配残片没有第二道兜底。拆为两组：`DOM_HANDLED_INLINE_TAGS`（b/br/mark 等真 HTML，合法与残片都走浏览器语义）与 `DIALECT_INLINE_TAGS`（comment/bilingual/align/ruby/rt，残片必须保 chip）；**不变量：`KNOWN_BLOCK_EXCLUDED_TAGS` 必须保持三组全量并集**，否则 `<ruby>` 单独成段会被块级兜底整段吃掉（ruby 是 inline tokenizer 轮不到）。行内兜底新增残片捕获（`captureHtmlTagFragment`，仅行内路径）：无闭合开标签、孤立闭标签退化为单标签 chip——顺带修复 `Vec<String>` 类伪标签此前也被静默剥掉的暗坑；tokenizer `start` 扩为认 `</`。HtmlBlockBridge 新增完整性自愈判据：块级 html token 首标签有 DOM parse 规则（comment/inline-comment/ruby/align，bilingual 无）且 raw 以配对闭标签结尾 → 交回 DOM 自愈（保住 `<comment>␊content</comment>` 单段闭黏形态此前「自愈为行内评论」的行为）；截断形态保源码块（此前是静默改写评论范围，改后更诚实）。顺带 `parseMarkdownRuby` 无注音改返回空 text token（此前返回 null 会让 `<ruby>汉</ruby>` 从可编辑纯文本退化为冻结 chip）。**注意 node 环境测不到 DOM 自愈路径**（parseHTMLToken 需要 window，node 下退化为转义纯文本），DOM 行为回归测试放 jsdom 文件 `dialect-fallback-dom.test.ts`。
- **D16 冲突提示文案（反馈轮 3 问题 2，用户拍板最低成本档)**：外部改文件 + 本地 dirty 只弹通知不弹 diff 是有意设计（冲突未实化、避免打断输入；保存时乐观锁 409 才弹冲突对比界面），但通知没有下一步指引是体验缺口。`fileSyncConflictMessage` 文案追加「保存（Ctrl+S）即可打开冲突对比界面进行合并」。更重的方案（通知加动作按钮）暂不做。

## Verification / Test

- `bun x vitest run shared/ app/` → 270/270 全绿（含方言 round-trip 用例：行内评论不拆段、旧标签兼容改写、块级评论跨空行、ruby 双形式、bilingual、htmlBlock 跨空行兜底、rawInlineHtml、已知标签不被兜底抢走、`<html>` embed round-trip、`<br>` 不再误变卡片的回归钉子）。
- 反馈轮 2：`empty-document-default.test.ts` 16/16（D10 回归钉子）、`app/stores/novel-ide.test.ts` 4/4、`bun run typecheck` 全绿。
- 反馈轮 3：normalize 12 用例 + round-trip 追加 6 用例 + `dialect-fallback-dom.test.ts`（jsdom DOM 自愈）2 用例；shared+app 全量 299/299、typecheck 全绿。
- 待用户浏览器验收：大文档打字 CPU 占用（rich + source 两模式）、空文件不再出卡片、rich/source 切换同步正确性、评论面板（行内 + 块级）增删改跳转、`<html>` 卡片点击渲染（含脚本执行与高度自适应）、外部工具改文件时 dirty 冲突提示（新文案含 Ctrl+S 指引）/ 非 dirty 重载、保存后无假冲突警告、注音与对照译文的选区菜单及右键入口、`abc<comment>␊…␊</comment>` 混合形态打开后变块级评论卡片。

## Implementation Walkthrough

变更文件：

- `shared/markdown-workbench.ts`：重构为方言 parse/render 基建——comment 行内（双标签兼容）/ 块级、ruby（属性式 + `<rt>` 兼容）、bilingual、`findMarkdownBlockTagStart`（D4 规则）、`parseAttributes` 导出。旧 `parseMarkdownInlineComment` 系列改名为 `parseMarkdownCommentInline` 系列。
- `app/components/markdown-studio/tiptap/Comment.ts`（新，替代 InlineComment.ts）：comment mark + commentBlock 节点 + 插件状态缓存（comments + decorations + activeIndex，见 D1）+ `onCommentsChange` 回调 + `collectComments`（mark 聚合 + 块节点统一收集，`CommentItem.kind` 区分形态）。
- `app/components/markdown-studio/tiptap/MarkdownRuby.ts`（新）/ `MarkdownBilingual.ts`（新）。
- `app/components/markdown-studio/tiptap/HtmlFallback.ts`（新）：HtmlBlock（块级兜底源码保留块）+ HtmlBlockBridge（接管 marked 原生块级 html token 的截断形态，已知行内标签交回 DOM 路径）+ RawInlineHtml（行内兜底 chip）。
- `app/components/markdown-studio/tiptap/HtmlEmbed.ts`（新，D9 反馈轮）：显式 `<html>` 嵌入块——NodeView 源码卡片 / allow-scripts sandbox iframe / postMessage bridge（`window.nbook.request` 数据接口桩 + 高度自适应）。
- `app/components/markdown-studio/tiptap/markdown-editor-extensions.ts`：注册新扩展，文件头注明 D3 顺序规则。
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`：防抖序列化基建；删除三处每键全文评论扫描；`addComment` 按选区自动选形态；评论增删改按 kind 分支（块级 = setNodeMarkup / 保留内容删节点）；右键菜单与选区菜单加注音、对照入口；新增五组节点样式。
- `app/composables/useMarkdownStudioSync.ts`：惰性同步（stale 标记 + 可见性 watch 补同步）。
- `app/components/markdown-studio/MarkdownStudio.vue`：`initial-value` 挂载快照。
- `app/composables/useMarkdownStudioController.ts`：`MarkdownInlineCommentItem` 改为 `CommentItem` 别名（新增 kind 字段）。
- `app/components/markdown-studio/MarkdownSelectionMenu.vue`：更多下拉加注音 / 对照按钮。
- `app/components/markdown-studio/tiptap/MarkdownSlashCommand.ts`、`app/utils/markdown/render.ts`：插入模板与只读渲染管线改双标签 / canonical `<comment>`。
- `app/i18n/locales/zh-CN.ts` / `en-US.ts`：新增菜单与 HTML 卡片文案。
- 测试：`shared/markdown-workbench.test.ts`、`markdown-editor-extensions.test.ts` 重写扩展。
- 文档：`reference/content/markdown-dialect.md` 重写 Comment 章节，新增 Ruby / Bilingual / Raw HTML 章节。

与计划的出入：

- 计划中 block tokenizer 的 `start` 允许 `^` 开头形态；实测暴露 marked 的 `src.slice(1)` 伪装行为（D4），首轮测试 2 个用例失败后收紧为只认 `\n` 前缀 + tokenize 增加行尾判据（D5）。这是实施中最大的方向修正。
- `structured-text.ts`、`markdown-workbench.test.ts` 等文件在实施过程中被并行会话同步更新过（内容与本次方案一致），本次在其基础上继续扩展。

### 2026-07-10 反馈轮 2（源码 CPU / 空文件卡片 / 卡片样式 / 架构整理 / 文本回退）

变更文件：

- `app/components/markdown-studio/tiptap/MarkdownParagraph.ts`（新）：paragraph priority 1500，文件头固化 D10 陷阱说明；`markdown-editor-extensions.ts` 改为 `StarterKit.configure({paragraph: false})` + 单独注册。
- `app/components/markdown-studio/tiptap/empty-document-default.test.ts`（新）：D10 回归测试（真实 Editor，16 用例）。
- `app/composables/useEditorChangeDebounce.ts`（新）：TipTap / Monaco 共享的变更上报防抖协议（schedule / emitNow / flush / cancel / pending），文件头固化 flush 与 store 钩子的配合语义。
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`：防抖改用共享 composable；unmount 从 flush 改 cancel（D11-②）；`insertMarkdown` 纯空白守卫（粘贴空串不再 RangeError）；handle 暴露 `flushPendingChange`；inline AI 引用高亮 ~300 行整体搬出（见下）；`<html>` 卡片样式打磨（header 分层背景、「渲染」按钮 accent 主操作态 + play 图标、源码限高 280px 滚动、iframe onload 渐入）。
- `app/components/markdown-studio/tiptap/InlineAiReferenceHighlight.ts`（新，R4 架构整理）：inline AI 引用高亮独立模块——extension + `applyInlineAiReferenceHighlight`（三级回退定位：精确文本 → textRange 消歧 → 行号整块）+ `locateInlineAiSelectionTextRange` / `serializeEditorPrefix` / `countMarkdownLines` 导出；组件侧只剩读 props 的薄壳。
- `app/components/markdown-studio/MarkdownSourceEditor.vue`：Monaco 接入防抖（D13）；blur / Ctrl+S / submit flush；外部 `update()` cancel；unmount cancel；handle 暴露 `flushPendingChange`。
- `app/components/markdown-studio/tiptap/HtmlEmbed.ts`：toggle 两态 class + 图标、iframe load 渐入 class。
- `app/composables/useMarkdownStudioController.ts`：handle 类型加 `flushPendingChange?`；新增 `flushActiveEditor()`（两个句柄都 flush，no-op 安全）。
- `app/stores/novel-ide.ts`：`registerActiveEditorFlush` 钩子；`persistActiveWorkspaceBuffer` / `saveCurrentFile` / `syncWorkspaceFromDisk` 开头 flush（D11）；`syncWorkspaceFromDisk` 保存回声抑制（D12）。
- `app/pages/index.vue`：studio controller 创建后注册 store flush 钩子。

与计划的出入：

- 计划将回声抑制放在 `flushWorkspaceFileEvents`（index.vue）做事件预过滤，实施时改放 `syncWorkspaceFromDisk` 内部（拿到刷新后的 tree 节点 mtime 才能对比，且该函数是所有磁盘同步的单一入口，比在调用方逐处过滤更系统）。
- 原计划只给 TipTap 接防抖 flush 协议，审查中发现 Monaco 侧同样存在每键全文 `getValue()` + store 全文对比链（反馈问题 1 的真正主因，rich 模式修复不覆盖它），故 Monaco 同轮接入同一 composable。

### 2026-07-10 反馈轮 3（comment 混合形态 A+B / 冲突提示文案）

变更文件：

- `shared/markdown-workbench.ts`：`MARKDOWN_BLOCK_DIALECT_TAGS` 导出（名单单一来源，自 HtmlFallback 迁移）；`normalizeMarkdownDialectBlocks` 逐行状态机（D14，注释固化「陷阱四」判据边界与入口清单）；`parseMarkdownRuby` 无注音返回空 text token（D15 顺带）。
- `app/components/markdown-studio/tiptap/HtmlFallback.ts`：名单拆分（DOM 组 / 方言组 / DOM 可解析方言组）+ 并集不变量注释；`captureHtmlTagFragment` 残片捕获（仅行内路径）；RawInlineHtml `start` 认闭标签；HtmlBlockBridge 完整性自愈判据；文件头兜底职责矩阵（D15）。
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`：初始 content / `update()` / `insertMarkdown` 三入口接 normalize；`replaceSelection` / `appendMarkdown` 注释写明故意不 normalize（流式 chunk 语义）。
- `app/i18n/locales/zh-CN.ts` / `en-US.ts`：`fileSyncConflictMessage` 追加 Ctrl+S 指引（D16）。
- 测试：`shared/markdown-workbench.test.ts` 追加 normalize describe（12 用例：四标签拆段、逻辑行首、缩进代码、fence、闭标签 fence 内不算、无闭合、EOS 悬尾、CRLF、容器拆出钉子）+ ruby 无注音断言更新；`markdown-editor-extensions.test.ts` 追加 6 个 round-trip 用例（规范化组合、残片保数据、截断保源码块、ruby 并集不变量钉、ruby 无注音退化、伪标签 chip）；新建 `dialect-fallback-dom.test.ts`（jsdom，Bridge DOM 自愈真实路径——node 环境 parseHTMLToken 无 window 走转义纯文本分支测不到）。
- 文档：`reference/content/markdown-dialect.md` 新增「宽容形态与规范化」小节 + Comment 形态规则、Raw HTML 残片行为更新。

与计划的出入：

- 计划中「多段混合残片 → chip 保数据」的 editor 用例原想在 node 环境断言 `<comment>` 字面保留，实测 node 下 Bridge 交回 DOM 的退化分支会把标签转义为 `&lt;comment&gt;`（文本不丢但形态变了）——该环境行为无断言价值，删除 node 版用例，DOM 真实路径由 jsdom 文件覆盖（Plan 代理审查时已预警此点）。
- 其余按计划执行，无方向修正。验证：shared+app 全量 299/299、typecheck 全绿。

### 2026-07-11 审查修复轮（/code-review high 7 findings 全处置）

审查过程：8 个 finder 子代理全被 API 429 击落，主会话内联完成 8 角度审查（30+ 疑点逐一核实代码路径），7 条存活并全修：

- **F1（真 bug）`StructuredTextEditor.vue`**：rich/source 模式切换用 v-if 销毁编辑器，而防抖改造后编辑器 unmount 只 cancel 不上报——该组件数据宿主（modelValue）不变，销毁前必须结算，否则打字 300ms 内切换丢尾巴（此前靠「点按钮触发 blur→flush」隐式兜底，外部 `:mode` prop 程序化切换完全无兜底；组件被 Plot/章节/Profile/Agent 气泡等 15+ 处消费）。修复：`watch(effectiveMode, flush 两个 handle, {flush: "sync"})` 统一覆盖内外两条切换路径（sync 时机保证旧实例仍挂载）。**不改 v-show**：Monaco 重资源 × 一页多实例，懒挂载是有意设计。组件级自动化测试挂不了 .vue（vitest 无 vue 插件），靠时序推演 + 用户浏览器验收。
- **F2 `markdown-workbench.ts`**：normalize 开标签正则改为与各方言块 pattern 逐标签同构（comment/bilingual 宽松属性、align 必须带合法 value、html 只认裸标签），消除 `<align>`（无 value）/`<html lang>` 被拆段却无 tokenizer 认领的孤立源码块中间态；测试钉住两个伪形态不拆。
- **F3 测试 schema 单一来源**：新建 `markdown-dialect-extensions.ts` 导出 `createMarkdownDialectExtensions()`（基座 + 全部带 markdownTokenizer/markdownTokenName 的方言与兜底，无 .vue 依赖），真实 `markdown-editor-extensions.ts` 消费它再追加 UI 层；三个测试文件删掉手拼列表改 import 同一函数。审查时已证实漂移真实发生过（extensions 测试环境缺 MarkdownParagraph 1500）。
- **F4 `HtmlFallback.ts`**：Bridge 完整性自愈从 `endsWith` 后缀判据换成复用 `findMatchingCloseEnd` 的真配对判据（配对闭合恰好覆盖到结尾才交 DOM），堵住 `<comment>a</comment>x</comment>` 构造下第二个孤立闭标签被 DOM 静默丢弃；node 测试钉住。
- **F5 `InlineAiReferenceHighlight.ts`**：`buildTextMap`（O(全文)）上提到引用循环外构建一次传入，消除 O(refs×全文)。
- **F6 `markdown-workbench.ts`**：fence 状态机抽 `createFenceLineFilter()`（闭包持状态，返回 true=该行属围栏应跳过），主循环与闭标签搜索共用，消除两份同构代码。
- **F7 `markdown-workbench.ts`**：normalize 早退从 `includes("<")` 强化为方言开标签宽松预检 `DIALECT_OPEN_TAG_HINT_PATTERN`，含 `<mark>` 等行内标签的常见文档零成本跳过全行扫描。

验证：shared+app 全量 301/301（含新增 F2 两用例 + F4 一用例）；本轮全部文件 typecheck 干净（仓库当前唯一类型错误在 `server/agent/variables/variables.test.ts`，来自并行会话未完成的变量系统重构，与本轮无关）。待用户浏览器抽验 F1：任一 StructuredTextEditor 宿主打字后 300ms 内切 rich/source，内容不丢。

## TODO / Follow-ups

- 浏览器走查（见 Verification，用户自行验收）；建议重点用几万字章节实测 rich / source 两模式打字流畅度。
- 评论面板 UI 未区分行内/块级形态的视觉标识，后续可给块级评论卡片加个 kind 徽标。
- `useMarkdownStudioController` 的 `openStream`「replace-selection / insert-cursor」流式路径仍是每 chunk 走 `insertMarkdown`，未做 append 优化（流式打字机有节流，暂不构成瓶颈）。
- 只读渲染管线（聊天气泡 `app/utils/markdown/render.ts`）对块级 comment / bilingual 未做专门渲染，按原生 HTML 直出（浏览器当未知标签透传正文），需要时再补。
- 防抖窗口内浏览器崩溃 / 强杀会丢最多 300ms 输入（flush 钩子只覆盖程序内切换路径），属可接受损失，暂不做 beforeunload flush。
- `syncWorkspaceTabDirty` 每次重建整个 tabs 数组、`hasUnsavedFileChanges` 等全文 computed 仍是每次上报全跑；防抖后频率从每键降到每 300ms，已不构成瓶颈，若后续仍有卡顿再做增量化。
