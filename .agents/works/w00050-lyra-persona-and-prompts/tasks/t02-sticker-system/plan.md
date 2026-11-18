# t02 表情包：实施计划

第二版（设计审查后）。第一版与两份审查报告见 `evidences/design-review-frontend.txt`、`evidences/design-review-backend.txt`，处理见 `evidences/design-review-disposition.txt`。

## Context

开发者 2026-11-17 提出给 Agent 对话加表情包（Discord 式写法、Provider、提示词槽、`stickers://`），并在对话里确认了方向（Task README 的“决定”1–8）。设计审查后又确认三条（决定 10–12）：

- 表情写法做成 nb-markdown 的**内置方言**，目录经宿主端口交入：插件交出的方言是异步加载的，而编辑器与展示器在建立时取定语言，窗口启动时恢复的标签与历史对话会赶在方言之前建立，整页不认表情。
- 槽里一律教带包的写法 `:包/名字:`：不带包的写法重名就认不出，别处加一个同名表情会让历史回复变回原文、改掉系统块。
- 在 Files 修挂载点被整个换掉后的重开（`skills://` 一起受益）。

依据：Spec [`docs/specs/agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（planned）与本次加的 planned 条目：`workspace/markdown-syntaxes.md`（内置方言名单）、`ui/markdown-display.md`（端口 `resolveSticker`）、`workspace/resources.md`（挂载点重开）、`agent/contributions.md` 输出 23、`agent/profile-settings.md` 输出 27。参照：`agent/skills.md`（来源、插件目录、白名单、`skills://`）、`harness/profile.md` 输出 15、16（槽）。

## 技术选型

- 清单校验：TypeBox（仓库已用）。
- 图片类型：复用 `nbook/shared/image-type` 的 `sniffImageType`。
- 图片宽高：读 PNG、GIF、WebP、JPEG 的文件头取宽高。先查仓库与依赖里有没有现成的（例如 `image-size`）；没有就评估加 `image-size`（纯 JS、无原生依赖、维护活跃），不手写四种格式的解析。新增依赖记进待确认清单。
- 写法分词：`marked` 行内扩展，与内置方言同一条路。
- 编辑器的整体节点、输入规则与大小装饰：Tiptap atom 行内节点、`InputRule`（自带退格还原）、ProseMirror 插件的节点装饰。
- 文件监视：沿用 Skill 目录的做法（`agent/backend/skills/catalog.ts`）。

## 关键设计

### nb-markdown：内置方言 `sticker`（`packages/nb-markdown/src/language/syntax/sticker/`）

- 写法的匹配与规范化（NFC、包段字符集、名字规则）放在 `sticker/ref.ts`，从包的公开入口导出，`nbook.stickers` 的目录与槽、`InputRule` 都用它，三处同一个判断。
- 节点 `sticker`：行内、atom，属性 `raw`（原文）。`leafText` 返回 `raw`（复制得到原文）。`renderHTML` 画带 `data-sticker`、`alt`、`title` 的元素；`parseHTML` 认 `[data-sticker]`，优先级高于核心的 Image（`syntax/core/index.ts` 里 Image 的 `parseHTML` 认 `img[src]`），所以粘贴回来不变成图片。
- 读法：`marked` 行内扩展认写法，前后紧挨什么都认；`\:` 是转义。写法：原样写 `raw`。
- 留作文字的写法：核心写文字时的最小转义加一条：会被读成表情写法的开头 `:` 写成 `\:`，免得读回不一致落到整块降级（审查实测降级会把 `_斜体_` 改写成 `*斜体*`）。看核心写文字的转义入口能不能按语法模块登记，能就由 `sticker/` 登记，不能就加这个入口。
- 显示：展示器的静态视图与编辑器的节点视图共用一个外观函数（同提示块、图片的做法）：按宿主端口 `resolveSticker(raw, signal)` 先画占位，结果到了画图或原文，失败画原文；`release` 在块被替换或卸载时调用。
- 大小：一个判断函数“这个文本块里只有表情与空白、且不超过 3 个”。编辑器用 ProseMirror 插件给这类文本块加节点装饰（类名），每次文档变了重算受影响的块；展示器在读入后给同一个块加同一个类名（`display/renderer.ts` 已有读入后处理 DOM 的先例）。CSS 一份，大小用 CSS 变量。
- 输入规则：打出结尾的半角 `:` 时，前面是一个完整写法就换成节点；组字期间 Tiptap 自己不触发。
- 宿主端口：`MarkdownHost`（展示器，`host/index.ts`）与编辑器的视图宿主（`MarkdownViewHost`）各加可选的 `stickers?: StickerResolver`，类型只定义一处。没提供时显示原文。
- 内置方言名单加 `sticker`，声明加进 `nbook.markdown` 的 `BUILTIN_DIALECTS`（无标签）。

### `nbook.stickers` 插件（`packages/neuro-book/src/plugins/stickers/`）

- `shared/manifest.ts`：清单 schema（TypeBox）、上限常量。`shared/plugin.ts`：贡献点 `stickers.packs`（声明 `{directory}`，路径规则复用 `agent/backend/skills/plugin-roots.ts`：抽到 `plugin-platform` 的共享处，或在原处导出给两边用）。
- `backend/catalog.ts`：启动时建 `user://stickers/`，扫描与监视、插件来源；无效分三层（输出 2–4），扫描时按字节判类型、取宽高；诊断只在问题变了时写（照 Skill 的 `#replace` 比较）。交出 `list()`、`find(ref)`、变化订阅；每个表情带版本（修改时间与大小）。
- `backend/schemes.ts`：`stickers://`，只读，挂载点经 `MountDeclaration.container/directory` 指到各自的文件夹（同 `skills://`）。
- `backend/routes.ts`：经 `http.routes` 交取图路由。照 `agent/backend/attachments.ts`：经 `WorkspaceFiles.read("stickers://…")` 读，读取时再判类型与大小；跨站规则、响应头与缓存按 Spec 的“边界与兼容”。
- 远程服务：`catalog()` 交浏览器目录（只带显示要用的，合计至多 5000 个表情，输出 18），变化通知。服务端服务键给 `nbook.agent` 用。
- `web/catalog.ts`：浏览器目录，入口激活后取、随通知更新；交出浏览器服务 `stickersKey`，提供 `resolveSticker`（目录没到时等，到了查表、交回 URL 与宽高）。
- 插件描述登记：顶层贡献（浏览器与服务端两个位置都有入口）、`files.schemes`、`http.routes`；装配清单 `src/manifest.ts`。

### `nbook.markdown` 接线

- `markdown/web/host.ts` 的 `nbookMarkdownHost` 与编辑器的视图宿主带上 `stickers`：可选依赖 `nbook.stickers` 的浏览器服务，没有时不带。

### Files：挂载点被换掉后重开（`packages/neuro-book/src/plugins/files/backend/mounted.ts`）

- 打开着的挂载点遇到 `root-gone` 时丢掉它、按当前声明重开一次再执行这个请求；在途的请求照旧按旧目录结算。只重开一次，重开后仍失败照常报。测试：挂载点的目录删掉再建同名的，下一次读得到新内容。

### `nbook.agent`

- `shared/points.ts` 声明加 `stickers?`；`shared/settings.ts` 的 `profileSettings` 每项加 `stickers?: ToolBinding`。
- `shared/profile-skills.ts` 的白名单合成不带 Skill 语义，改名通用化（例如 `profile-allowlist.ts`），Skill 与表情包共用。
- `backend/stickers/extension.ts`：扩展 `nbook.agent.stickers`，`contribute.stickers` 按输出 14–17 生成槽（照 `subagents/prompt.ts`），依赖 `nbook.stickers` 的服务端服务。
- 设置页：`ProfileToolsSection.vue` 的 `kind` 加 `"stickers"`（行带缩略图），补 `profiles.stickers.*` 文字；`web/profile-edits.ts` 把 agents、skills 两份逐字相同的选择函数合成一个按字段名的，再用于表情包；`profile-view.ts` 抽“按来源分组的绑定字段”。不新写一个组件。
- 用户 Profile `user.lyra`、`user.lyra-dual` 的模板加 `<Slot name="stickers" />`：在 `.dev-state`，不进 Git，交付时说明。

### Lab 与占位图

- Lab：展示器与编辑器的表情场景，用测试端口（可设“目录晚到”），占位图放 Lab 的 fixture 目录（几张小的 WebP）。
- 星璃的占位表情包放 `user://stickers/lyra/`（开发状态根，不进 Git）。

## 切片

1. **nb-markdown 的 `sticker` 方言（前端，先做）**：ref、节点、读写、转义、输入规则、大小装饰、端口与外观函数、复制粘贴。测试在 nb-markdown 里，用真实的编解码器与可延迟的测试端口，覆盖：邻接汉字与字母写回、退格还原后的写回、`_斜体_` 不被改写、HTML 粘贴往返、编辑别处后大小更新、端口晚到时先占位后成图、展示器与编辑器元素一致。另跑 `check:dist`。做完给开发者看一眼 Lab。
2. **Files 挂载点重开（后端）**。
3. **`nbook.stickers` 后端**：清单、目录、`stickers://`、取图路由、远程服务；测试用真实文件夹与测试插件。
4. **浏览器目录与接线（前端）**：`web/catalog.ts`、`nbook.markdown` 的端口接线、Lab 换成经插件挂上。
5. **白名单与槽（后端）**。
6. **Profile 设置的“表情包”一节（前端）**。
7. **收口**：e2e、Spec 证据与晋升核对、`user.lyra` 的手动 Smoke。

每片自跑：`bun run test:affected`、相关包的类型检查；前端片另跑对应 dom 测试与 Lab 截图。

## 验收映射

| Spec 条目 | 测试 |
|---|---|
| 写法规则、输出 7–9 | `nb-markdown/src/language/syntax/sticker/ref.test.ts`；`stickers/backend/catalog.test.ts`（找表情） |
| 输出 10–12、21–24、场景 4 | nb-markdown 的 `sticker` 编辑器与展示器 dom 测试（真实编解码器、测试端口） |
| 场景 5 | 同上的“端口晚到”用例，加 e2e 的窗口启动恢复 |
| 输出 1–6、失败与恢复的诊断 | `stickers/backend/catalog.test.ts`（真实目录、测试插件） |
| 输出 13、场景 6 | `stickers/backend/schemes.test.ts`（经真实 Files） |
| 场景 7、resources 的挂载点重开 | `files/backend/mounted.test.ts` 加用例；`stickers/backend/schemes.test.ts` |
| 取图路由（边界与兼容） | `stickers/backend/routes.test.ts`：有效、无效、读取时换成非图片、跨站、版本与缓存头 |
| 输出 18 | `stickers/backend/catalog.test.ts`（上限）、`stickers/web/catalog.dom.test.ts` |
| 输出 14–17、场景 1、3 | `agent/backend/stickers/extension.test.ts`：经真实的 `nbook.stickers` 服务端服务与内核测试工具看请求的 `outline()` |
| contributions 输出 23 | `agent/shared/points` 的声明校验测试 |
| 输出 19、profile-settings 输出 27 | `ProfileToolsSection` 的 dom 测试加 `kind: "stickers"` |
| 场景 2 | e2e `e2e/stickers.e2e.ts`（新） |

## 验证

- 合入前 e2e：`e2e/stickers.e2e.ts`（含窗口启动恢复）、覆盖 Profile 设置页的那个文件、`markdown-properties.e2e.ts`（编辑器回归）。改动后只重跑受影响的。
- `check:dist`（首屏不带 ProseMirror 与 `marked`）。
- 真实浏览器：Lab 两个场景截图（亮色）；开发服务里 `user.lyra` 会话手动 Smoke（真实模型调用由开发者发一句）。
- 未验证边界：几千个表情时浏览器目录的取回耗时，只按上限估算。

## 不做与风险

- 不做：内置表情包、用户发表情、编辑器的插入菜单与补全、模型看图、表情不计字数、减少动态效果时停播动图。
- 风险 1：核心写文字的最小转义要能知道表情写法（切片 1 兜底）；做不到时退回“整块降级”，要再找开发者。
- 风险 2：作品正文里半角冒号写的 `:你好:` 会在编辑器里变成整体节点（去掉边界规则的代价，开发者已知）。
- 风险 3：白名单合成通用化会改 Skill 的引用处，靠 Skill 现有测试兜底。
- 风险 4：Files 挂载点重开改的是所有挂载方案共用的路径，靠 Files 现有测试与 `skills://` 的测试兜底。
