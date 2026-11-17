---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.stickers
owners:
  - nbook.stickers
  - nbook.agent
  - nbook.markdown
---

# 表情包

## 目标与非目标

让 Agent 在回复里发表情：用户把表情包（一个带清单的图片文件夹）放进 `user://stickers/`，或由插件带来；每个 Profile 有自己能用的表情包，常用的表情连同“什么时候用”放进提示词，完整目录在 `stickers://` 里由模型按需翻；模型在回复里写 `:包/名字:`，对话里显示成图。表情写法是 nb-markdown 的一种内置方言，Markdown 编辑器、展示器与字数用的是同一份规则。

不承诺：

- 内置表情包：第一版只有插件与用户两种来源；内置插件取不到自己的插件包目录（[runtime.plugin-code-loading](../runtime/plugin-code-loading.md) 输出 11），以后要随应用分发表情包时另加 `builtin` 来源。
- 用户在输入框里发表情（表情选择器）；用户消息照现有的提示词文字视图显示，不认表情写法。
- 编辑器里插入表情的菜单或补全；编辑器只在打完整个写法时变成表情（输出 22）。中文输入法下要打半角冒号。
- 模型看图：模型只看到名字与清单里的说明，不看到图片本身。
- 表情不计字数：表情写法按普通文字计入字数。
- 已经显示出来的表情不随目录变化重画：换了图、删了表情包，之后新显示的块用新的目录（已知限制）。
- 动图在“减少动态效果”的系统设置下照常播放。
- 按 Profile 限制显示：模型写了白名单以外的表情包里的表情，照样显示成图；白名单只决定提示词里列出哪些。

## 术语与参与者

- **表情包**：一个文件夹，里面有清单 `stickers.json` 和图片。**文件夹名**是表情包的名字。
- **表情**：清单里的一项：名字、图片文件、什么时候用、是否常用。
- **来源**：`plugin`（第三方插件经贡献点 `stickers.packs` 带来）、`user`（`user://stickers/` 下的）。**表情包 id**：用户的是 `user.<文件夹名>`，插件的是 `<插件 id>.<文件夹名>`；来源以条目的 `source` 为准，不从 id 前缀推断。
- **表情目录**：应用当前认得的全部表情包。
- **白名单**：一个 Profile 能用的表情包 id 的有序列表，合成规则同 Skill（[`skills.md`](skills.md) 的“白名单”）：声明的在前，用户加的在后。
- `nbook.stickers`：内置插件，持有表情目录、`stickers://`、取图路由与浏览器一侧的目录。`nbook.markdown` 把浏览器一侧的目录经宿主端口交给 nb-markdown（输出 18）。`nbook.agent` 持有白名单与提示词里的槽。

## 输入与前置条件

**清单** `stickers.json`，至多 256 KiB：

```ts
interface StickerPackManifest {
    title?: string;           // 显示名，缺省用文件夹名
    description?: string;     // 一句话说这个表情包是谁的、什么风格
    stickers: Array<{
        name: string;         // 表情名
        file: string;         // 图片文件名
        when?: string;        // 什么时候用，给模型看
        common?: boolean;     // 常用的进提示词（输出 14）
    }>;
}
```

| 项 | 规则 |
|---|---|
| 文件夹名 | 1–64 个小写字母、数字与连字符，不以连字符开头或结尾，没有连续的连字符 |
| 表情名 | 规范化到 NFC 后 1–32 个码点，只含 Unicode 字母、数字、`_`、`-`，第一个是字母或 `_`；区分大小写；同一个表情包里不重名 |
| `file` | 表情包文件夹里的单段文件名，不是链接；扩展名 `.png`、`.gif`、`.webp`、`.jpg`、`.jpeg`（不分大小写）；按文件开头的字节判定是这四种图片之一且与扩展名相符；至多 2 MiB；宽、高都不超过 1024 像素 |
| `title`、`description`、`when` | 至多 200 个字符 |
| `stickers` | 至多 500 项 |

**插件来源**：插件用顶层贡献 `stickers.packs` 声明插件包里的一个目录，声明 `{directory}`，路径规则同 `agent.skills`（[`skills.md`](skills.md) 输出 30）；目录里每个子文件夹是一个表情包。贡献 id 以插件 id 加 `.` 开头。

