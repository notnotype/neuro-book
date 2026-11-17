---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.stickers
owners:
  - nbook.stickers
  - nbook.agent
---

# 表情包

## 目标与非目标

让 Agent 在回复里发表情：用户把表情包（一个带清单的图片文件夹）放进 `user://stickers/`，或由插件带来；每个 Profile 有自己能用的表情包，常用的表情连同“什么时候用”放进提示词，完整目录在 `stickers://` 里由模型按需翻；模型在回复里写 `:名字:`，对话里显示成图。表情写法是一种 Markdown 方言，所以 Markdown 编辑器与字数用的是同一份规则。

不承诺：

- 用户在输入框里发表情（表情选择器）；用户消息照现有的提示词文字视图显示，不认表情写法。
- 编辑器里插入表情的菜单或补全；编辑器只显示、只在打完整个写法时变成表情（输出 18）。
- 模型看图：模型只看到名字与清单里的说明，不看到图片本身。
- 从展示器里复制表情得到 `:名字:` 原文。
- 表情不计字数的规则：表情写法按普通文字计入字数（方言的字数规则只管标签写法，[workspace.markdown-syntaxes](../workspace/markdown-syntaxes.md) 的不承诺）。
- 表情包目录变了，已经显示出来的块与已经打开的编辑器不重画；之后显示的块用新的目录（已知限制）。
- 按 Profile 限制显示：模型写了白名单以外的表情包里的表情，照样显示成图；白名单只决定提示词里列出哪些。

## 术语与参与者

- **表情包**：一个文件夹，里面有清单 `stickers.json` 和图片。**文件夹名**是表情包的名字。
- **表情**：清单里的一项：名字、图片文件、什么时候用、是否常用。
- **来源**：`plugin`（插件经贡献点 `stickers.packs` 带来，内置插件也走这里）、`user`（`user://stickers/` 下的）。**表情包 id**：用户的是 `user.<文件夹名>`，插件的是 `<插件 id>.<文件夹名>`；来源以条目的 `source` 为准，不从 id 前缀推断。
- **表情目录**：应用当前认得的全部表情包。
- **白名单**：一个 Profile 能用的表情包 id 的集合，合成规则同 Skill（[`skills.md`](skills.md) 的“白名单”）。
- `nbook.stickers`：内置插件，持有表情目录、`stickers://`、取图路由、表情写法的方言与浏览器一侧的目录。`nbook.agent` 持有白名单与提示词里的槽。

## 输入与前置条件

**清单** `stickers.json`：

```ts
interface StickerPackManifest {
    title?: string;           // 显示名，缺省用文件夹名
    description?: string;     // 一句话说这个表情包是谁的、什么风格
    stickers: Array<{
        name: string;         // 表情名
        file: string;         // 图片文件名
        when?: string;        // 什么时候用，给模型看
        common?: boolean;     // 常用的进提示词（输出 12）
    }>;
}
```

| 项 | 规则 |
|---|---|
| 文件夹名 | 1–64 个小写字母、数字与连字符，不以连字符开头或结尾，没有连续的连字符 |
| 表情名 | 1–32 个字符，只含 Unicode 字母、数字、`_`、`-`，第一个字符是字母或 `_`；同一个表情包里不重名 |
| `file` | 表情包文件夹里的单段文件名，不是链接；扩展名 `.png`、`.gif`、`.webp`、`.jpg`、`.jpeg`（不分大小写）；至多 2 MiB |
| `title`、`when`、`description` | 至多 200 个字符 |
| `stickers` | 至多 500 项 |

**插件来源**：插件用顶层贡献 `stickers.packs` 声明插件包里的一个目录，声明 `{directory}`，路径规则同 `agent.skills`（[`skills.md`](skills.md) 输出 30）；目录里每个子文件夹是一个表情包。贡献 id 以插件 id 加 `.` 开头。

**表情写法**（行内）：

```text
:名字:            按名字找
:包/名字:         包是文件夹名或表情包 id
```

- 开头的 `:` 前面不是 Unicode 字母或数字，结尾的 `:` 后面不是 Unicode 字母或数字；名字按上表的规则。所以 `10:30:00`、`a:b:c` 不是表情写法。
- 行内代码与代码块里不认。

