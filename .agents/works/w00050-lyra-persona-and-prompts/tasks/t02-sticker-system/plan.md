# t02 表情包：实施计划

## Context

开发者 2026-11-17 提出给 Agent 对话加表情包（Discord 式写法、Provider、提示词槽、`stickers://`），并在对话里确认了方向：

1. 写法 `:名字:`，名字可用中文，重名时 `:包/名字:`；认不出照原文显示。
2. 两种大小：夹在文字里约两倍字高；一段只有表情时显示成大图。
3. 在 Agent 回复里显示成图；用户消息不变。
4. 表情包是带清单的文件夹，照 Skill 的白名单选包：插件 Profile 在声明里写，用户 Profile 在 Profile 设置里加减；星璃的包先放 `user://stickers/lyra/`。插件可以提供表情包。
5. 第一版不做用户发表情。
6. 先用占位图做通链路，星璃的图另起。
7. 表情写法做成 Markdown 方言，编辑器也能用（“可以，都同意”）。

依据：Spec 草稿 [`docs/specs/agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（planned）；照搬的现有做法：[`agent/skills.md`](../../../../../docs/specs/agent/skills.md)（来源、插件目录、白名单、`skills://`）、[`harness/profile.md`](../../../../../docs/specs/harness/profile.md) 输出 15、16（槽）、[`workspace/markdown-syntaxes.md`](../../../../../docs/specs/workspace/markdown-syntaxes.md)（方言贡献）、[`ui/markdown-display.md`](../../../../../docs/specs/ui/markdown-display.md)。

## 技术选型

- 清单校验：TypeBox（仓库已用，贡献声明与设置都用它）。
- 图片类型判定：复用 `nbook/shared/image-type` 的按字节判定，不另写。
- 写法分词：`marked` 的行内扩展（语法模块的 `marked` 字段），与内置方言同一条路。
- 编辑器里的整体节点与输入规则：Tiptap 的 atom 行内节点与 `InputRule`。
- 文件监视：沿用 Skill 目录的监视做法（`agent/backend/skills/catalog.ts`），不引新库。

## 关键设计

### 新内置插件 `nbook.stickers`（`packages/neuro-book/src/plugins/stickers/`）

为什么单独一个插件：表情写法编辑器也用，不只属于 Agent；表情目录、`stickers://`、取图路由、方言都围绕同一份目录。白名单与槽放 `nbook.agent`，因为 Profile 的声明与设置归它，`nbook.stickers` 不认识 Profile。依赖方向：`nbook.agent` 可选依赖 `nbook.stickers`。

- `shared/manifest.ts`：清单 schema（TypeBox）、文件夹名与表情名规则、上限常量；`shared/sticker-ref.ts`：写法的匹配与“找表情”（输出 5）的纯函数，前后端共用。
- `shared/plugin.ts`：贡献点 `stickers.packs`（声明 `{directory}`，校验同 `agent.skills`，复用 `agent/backend/skills/plugin-roots.ts` 的路径规则，抽到共享处或照写一份并注明）。
- `backend/catalog.ts`：扫描与监视 `user://stickers/` 和插件目录，无效隔离与诊断（输出 1–4）；交出 `list()`、`find(ref)`、`changed` 订阅。形状照 `SkillCatalog`。
- `backend/schemes.ts`：`stickers://` 的 `MountedSchemeSpec`，只读，挂载点是表情包 id，经 `MountDeclaration.container`/`directory` 指到各自的文件夹（与 `skills://` 同法）。
- `backend/routes.ts`：经 `http.routes` 交 `GET /api/nbook.stickers/image/<id>/<文件名>`，只给目录里有效表情的文件；判型、响应头与跨站规则照 `files/backend/raw-route.ts`（`nosniff`、`sandbox`、`ETag`、`Sec-Fetch-Site`）。
- 远程服务 `nbook.stickers`：`catalog()`（表情包与表情，含图片 URL）与目录变化的通知；服务端服务键给 `nbook.agent` 用。
- `web/catalog.ts`：浏览器一侧的目录，窗口启动时取一次、随通知更新；同步的 `lookup(ref)` 给方言用。
- `web/syntax/`：方言实现。声明（`markdown.dialects`，无标签）与实现（`markdown.syntaxes`）。行内节点 `sticker`，属性 `raw`（原文）；读法由 `marked` 行内扩展分出；写法原样写 `raw`；`renderHTML` 按 `lookup` 画 `<img>` 或原文；`resolve` 给一段只有表情的段落里的节点标 `alone`（列进 `derivedAttrs`，读回校验不比较）；编辑器的节点视图同样按 `lookup` 画，并按所在段落现算大小；`InputRule` 在打出结尾的 `:` 时换成节点。
- 装配清单 `src/manifest.ts` 登记新插件。

要守住的不变量：方言不生效时文件字节不变（markdown-syntaxes 输出 8）；认不出的写法读进来也是节点、写回原文，所以解析结果不随目录变（同一份语言在任何时刻读同一份原文得到同一棵树，markdown-syntaxes 输出 5 的要求）。

### `nbook.agent`（`packages/neuro-book/src/plugins/agent/`）

- `shared/points.ts`：`agent.profiles` 声明加 `stickers?: {allowed: string[] | "all"}`；`shared/settings.ts`：`profileSettings` 每项加 `stickers?: ToolBinding`。
- `shared/profile-skills.ts` 的 `declaredSkills`、`profileSkills` 不带 Skill 语义，改名为通用的白名单合成（例如 `profile-allowlist.ts`），Skill 与表情包共用。
- `backend/stickers/extension.ts`：扩展 `nbook.agent.stickers`，`contribute.stickers` 按输出 12–15 生成槽文字（照 `subagents/prompt.ts`）；最短写法的计算用 `nbook.stickers` 的共享纯函数。
- `web/components/ProfileStickersSection.vue`（加同名 `.md`）：照 Skill 一节；挂在 `ProfileDetail.vue` 的 Skill 一节下面。
- 用户 Profile `user.lyra`、`user.lyra-dual` 的模板加 `<Slot name="stickers" />`：在 `.dev-state`，不进 Git，交付时说明。

### Lab 与占位图

- Lab 场景：展示器（行内、一段只有表情、认不出、重名）与编辑器各一个，占位图放 Lab 的 fixture 目录（几张小的 WebP）。
- 星璃的表情包占位：`user://stickers/lyra/`（开发状态根里，不进 Git）。

## Spec 与文档改动

- 新 `docs/specs/agent/stickers.md`（本次草稿），注册表加一行。
- `agent/contributions.md`：`agent.profiles` 声明的表格加 `stickers?`，并加一条输出（同输出 20 的写法，链接 stickers.md）。
- `agent/profile-settings.md`：加“表情包”一节的输出（链接 stickers.md 输出 16）。
- `agent/resources.md`：只在“方案”处链接 `stickers://` 由 `nbook.stickers` 提供（不复述）。

## 切片

1. **方言探路（前端，先做）**：`web/syntax/` 与 `sticker-ref.ts`，用写死的 `lookup` 在 nb-markdown 的组件测试与 Lab 里跑通读、写回、读回校验、输入规则、两种大小。这是仓库里第一个经贡献点交出、不用标签的外来方言，codec 的转义降级与读回校验对它的表现没有先例，先证明可行再做后面的。提交边界：方言模块与测试。
2. **表情目录、`stickers://`、取图路由（后端）**：`nbook.stickers` 的 shared 与 backend，插件登记。测试用真实的文件夹与测试插件。
3. **浏览器目录与接线（前端）**：远程服务、`web/catalog.ts`、方言接上真实目录；Lab 场景换成经插件挂上。
4. **白名单与槽（后端）**：声明与设置字段、白名单合成的通用化、扩展与槽；测试用内核测试工具看请求的 `outline()`。
5. **Profile 设置的“表情包”一节（前端）**。
6. **收口**：e2e（对话里显示一条带表情的回复）、Spec 证据、`user.lyra` 的手动 Smoke。

每片自跑：`bun run test:affected`、相关包的类型检查；前端片另跑对应 dom 测试与 Lab 截图。

## 验收映射

| Spec 条目 | 测试 |
|---|---|
| 输出 1–4、失败与恢复的诊断 | `stickers/backend/catalog.test.ts`（真实目录、测试插件） |
| 输出 5、6、写法规则 | `stickers/shared/sticker-ref.test.ts` |
| 输出 7–8 | 方言的展示器 dom 测试 |
| 输出 9、18、场景 4 | 方言的编辑器 dom 测试（读、写回字节、输入规则） |
| 输出 10–11、场景 5 | `stickers/backend/schemes.test.ts`（经真实 Files） |
| 取图路由 | `stickers/backend/routes.test.ts` |
| 输出 12–15、场景 1、3 | `agent/backend/stickers/extension.test.ts`（内核测试工具） |
| 输出 16 | `ProfileStickersSection.dom.test.ts` |
| 场景 2 | e2e `e2e/stickers.e2e.ts`（新） |

## 验证

- 合入前 e2e：`e2e/stickers.e2e.ts`、覆盖 Profile 设置页的那个文件、`markdown-properties.e2e.ts`（方言加入后编辑器回归）。改动后只重跑受影响的。
- 真实浏览器：Lab 两个场景截图（亮色）；开发服务里 `user.lyra` 会话手动 Smoke 一次（真实模型调用要开发者同意，或由开发者自己发一句）。
- 未验证边界：第三方插件的大量表情包（数百个）对窗口启动取目录的耗时，只按上限估算。

## 不做与风险

- 不做：用户发表情、编辑器的插入菜单与补全、模型看图、表情不计字数。
- 风险 1：外来非标签方言在 codec 里的转义与读回（切片 1 兜底）。普通文字里打了 `:abc:` 又不想要表情时，没有退路，只能改写法（例如写成全角冒号）；输入规则对已知与未知名字一视同仁，可能让人意外。切片 1 做完给开发者看一眼。
- 风险 2：浏览器目录还没取到时显示的块不重画（已知限制）。窗口启动时就取，对话通常晚于它。
- 风险 3：把 `profile-skills.ts` 通用化会改 Skill 的引用处，靠 Skill 现有测试兜底。

## 待确认（我自己定的默认值）

- 大图高约 120 像素；槽至多列 60 个常用表情；清单上限：一个表情包 500 项、每张图 2 MiB、说明 200 字。
- 内置表情包不另设 `builtin` 来源，由内置插件经 `stickers.packs` 交出（ADR 0027，比 Skill 少一种来源）。
- 编辑器里打出未知名字也变成表情节点（为了读与输入一致）。