**表情写法**（行内）：

```text
:名字:            不带包
:包/名字:         包是文件夹名或表情包 id
```

- 包段：1–128 个 ASCII 小写字母、数字、`.`、`-`、`_`。名字段按上表的表情名规则（按 NFC 比较）。
- 写法前后紧挨什么字都认（同 Discord）：`今天:开心:好` 里是一个表情。名字不能以数字开头，所以 `10:30:00` 不是写法。
- 行内代码与代码块里不认；`\:` 是普通的冒号，`\:开心:` 不是写法。

**白名单**：`agent.profiles` 的声明加 `stickers?: {allowed: string[] | "all"}`，值是表情包 id；用户在 Profile 设置里按 Profile 增删，存在 `profileSettings[key].stickers: {added: string[], removed: string[]}`。合成：声明的（`"all"` 时取当前目录的全部 id，按 id 的码元顺序），加 `added`，减 `removed`。没有声明、用户也没加的 Profile 没有能用的表情包。

**槽**：`nbook.agent` 的扩展 `nbook.agent.stickers` 交槽 `stickers`（稳定的）。Profile 模板用 `<Slot name="stickers" />` 摆放（[`harness/profile.md`](../harness/profile.md) 输出 15、16）。

## 输出与可观察行为

### 目录

1. `nbook.stickers` 启动时建好 `user://stickers/`（已有的不动）、扫一遍，之后随 `user://stickers/` 的文件变化更新；插件来源随 `stickers.packs` 的发布与撤回出现、消失，插件的目录不监视。
2. 无效的表情包只隔离它一个：照样列出，状态 `invalid`，`problem` 写原因。算无效的：没有 `stickers.json`、它超过 256 KiB、读不懂或不是对象、`stickers` 不是数组、文件夹名不合规则、文件夹是链接。
3. 表情包的可选字段（`title`、`description`）不合规则时只忽略那个字段，表情包照常可用。
4. 无效的表情只隔离它一项，这一项不列，别的照常。算无效的：名字不合规则、同包重名（后出现的）、`when` 超长、文件不在、是链接、扩展名不对、字节不是相符的图片、超过 2 MiB 或 1024 像素。`stickers` 超过 500 项时只认前 500 项。
5. 诊断只在问题变了时写：同一个表情包的问题与上一次扫描相同时不再写。码见“失败与恢复”。
6. 同一个插件的两个 `stickers.packs` 贡献里有同名文件夹时，按贡献 id 的码元顺序先到的生效，后到的不列。声明的目录不在插件包里、不是目录或经过链接时，这个贡献不出表情包。

### 找表情

7. 带包的写法：包先按表情包 id 认，认不出按文件夹名认；按文件夹名认到不止一个表情包是认不出。然后在这个表情包里按名字找。
8. 不带包的写法：在全部有效的表情包里按名字找，恰好一个是它；不止一个或没有是认不出。
9. 认不出的写法显示成原文。

### 显示

10. 展示器（[ui.markdown-display](../ui/markdown-display.md)：对话里 Agent 的回复、过程中的说明文字与思考全文）与 Markdown 编辑器里，认得出的写法显示成图，替代文字与悬停提示都是写法的原文；目录还没取到时先显示占位（弱色的原文，按普通文字排），取到后显示图或原文；图片读取失败时显示原文。表情前后留一点间隙。
11. 大小：一个文本块（段落、标题、列表项与引用里的段落、表格单元格）里只有表情与空白、且表情不超过 3 个时，这些表情显示成大图（高约 120 像素）；否则显示成行内小图（高约 1.6 倍字高，不撑高这一行：有没有表情的行一样高）。宽按图片比例。编辑器里编辑同一个文本块的别处时大小随之更新。
12. 展示器与编辑器里同一份原文生成的表情元素结构与类名相同（同 [ui.markdown-display](../ui/markdown-display.md) 输出 2）。

### 资源地址与取图

13. `stickers://` 的根列出目录里的全部表情包，每项写 id、显示名、说明、来源、表情数与状态（无效的写原因）。`stickers://<表情包 id>/` 是这个表情包的文件夹：能读、能列、能取真实路径；Agent 写入得 `permission-denied`。用户的表情包同时在 `user://stickers/<文件夹名>/`，用户经那里改。整个表情包文件夹被换掉（删掉后放进同名的新文件夹）后，下一次读、列取图都对着新的文件夹（[workspace.resources](../workspace/resources.md) 的挂载方案）。