**白名单**：`agent.profiles` 的声明加 `stickers?: {allowed: string[] | "all"}`，值是表情包 id；用户在 Profile 设置里按 Profile 增删，存在 `profileSettings[key].stickers: {added: string[], removed: string[]}`。合成：声明的（`"all"` 时取当前目录的全部 id），加 `added`，减 `removed`。没有声明、用户也没加的 Profile 没有能用的表情包。

**槽**：`nbook.agent` 的扩展 `nbook.agent.stickers` 交槽 `stickers`（稳定的）。Profile 模板用 `<Slot name="stickers" />` 摆放（[`harness/profile.md`](../harness/profile.md) 输出 15、16）。

## 输出与可观察行为

### 目录

1. 表情目录在 `nbook.stickers` 启动时扫一遍，之后按 `user://stickers/` 的文件变化重扫变了的表情包；插件来源随 `stickers.packs` 的发布与撤回出现、消失，插件的目录不监视。
2. 无效的表情包只隔离它一个：照样列出，状态 `invalid`，`problem` 写原因，写一条诊断。算无效的：没有 `stickers.json`、读不懂或不合清单的形状、文件夹名不合规则、文件夹是链接。
3. 无效的表情只隔离它一项：名字不合规则、同包重名（后出现的）、文件不在、不是允许的扩展名、超过 2 MiB、是链接。这一项不列，别的照常，写一条诊断（每个表情包每次重扫至多一条，列出几项）。
4. 同一个插件的两个 `stickers.packs` 贡献里有同名文件夹时，按贡献 id 的码元顺序先到的生效，后到的不列，写诊断 `stickers.pack-duplicate`。声明的目录不在插件包里、不是目录或经过链接时，这个贡献不出表情包，写诊断 `stickers.root-unavailable`。

### 找表情

5. 一个写法找表情：带包时，包先按表情包 id 认，认不出按文件夹名认；按文件夹名认到不止一个是认不出。不带包时，在全部有效的表情包里按名字找，恰好一个是它，不止一个或没有是认不出。
6. 认不出的写法显示成原文。

### 显示

7. 对话里 Agent 的回复、过程中的说明文字与思考全文（经 [ui.markdown-display](../ui/markdown-display.md) 的展示器显示的地方）里，认得出的写法显示成图，悬停提示 `:名字:`；图片读取失败时显示原文。
8. 夹在文字里的表情高约两倍字高；一个段落里只有表情与空白时，每个表情显示成大图（高约 120 像素），宽按图片比例。
9. 作品文件在 Markdown 编辑器里同样显示成图（输出 18），规则同输出 6–8。

### 资源地址

10. `stickers://` 的根列出目录里的全部表情包，每项写 id、显示名、说明、来源、表情数与状态（无效的写原因）。
11. `stickers://<表情包 id>/` 是这个表情包的文件夹：能读、能列、能取真实路径；Agent 写入得 `permission-denied`。用户的表情包同时在 `user://stickers/<文件夹名>/`，用户经那里改。

### 提示词里的槽

12. 槽 `stickers` 的内容：一句写法说明（`:名字:`，完整目录在 `stickers://`），白名单里每个有效的表情包一段：显示名与说明，常用的表情每个一行 `写法 — 什么时候用`。写法取在全部有效表情包里认得出的最短形式：名字只在一个表情包里出现时写 `:名字:`，否则写 `:文件夹名/名字:`，文件夹名也重名时写 `:表情包 id/名字:`。
13. 一个会话的槽至多列 60 个常用表情，按白名单里表情包 id 的码元顺序、包内按清单顺序取，多出的不列，末尾写一句“还有更多，见 stickers://”。
14. 白名单为空、或白名单里没有有效的表情包时，槽没有内容（模板摆了也不渲染）。
15. 槽的内容在表情目录与白名单不变时逐字相同：目录或白名单变了，从下一次请求起用新的内容。

### 界面

16. Profile 设置的“表情包”一节，放在“Skill”一节下面，样子与规则同 Skill 一节（[`profile-settings.md`](profile-settings.md) 输出 26）：按来源分组（我的在前、各插件一组），一行一个表情包（显示名、说明、表情数），写入 `profileSettings[key].stickers`。
17. 设置里没有单独的表情包页：表情包的增删经 `user://stickers/` 的文件。

### 编辑器