### 提示词里的槽

14. 槽 `stickers` 的内容：开头一句写法说明（`:包/名字:`，完整目录在 `stickers://`）；之后白名单里每个有效的表情包一段，按白名单的顺序：显示名、说明、这个表情包的地址 `stickers://<表情包 id>/`，常用的表情每个一行 `写法 — 什么时候用`。写法一律带包：包写文件夹名；全部有效的表情包里有同名文件夹时写表情包 id。
15. 上限：至多 8 个表情包、合计 60 个常用表情，按白名单的顺序、包内按清单顺序取；多出的不列，末尾写一句“还有更多，见 stickers://”。整个槽至多 6000 个字符。
16. 白名单为空、或白名单里没有有效的表情包时，槽没有内容（模板摆了也不渲染）。
17. 槽的内容只随白名单里的表情包变：表情目录与白名单不变时逐字相同；白名单以外的表情包增删不改槽（同名文件夹的情形除外，见输出 14）。变了的从下一次请求起用新的内容。

### 浏览器一侧的目录

18. 浏览器一侧的目录只带显示要用的：每个有效的表情包的 id、文件夹名，每个有效表情的名字、宽、高与取图地址；不带说明与“什么时候用”。合计至多 5000 个表情、序列化后至多 768 KiB（远程调用单条消息的上限以内），放不下的表情包整包不进浏览器目录（按 id 的码元顺序取），写诊断 `stickers.catalog-truncated`；Profile 设置用的表情包概要按同样的字节上限取。`stickers://` 与槽不受这条影响。目录变了经通知更新。

### 界面

19. Profile 设置的“表情包”一节，放在“Skill”一节下面，行、分组、添加与恢复默认同 Skill 一节（[`profile-settings.md`](profile-settings.md) 输出 26）：按来源分组（我的在前、各插件一组），一行一个表情包（第一个常用表情的缩略图、显示名、说明、表情数），写入 `profileSettings[key].stickers`。
20. 设置里没有单独的表情包页：表情包的增删经 `user://stickers/` 的文件。

### 编辑器

21. Markdown 编辑器里，表情写法读成一个整体的行内节点（不论认不认得出）：光标一步跨过、删除一次删掉整个；写回原文。不编辑时字节不变，编辑同一块的别处后这处写回仍是原文。
22. 打字打出一个完整的写法（输入结尾的半角 `:` 时）变成表情节点；紧接着按一次退格还原成打出的文字。输入法组字期间不变。
23. 留作文字的写法（退格还原的、纯文字粘贴的）写回时开头的冒号写成 `\:`，同一块里别的字节不变。
24. 复制含表情的选区：纯文字里是写法的原文；带格式的内容粘贴回编辑器仍是表情节点，不变成图片。

## 状态与转换

表情包：`ok`、`invalid`。重扫时改变；撤回的插件来源从目录里消失。

时序与寿命：

- 浏览器一侧的目录在 `nbook.stickers` 的浏览器入口激活后取一次，之后随通知更新。nb-markdown 经端口查表情（输出 10）：目录还没取到时端口的结果等到取到为止，显示占位；取不到（服务不可用）时按认不出显示原文。
- 一个表情显示出来之后不因目录变化重画（不承诺里的已知限制）；块被替换或卸载时释放它的图片，同 [ui.markdown-display](../ui/markdown-display.md) 输出 8。
- 槽在每次请求前现算（输出 17 的稳定条件）。

## 副作用与数据