18. Markdown 编辑器里，表情写法读成一个整体的行内节点：光标一步跨过、删除一次删掉整个；不编辑时写回字节不变，编辑别处后写回仍是原文。打字打出一个完整的写法（输入结尾的 `:` 时）就变成表情节点，不论认不认得出。

## 状态与转换

表情包：`ok`、`invalid`。重扫时改变；撤回的插件来源从目录里消失。

时序与寿命：

- 浏览器一侧的目录在窗口启动时取一次，之后随目录变化的通知更新；取到之前显示的写法按认不出显示原文，之后不重画（不承诺里的已知限制）。
- 槽在每次请求前现算（同输出 15 的稳定条件）。

## 副作用与数据

- 用户的表情包在 `user://stickers/<文件夹名>/`，由用户管理，应用不写。
- 消息与作品文件里只存写法的原文；表情包删了或改名，旧消息与文件里的写法按认不出显示原文。
- 白名单的用户改动存在用户层设置 `nbook.agent.profileSettings` 的每项的 `stickers`，两个数组都空时不留这一项。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 表情包无效（输出 2） | 列为 `invalid`，诊断 `stickers.pack-invalid`；修好文件后重扫恢复 |
| 表情无效（输出 3） | 不列，诊断 `stickers.sticker-invalid` |
| 插件目录不可用、同名（输出 4） | 诊断 `stickers.root-unavailable`、`stickers.pack-duplicate` |
| 取图：表情包或文件不在目录里、表情无效 | 404 `not-found` |
| 取图：跨站请求 | 403 `cross-site`，规则同按地址读取字节（[workspace.files](../workspace/files.md)） |
| 白名单里的 id 不在目录里 | 不报错；槽不列它，Profile 设置里列在“已删除或不可用” |

## 边界与兼容

- 公开接口：清单的形状、贡献点 `stickers.packs`、表情写法、`stickers://` 的布局、Profile 声明的 `stickers` 字段。
- 取图路由 `GET /api/nbook.stickers/image/<表情包 id>/<文件名>` 只给清单里列出的、有效的表情的图；`Content-Type` 按文件开头的字节判定（只认 PNG、GIF、WebP、JPEG），加 `X-Content-Type-Options: nosniff`、`Content-Security-Policy: sandbox`、`ETag`。
- 表情写法作为方言经 `markdown.dialects` 与 `markdown.syntaxes` 交出，没有标签名；不生效时按 [workspace.markdown-dialect](../workspace/markdown-dialect.md) 输出 9 原样保留。

## 验收与 Smoke

1. Given `user://stickers/lyra/` 里有三个表情（两个常用）和一个文件不在的表情，Profile 设置里给 Profile `user.lyra` 加上表情包 `user.lyra`，When 开一个 `user.lyra` 的会话发一句话，Then 请求里槽 `stickers` 列出两个常用表情的写法与说明，诊断有一条 `stickers.sticker-invalid`。
2. Given 模型回复 `今天写完啦 :开心: 明天见` 和单独一行 `:害羞:`，When 对话显示这条回复，Then 前者是行内小图，后者是大图；`10:30:00` 与 `:没有这个:` 显示原文。
3. Given 另一个用户表情包里也有 `开心`，When 重算槽，Then 写法变成 `:lyra/开心:`，对话里 `:开心:` 显示原文、`:lyra/开心:` 显示成图。
4. Given 作品文件里有 `:开心:`，When 在 Markdown 编辑器里打开、编辑别处、保存，Then 显示成图，文件里这处字节不变；在新的一行打出 `:害羞:`，变成表情节点，保存后文件里是 `:害羞:`。
5. Given 一个测试插件经 `stickers.packs` 带一个表情包，When 插件启用、停用，Then `stickers://` 的根随之出现、消失这个表情包。

Smoke：真实浏览器里打开 Lab 的表情场景（展示器与编辑器各一个），与 e2e 里一个 `user.lyra` 式会话的回复显示。

## 证据

- 批准依据：开发者在 2026-11-17 的对话里确认：表情写法、两种大小、在 Agent 回复里显示、按 Skill 的方式选包、第一版不做用户发表情、先用占位图（“其他的都同意”）；表情写法做成方言、编辑器也能用（“可以，都同意”）。Task：[`w00050 t02`](../../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t02-sticker-system/README.md)。