- 用户的表情包在 `user://stickers/<文件夹名>/`，由用户管理；应用只在启动时建这个目录，不写里面的文件。
- 消息与作品文件里只存写法的原文；表情包删了或改名，旧消息与文件里的写法按认不出显示原文。
- 白名单的用户改动存在用户层设置 `nbook.agent.profileSettings` 每项的 `stickers`，两个数组都空时不留这一项。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 表情包无效（输出 2） | 列为 `invalid`，诊断 `stickers.pack-invalid`；修好文件后重扫恢复 |
| 可选字段不合规（输出 3） | 忽略这个字段，诊断 `stickers.field-ignored` |
| 表情无效、超过 500 项（输出 4） | 不列，诊断 `stickers.sticker-invalid`（一个表情包一条，列出几项） |
| 插件目录不可用、同名（输出 6） | 诊断 `stickers.root-unavailable`、`stickers.pack-duplicate` |
| 浏览器目录或表情包概要超过上限（输出 18） | 诊断 `stickers.catalog-truncated` |
| 取图：表情包或表情不在目录里、表情无效、读取时文件已不是相符的图片或超过 2 MiB | 404 `not-found` |
| 取图：跨站请求 | 403 `cross-site`，规则同按地址读取字节（[workspace.files](../workspace/files.md)） |
| 白名单里的 id 不在目录里 | 不报错；槽不列它，Profile 设置里列在“已删除或不可用” |

## 边界与兼容

- 公开接口：清单的形状、贡献点 `stickers.packs`、表情写法、`stickers://` 的布局、Profile 声明的 `stickers` 字段。
- 取图路由 `GET /api/nbook.stickers/image/<表情包 id>/<文件名>?v=<版本>`：版本由文件的修改时间、大小与文件身份算出（换成另一个文件时即使大小与修改时间相同也会变），随浏览器目录交出。路由经文件服务读 `stickers://<表情包 id>/<文件名>`，只给目录里有效的表情；读取时再按字节判定类型与大小，`Content-Type` 取判定的类型；加 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox`、`ETag`；带了版本且与当前一致时 `Cache-Control: private, max-age=31536000, immutable`，否则 `no-cache`。
- 表情写法是 nb-markdown 的内置方言，没有标签名，声明投到 `markdown.dialects`（[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md)）。查表情经 nb-markdown 的宿主端口，没有提供端口时（Lab、组件测试、别的宿主）写法照样读成节点、显示原文。

## 验收与 Smoke

1. Given `user://stickers/lyra/` 里有三个表情（两个常用）和一个文件不在的表情，Profile 设置里给 Profile `user.lyra` 加上表情包 `user.lyra`，When 开一个 `user.lyra` 的会话发一句话，Then 请求里槽 `stickers` 列出 `:lyra/…:` 两行与表情包地址，诊断有一条 `stickers.sticker-invalid`；再重扫一次不加诊断。
2. Given 模型回复 `今天写完啦:lyra/开心:明天见` 和单独一行 `:lyra/害羞:`，When 对话显示这条回复，Then 前者是行内小图，后者是大图；`10:30:00` 与 `:lyra/没有这个:` 显示原文。
3. Given 另一个用户表情包（不在白名单里）里也有 `开心`，When 重算槽、重开对话，Then 槽的文字不变，`:lyra/开心:` 仍显示成图，不带包的 `:开心:` 显示原文。
4. Given 作品文件里有 `好:lyra/开心:` 和 `_斜体_`，When 在 Markdown 编辑器里打开、在同一段别处打字、保存，Then 表情显示成图，文件里只有打字处变了；在新的一行打出 `:lyra/害羞:` 变成表情节点、保存后是 `:lyra/害羞:`；再打出 `:abc:` 后按退格，保存后是 `\:abc:`，`_斜体_` 不变。
5. Given 窗口启动时恢复了一个含表情的对话和一个含表情的编辑器标签，When 浏览器目录晚于它们取到，Then 两处都先显示占位、取到后显示成图。
6. Given 一个测试插件经 `stickers.packs` 带一个表情包，When 插件启用、停用，Then `stickers://` 的根与浏览器目录随之出现、消失这个表情包。
7. Given 显示过 `:lyra/开心:` 的对话，When 删掉 `user://stickers/lyra/` 再放进同名的新文件夹，Then 之后新显示的块与 `stickers://user.lyra/` 都是新文件夹的内容。

Smoke：真实浏览器里打开 Lab 的表情场景（展示器与编辑器各一个），与 e2e 里一个会话的回复显示。

## 实现合同

- **公开入口**：nb-markdown 包入口的写法函数（`stickerAt`、`parseSticker`、`stickerEndingAt`、`isStickerName`、`isStickerPack`）与类型 `StickerResolver`、`ResolvedSticker`；宿主端口 `MarkdownHost.stickers`（展示器）、`MarkdownViewHost.stickers` 与 `report`（编辑器）；内置方言 `nbook.markdown.sticker`；贡献点 `stickers.packs`；地址 `stickers://`；取图路由 `GET /api/nbook.stickers/image/<id>/<file>`；`nbook.stickers` 的远程合同（`catalog`、`packs`、事件 `changed`）与服务 `stickersServiceKey`、浏览器服务 `stickerResolverKey`；Profile 声明的 `stickers` 与 `profileSettings[key].stickers`；扩展 `nbook.agent.stickers` 交槽 `stickers`。
- **owner 与依赖方向**：`nbook.stickers` 持有表情目录、`stickers://`（`nbook.files` 的挂载方案）、取图路由与浏览器目录，插件包目录经平台服务 `plugin-platform/packages` 取（可选依赖）；`nbook.agent` 可选依赖 `stickersServiceKey`，持有白名单与槽，白名单的合成与 Skill 共用 `shared/profile-allowlist.ts`；`nbook.markdown` 可选依赖 `stickerResolverKey`，经 `withHost` 交给 nb-markdown 的展示器与编辑器。nb-markdown 不依赖应用，只认端口。
- **关键不变量**：
  - 读写法、打字时的输入规则与写回时的转义共用一个判断（`stickers.ts` 的 `stickerAt`）；文字后面紧跟别的行内节点时，转义参考那个节点写出的第一个字（`codec.test.ts`“同一块里加了留作文字的写法，别处的写法不变”）。
  - 节点的原文一定是一个写法：读、输入规则与粘贴（`parseHTML` 校验）都只造合法的原文，写回原样（`sticker.dom.test.ts`“从展示器复制来的 HTML 粘贴回来”）。
  - 大图与间隙的类名由展示器的块后处理与编辑器的装饰给，判断是同一组函数；编辑器只重算改到的顶层块，相邻块的装饰不动（`sticker.dom.test.ts`“别的块里打字、删掉整块”）。
  - 交给浏览器的目录与概要按序列化字节装入，不超过远程单条消息上限（`stickers.test.ts`“目录与设置页的概要序列化后不超过远程消息的预算”）。
  - 稳定槽的文字只随白名单里的表情包变（`stickers-slot.test.ts`“输出 14、17”）。

## 证据

- 批准依据：开发者在 2026-11-17 的对话里确认：表情写法、两种大小、在 Agent 回复里显示、按 Skill 的方式选包、第一版不做用户发表情、先用占位图（“其他的都同意”）；表情写法做成方言、编辑器也能用（“可以，都同意”）；设计审查后改为 nb-markdown 的内置方言加宿主端口、槽里一律教带包的写法、在 Files 修挂载点被换掉后的重开（“没问题”）。Task：[`w00050 t02`](../../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t02-sticker-system/README.md)。
- 实现入口：[`plugins/stickers/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/stickers/backend/plugin.ts)、[`plugins/stickers/web/plugin.ts`](../../../packages/neuro-book/src/plugins/stickers/web/plugin.ts)、[`agent/backend/stickers/extension.ts`](../../../packages/neuro-book/src/plugins/agent/backend/stickers/extension.ts)、[`nb-markdown/src/stickers.ts`](../../../packages/nb-markdown/src/stickers.ts)、[`nb-markdown/src/language/syntax/sticker/index.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/index.ts)
- 合同测试：[`stickers.test.ts`](../../../packages/neuro-book/src/plugins/stickers/stickers.test.ts)、[`web/resolver.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/resolver.test.ts)、[`web/markdown-wiring.dom.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/markdown-wiring.dom.test.ts)、[`stickers-slot.test.ts`](../../../packages/neuro-book/src/plugins/agent/stickers-slot.test.ts)、[`profile-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.dom.test.ts)、[`nb-markdown stickers.test.ts`](../../../packages/nb-markdown/src/stickers.test.ts)、[`sticker/codec.test.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/codec.test.ts)、[`sticker/sticker.dom.test.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/sticker.dom.test.ts)
- Smoke：[`e2e/stickers.e2e.ts`](../../../packages/neuro-book/e2e/stickers.e2e.ts)
