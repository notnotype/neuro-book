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

让 Agent 在回复里发表情：用户把表情包（一个图片文件夹，可以带清单）放进 `user://stickers/`，或由插件带来；每个 Profile 有自己能用的表情包，常用的表情连同说明放进提示词，完整目录在 `stickers://` 里由模型按需翻；模型在回复里写 `:包/名字:`，对话里显示成图。表情写法是 nb-markdown 的一种内置方言，Markdown 编辑器、展示器与字数用的是同一份规则。

不承诺：

- 内置表情包：第一版只有插件与用户两种来源；内置插件取不到自己的插件包目录（[runtime.plugin-code-loading](../runtime/plugin-code-loading.md) 输出 11），以后要随应用分发表情包时另加 `builtin` 来源。
- 选择器里的收藏、自定排序、按 Profile 只列白名单里的包；全角冒号触发补全（中文输入法下打半角冒号，或用按钮）。
- 拖动表情插入编辑器或输入框。
- 模型看图：模型只看到名字与清单里的说明，不看到图片本身。
- 表情不计字数：表情写法按普通文字计入字数。
- 已经显示出来的表情不随目录变化重画：换了图、删了表情包，之后新显示的块用新的目录（已知限制）。
- 动图在“减少动态效果”的系统设置下照常播放。
- 按 Profile 限制显示：模型写了白名单以外的表情包里的表情，照样显示成图；白名单只决定提示词里列出哪些。
- 表情包页（输出 25 起）不做：拖动排序、多选批量、裁剪或编辑图片、撤销；改包名不迁移 Profile 的白名单（输出 33）；表情包市场。

## 术语与参与者

- **表情包**：一个文件夹，里面是图片，可以有清单 `stickers.json`。**文件夹名**是表情包的名字。
- **表情**：表情包里的一张图片：名字、图片文件、说明（可选）、是否常用。
- **来源**：`plugin`（第三方插件经贡献点 `stickers.packs` 带来）、`user`（`user://stickers/` 下的）。**表情包 id**：用户的是 `user.<文件夹名>`，插件的是 `<插件 id>.<文件夹名>`；来源以条目的 `source` 为准，不从 id 前缀推断。
- **表情目录**：应用当前认得的全部表情包。
- **白名单**：一个 Profile 能用的表情包 id 的有序列表，合成规则同 Skill（[`skills.md`](skills.md) 的“白名单”）：声明的在前，用户加的在后。
- `nbook.stickers`：内置插件，持有表情目录、`stickers://`、取图路由与浏览器一侧的目录。`nbook.markdown` 把浏览器一侧的目录经宿主端口交给 nb-markdown（输出 18）。`nbook.agent` 持有白名单与提示词里的槽。

## 输入与前置条件

**清单** `stickers.json`，可选，至多 256 KiB：

```ts
interface StickerPackManifest {
    title?: string;           // 显示名，缺省用文件夹名
    description?: string;     // 一句话说这个表情包是谁的、什么风格
    stickers?: Array<{        // 省略时按文件夹里的图片（见下文“没有表情列表”）
        file: string;         // 图片文件名
        name?: string;        // 表情名，缺省取 file 去掉扩展名的部分
        description?: string; // 说明，给模型看：表情是什么、怎么用，简单的表情不用写
        common?: boolean;     // 常用的进提示词（输出 14），缺省否
    }>;
}
```

| 项 | 规则 |
|---|---|
| 文件夹名 | 1–64 个小写字母、数字与连字符，不以连字符开头或结尾，没有连续的连字符 |
| 表情名 | 规范化到 NFC 后 1–32 个码点，只含 Unicode 字母、数字、`_`、`-`，第一个是字母或 `_`；区分大小写；同一个表情包里不重名。取自文件名时同样按这条规则 |
| `file` | 表情包文件夹里的单段文件名，不是链接；扩展名 `.png`、`.gif`、`.webp`、`.jpg`、`.jpeg`（不分大小写）；按文件开头的字节判定是这四种图片之一且与扩展名相符；至多 2 MiB；宽、高都不超过 1024 像素 |
| `title`、`description`（表情包与表情的） | 至多 200 个字符 |
| `stickers` | 至多 500 项 |

**没有表情列表**（没有清单，或清单里没写 `stickers`）：表情包文件夹里扩展名是上表几种的每个文件是一个表情，按文件名的码元顺序；名字取文件名去掉扩展名的部分，全部算常用，没有说明。别的文件（以点开头的、扩展名不是图片的、子文件夹）不算表情。清单写了 `stickers` 时只认列出的项，文件夹里没列的图片不算表情。

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
2. 无效的表情包只隔离它一个：照样列出，状态 `invalid`，`problem` 写原因。算无效的：`stickers.json` 超过 256 KiB、读不懂或不是对象、`stickers` 写了但不是数组、文件夹名不合规则、文件夹是链接、文件夹读不了（查不了有没有清单，或没有表情列表时列不出文件）。没有 `stickers.json` 不算无效。
3. 表情包的可选字段（`title`、`description`）不合规则时只忽略那个字段，表情包照常可用。
4. 无效的表情只隔离它一项，这一项不列，别的照常。算无效的：名字（写的或取自文件名的）不合规则、同包重名（后出现的）、`description` 超长、文件不在、是链接、扩展名不对、字节不是相符的图片、超过 2 MiB 或 1024 像素。`stickers` 超过 500 项时只认前 500 项。
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

14. 槽 `stickers` 的内容：开头一句写法说明（`:包/名字:`，完整目录在 `stickers://`）；之后白名单里每个有效的表情包一段，按白名单的顺序：显示名、说明、这个表情包的地址 `stickers://<表情包 id>/`，常用的表情每个一行，有说明的写 `写法 — 说明`，没有的只写写法。写法一律带包：包写文件夹名；全部有效的表情包里有同名文件夹时写表情包 id。
15. 上限：至多 8 个表情包、合计 60 个常用表情，按白名单的顺序、包内按清单顺序取；多出的不列，末尾写一句“还有更多，见 stickers://”。整个槽至多 6000 个字符。
16. 白名单为空、或白名单里没有有效的表情包时，槽没有内容（模板摆了也不渲染）。
17. 槽的内容只随白名单里的表情包变：表情目录与白名单不变时逐字相同；白名单以外的表情包增删不改槽（同名文件夹的情形除外，见输出 14）。变了的从下一次请求起用新的内容。

### 浏览器一侧的目录

18. 浏览器一侧的目录只带显示要用的：每个有效的表情包的 id、文件夹名、显示名、来源（插件的另带插件 id 与显示名）与写法的包段（按输出 14 的规则在完整目录上算好；这几项 planned，选择器用），每个有效表情的名字、宽、高与取图地址；不带表情包与表情的说明。合计至多 5000 个表情、序列化后至多 768 KiB（远程调用单条消息的上限以内），放不下的表情包整包不进浏览器目录（按 id 的码元顺序取），写诊断 `stickers.catalog-truncated`；Profile 设置用的表情包概要按同样的字节上限取。`stickers://` 与槽不受这条影响。目录变了经通知更新。

### 界面

19. Profile 设置的“表情包”一节，放在“Skill”一节下面，行、分组、添加与恢复默认同 Skill 一节（[`profile-settings.md`](profile-settings.md) 输出 26）：按来源分组（我的在前、各插件一组），一行一个表情包（第一个常用表情的缩略图、显示名、说明、表情数），写入 `profileSettings[key].stickers`。
20. 表情包的增删改除了直接改 `user://stickers/` 的文件，还可以在设置里的表情包页做（输出 25 起）。

### 编辑器

21. Markdown 编辑器里，表情写法读成一个整体的行内节点（不论认不认得出）：光标一步跨过、删除一次删掉整个；写回原文。不编辑时字节不变，编辑同一块的别处后这处写回仍是原文。
22. 打字打出一个完整的写法（输入结尾的半角 `:` 时）变成表情节点；紧接着按一次退格还原成打出的文字。输入法组字期间不变。
23. 留作文字的写法（退格还原的、纯文字粘贴的）写回时开头的冒号写成 `\:`，同一块里别的字节不变。
24. 复制含表情的选区：纯文字里是写法的原文；带格式的内容粘贴回编辑器仍是表情节点，不变成图片。

### 表情包页

25. 设置窗口的 page 分区（[`settings/settings-window.md`](../settings/settings-window.md)），分类 `ai`，排在 Skill 页之后，只有用户层。左边是表情包列表，右边是选中的那个，同 Profile 设置页（[`profile-settings.md`](profile-settings.md) 输出 1）：左栏按来源分组（我的在前，各插件一组，组头写插件名），一行是第一个有效表情的缩略图（没有时是图标）、显示名与表情数（不含认不出与没加进来的），有认不出的图时行尾出提示图标；无效的表情包照样列出，行尾是错误图标；“我的”组头有“新建”，左栏底部有“导入 zip”。页面窄于 600px 时左栏收成顶上的下拉加“新建”“导入”。页面有读取中与读失败（带重试）两种状态，同 Profile 页。第一次打开选中“我的”里的第一项（没有就是第一组的第一项）；页面自己新建、改包名、复制、导入之后选中结果那个包；只有选中的包被别处删掉时回到第一项。
26. 右边：头部是显示名与说明，右侧“导出”与“更多”菜单（在文件夹中显示、改包名、删除表情包）；插件的包另有“复制到我的”，菜单里只有“在文件夹中显示”。下面是表情网格，按组排：认不出（名字当不了表情名的图，要处理的在最前）、常用、其他、文件夹里还没加进来的（有表情列表时，文件夹里清单没列的图片）；组头写组名与个数，没有的组不画。每个表情占一个固定大小的格子，图在格子里按比例缩小、居中，不论图的大小与宽高比；格子下写名字，认不出与没加进来的写文件名；悬停加深格子底色，选中是格子的强调色描边。我的包在“其他”组末尾（没有组时单独一行）有“添加”格，点开选文件；也能把图片拖进网格，拖到网格外不打开图片；还没有表情的包整个网格是落点。上传中的图在网格末尾显示占位格。网格里方向键移动即选中（左右按顺序、上下按列，跨组接续），Delete 删除选中的（先确认），Esc 回到表情包。无效的表情包右边写原因与该怎么办（清单读不了、清单不合规则、文件夹名不合规、是链接、读不了各一句），只能在文件夹中显示、删除，文件夹名不合规的右边另有“改包名”。网格里按 Esc 取消选中时不让设置窗口跟着关（没有选中时 Esc 照常关窗口）。
27. 网格旁的属性栏，顶上有“返回表情包”：选中表情时是大图（固定高度的格子）、名字、说明、写法（`:包名/名字:`，能复制）、常用开关、文件名与宽高大小、“删除表情”；认不出的写原因与名字的规则，改好名字之前说明与常用不能改；没加进来的只有“加进来”与“删除文件”。名字与显示名回车或离开输入框时保存，Esc 还原；说明离开时保存；保存失败回到原来的值并通知（通知也覆盖字段所在的组件已被换掉的情形，例如保存时已点了别的格子）；输入法组字中的回车与 Esc 不算提交与还原；成功后输入框对齐目录里的值。改名后选中的格子、属性栏与输入框焦点保持。底部一行写校验与保存的原因。没选表情时是表情包的显示名、说明、包名（旁边“改…”）与写法、个数。插件的包只显示文字，不能改。窄时属性栏排到网格下面。
28. 改表情包或表情（显示名、说明、表情的名字、说明、常用）写进清单：没有清单或清单没写表情列表的，先写一份列出文件夹里全部图片的清单（每张一项，名字省略、都算常用，与改之前认的表情相同），再改清单；只改清单里那一处，别的字段（包括不认识的字段）保留，写回时重新排版、数字按 JavaScript 能表示的精度写；文件不改名；只改表情包的显示名与说明时，没有表情列表的包不补列表。名字清空表示用文件名。页面按清单里写的名字原样定位清单项（没写名字的是“没写”），同一个文件在清单里写了两项时各改各的。名字不合规则、与别的表情重名、改完超过 500 项或 256 KiB 时不写，在属性栏的状态行写原因。
29. 添加图片：一次可以选或拖进多张。每张按“输入与前置条件”的 `file` 规则核对；宽乘高超过 5000 万像素的不加；宽或高超过 1024 像素或超过 2 MiB 的静态 PNG、JPEG、WebP 按比例缩到 1024 以内，缩完仍超过 2 MiB 的改存 WebP（扩展名跟着改）；GIF 与动态 WebP 超限不缩，这张不加并写原因。文件名沿用原来的，文件夹里已有同名文件时加 `-2`、`-3`。有表情列表的包里同时在清单末尾加一项（名字省略、不常用），这一步失败就删掉刚写的图、这张算没加（只删内容仍是刚写的那一份，确认不了时不删，通知写明部分完成）；没有表情列表的只写文件。几张里有不加的（包括拖进来的文件夹，按拖放事件里的目录分类判断），加完后用一条通知列出文件名与原因。同时至多 3 张在传；设置窗口关掉时没开始的丢掉，已经开始的传完；客户端断开的请求不再继续写。
30. 删除表情：确认后删清单里那一项，那个文件不再被别的项用到时删文件（没有表情列表的包直接删文件）；“删除文件”（没加进来的图）只删文件。只删包文件夹里的图片文件：清单、别的文件、子文件夹不删（得“表情已不在”）。“加进来”与组头的“全部加进来”在清单末尾加项（名字省略、不常用）。
31. 新建表情包：对话框填显示名与包名（文件夹名规则），包名已被用或不合规则时在对话框的状态行写原因；建好的文件夹里只有一份写了 `title` 的清单，建好后选中它。
32. 复制到我的：把插件的包里的清单与文件夹顶层的图片（合计至多 64 MiB）复制成用户的包，包名沿用，已被用时加 `-2`、`-3`；中途失败或复制途中插件换了版本，不留半个包、通知原因；复制完选中新包。
33. 改包名：对话框填新包名，写清代价：用旧包名写下的表情（对话、文件里的 `:旧包名/…:`）之后认不出来、显示原文，改回旧包名就又认得；明确选了它的 Profile（声明的白名单写了它，或用户在 Profile 设置里加了它）列出名字，改名后要在 Profile 页重新勾选（它们列在“已删除或不可用”）；声明“全部”的不列，改名后自动包含；查不到时写通用的提醒。改名就是给文件夹改名，id 随之变；白名单不迁移。打开对话框之后文件夹被别处换掉的，不改，通知原因。
34. 删除表情包：确认框写出包名与表情数，确认后删除整个文件夹；打开确认框之后文件夹被别处换掉的不删，通知原因。
35. 导出：下载一个 zip，文件名 `<包名>.zip`，里面是一个以包名命名的文件夹，含清单（有的话）与文件夹顶层文件名合格的全部图片，只存不压；zip 超过 64 MiB 或超过 600 项、或一张图片也没有、单个文件超过 32 MiB、两个文件名只差大小写（导入时当作同一个文件）时不导出、通知原因（导出的一定能导回）；插件的包也能导出，无效的表情包不能导出。
36. 导入 zip：zip 里是一个文件夹（包名取文件夹名）或图片直接放在根上（包名取 zip 文件名去掉扩展名）；只取清单与扩展名是图片的文件，子文件夹与别的文件忽略；路径里有 `..`、绝对路径、反斜杠、盘符、以点开头的段，或同一个文件名出现两次（不分大小写），整个 zip 不导入（macOS 压缩工具带进来的 `__MACOSX` 与 `.DS_Store` 忽略，不算）；清单读不懂或一张图片也没有的不导入。包名不合规则时转成合规的（小写、非法字符换成连字符、合并连字符、去首尾、至多 60 个字符），转不出（例如全是中文）就报错，提示改一下文件夹或 zip 的名字。zip 至多 64 MiB，按实际解出的字节算至多 256 MiB、单个文件至多 32 MiB、至多 600 项。与已有的包同名时问：替换已有的（删掉旧的，用导入的），或另存为新包（包名加 `-2`、`-3`，对话框写出用哪个名字）；对话框左右对照两边的前几个表情、显示名与表情数（要导入那一侧在浏览器里读 zip）；问过之后已有的包被别处换掉的，不替换，再问一次。替换中途断掉不丢旧包：挪开的旧包留在 `user://stickers/` 里一个以点开头的文件夹，写诊断给出位置，由用户处理。导入的图片不缩小，按目录的规则核对（输出 4）。导入完选中它。
37. 在文件夹中显示：用系统的文件管理器打开这个表情包的文件夹（插件的包打开插件里的那个文件夹），不新建文件夹；没有桌面、打开不成时发一条通知写出路径，同 Skill 页（[`skills.md`](skills.md) 输出 25）。
38. 页面跟着目录变：别处改了文件（文件管理器、Agent 之外的程序、另一个窗口）时页面随目录的通知更新；选中的表情没了时属性栏回到表情包。页面的写入都经文件服务写 `user://stickers/`，写完的结果以重扫后的目录为准。

### 选择器与补全（planned）

39. **选择器**：入口是 Markdown 编辑器工具栏图片按钮后面的“表情”、斜杠菜单“块”组“图片”后面的“表情”、Agent 输入框工具栏 `+` 后面的表情按钮（单行版式在前置按钮里）；没有 `nbook.stickers` 时这几个入口都不出现。点开在按钮旁弹出一个面板（编辑器里按钮收进“⋯”或从斜杠菜单打开时锚在光标），放不下时翻到另一侧：编辑器里打开时原来的选区仍画成选中的样子、选区菜单不显示，与注音、链接、插图卡片互斥；顶上是搜索框（打开时焦点在这里），下面一排表情包标签（第一个是“最近用过”，其余是各包的第一张图，当前的只用底色标出），再下面是网格，按“最近用过”、各表情包分组，组头写显示名（插件的包另写插件名），我的在前，各插件按插件显示名一组，组内按目录顺序；底部一行是指着的表情（图、名字与写法）。网格里不写字，图在固定大小的格子里按比例缩小、居中。滚动网格时标签跟着亮，点标签滚到那一组。方向键在格子间移动，回车插入；点一下插入并关上面板，按住 Shift 点或按 Shift+回车插入后不关。Esc 关上，焦点回到正文或输入框。目录里一个表情包也没有时，面板写一句没有表情包与“在设置里新建”（打开表情包页）。
40. **搜索**：选择器的搜索框与补全用同一个规则：查询是表情名的一段（不分拉丁字母大小写，按 NFC 比较），或表情名里每个汉字读音首字母连起来的开头（`kx` 找到“开心”）；写成 `包/查询` 时只在这个表情包里找（包段按文件夹名、id 或显示名的开头），`包/` 后面没有字时列这个表情包的全部。名字以查询开头的排在前面，其余按目录顺序。搜索时不分组、标签收起；没有结果写一句。
41. **插入的写法**：一律带包，包段同输出 14（写文件夹名；全部有效的表情包里有同名文件夹时写 id）。编辑器里插入的是表情节点（输出 21），输入框里插入的是写法文字；插在光标处，有选区时替换选区；编辑器里代码块、原样块中不能插入（按钮置灰）。
42. **补全**：编辑器与输入框里，打出半角 `:` 且它在开头、或前一个字不是 ASCII 字母与数字，接着打了至少 1 个字（不含空白与 `:`；只打了 1 个英文字母时不弹，免得 `:D`、`:P` 这类颜文字回车时插进表情）时弹出补全；没有匹配的表情时不弹，回车照常；查询是 `:` 后面到光标的文字，规则同输出 40。代码块、原样块、行内代码里不弹，输入法组字时不弹。至多 8 项，一行是小图、名字与表情包的显示名；方向键移动，回车、Tab 或点击确认，把 `:查询` 换成写法（输入框里不补空格）；Esc 收起，这一处查询不变时不再弹；输入空白、光标离开时收起。编辑器里在光标下方，输入框里与输入框同宽、在上方（同 `@` 菜单）。打出完整写法的收尾 `:` 时照输出 22 变成表情，补全随之收起。
43. **最近用过**：经选择器或补全插入的表情记进“最近用过”，新的在前、不重复、至多 16 个，存在本机（这个客户端的用户记录 `stickers.recent`），编辑器与输入框共用；目录里已经没有的不列，记录读不了时当作空的。
44. **输入框里**：认得出的表情写法（输入框的文字写法，[`ui/prompt-editor.md`](../ui/prompt-editor.md)）显示成行内小图，大小与对齐同输出 10、11 的行内小图（图的中心对着汉字字形的中心），光标一步跨过，退格删掉整个；认不出的写法就是普通文字（代码里的 `std::string::npos` 不受影响）；目录晚到时，到了之后已打开的正文重新识别一次。插入的写法若会和前面的文字连成另一个写法（前文有 `:词`），先补一个空格。发出去的文字是写法原文。就地编辑历史消息时同样显示，但没有补全与按钮。
45. **用户消息**：已发送的用户消息里的表情按输出 10、11 显示（一段里只有表情与空白、且不超过 3 个时是大图）。一条用户消息的文字块拼起来去掉空白后只有 1 到 3 个认得出的写法、没有附件、正文没有被省略时不画气泡，表情直接放在消息的位置（左边与有气泡的消息对齐）；就地编辑时照常换成编辑器。

## 状态与转换

表情包：`ok`、`invalid`。重扫时改变；撤回的插件来源从目录里消失。

时序与寿命：

- 浏览器一侧的目录在 `nbook.stickers` 的浏览器入口激活后取一次，之后随通知更新。nb-markdown 经端口查表情（输出 10）：目录还没取到时端口的结果等到取到为止，显示占位；取不到（服务不可用）时按认不出显示原文。
- 一个表情显示出来之后不因目录变化重画（不承诺里的已知限制）；块被替换或卸载时释放它的图片，同 [ui.markdown-display](../ui/markdown-display.md) 输出 8。
- 槽在每次请求前现算（输出 17 的稳定条件）。

## 副作用与数据

- 用户的表情包在 `user://stickers/<文件夹名>/`，由用户管理；应用启动时建这个目录，此外只有表情包页按用户的操作写里面的文件（输出 28 到 36）。
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
| 表情包页：包名已被用、不合规则；名字或显示名不合规则、重名、清单满了 | 不写，状态行写原因 |
| 表情包页：图片不合规、GIF 或动态 WebP 超限、读不了 | 这张不加，加完后一条通知列出原因 |
| 表情包页：导入的 zip 读不懂、超过上限、没有图片、本地 zip 读不到了 | 不导入，通知写原因 |
| 表情包页：写入时文件被别处改了或文件夹被换掉（`pack-changed`）、表情包已不在、写不了 | 不写，通知写原因；几步的操作中途失败、补救也失败时通知写明部分完成；页面按重扫后的目录显示 |
| 表情包页：同时上传或导入太多（`busy`）、请求体超限（`too-large`）、导出超过 64 MiB 或导出的包导不回来（`export-too-large`、`export-conflict`） | 不做，通知写原因 |
| 表情包页的上传、导入：请求被客户端取消（`request-aborted`） | 停止处理；写任何东西之前取消的不写，写暂存途中取消的丢弃暂存 |
| 表情包页的上传、导入：跨站请求 | 403 `cross-site`；宿主先拦下的不允许的来源是 403 `origin-not-allowed` |
| 启动时发现替换中途挪开的旧包 | 不动它，诊断 `stickers.replace-leftover` 写出位置 |

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
8. Given `user://stickers/cat/` 里只有 `开心.png`、`困.png`、`1.png` 与 `readme.txt`，没有清单，Profile 白名单里有 `user.cat`，When 开会话发一句话、模型回复 `:cat/开心:`，Then 槽里列出 `:cat/困:` 与 `:cat/开心:` 两行（没有说明），回复里显示成图；诊断有一条 `stickers.sticker-invalid` 写 `1.png` 当不了表情名，`readme.txt` 不报。

9. Given 设置里的表情包页，When 新建表情包 `cat`、拖进 `开心.png` 与一张 2000×1500 的 `大图.jpg`、把 `大图` 改名为 `哇` 并标常用、导出、删除 `cat`、再导入刚才的 zip，Then 导入后的 `user://stickers/cat/` 里有清单与两张图，`大图.jpg` 宽 1024，`:cat/哇:` 在对话里显示成图，Profile 里勾选了 `user.cat` 的会话请求里槽列出 `:cat/哇:`。
10. Given 已有表情包 `cat`，When 导入一个包名也是 `cat` 的 zip，Then 问替换还是另存；选另存后有 `cat-2`，原来的 `cat` 不变。

11. （planned）Given 表情包 `lyra` 里有“开心”，When 在 Markdown 编辑器的一段中文后面打 `:开` 回车、保存，Then 文件里是 `……:lyra/开心:`；When 点工具栏的“表情”选“困”、重开编辑器再点“表情”，Then “最近用过”的第一个是“困”、第二个是“开心”。
12. （planned）Given 一个会话，When 在输入框里打 `:kx` 选“开心”、再打几个字发送，Then 请求里的用户文字是写法原文，消息里显示成行内小图、与文字的竖直中心相差不超过 2 像素；When 用表情按钮只发一个“开心”，Then 这条消息没有气泡、是大图。

Smoke：真实浏览器里打开 Lab 的表情场景（展示器与编辑器各一个），与 e2e 里一个会话的回复显示。

## 实现合同

- **公开入口**：nb-markdown 包入口的写法函数（`stickerAt`、`parseSticker`、`stickerEndingAt`、`isStickerName`、`isStickerPack`）与类型 `StickerResolver`、`ResolvedSticker`；宿主端口 `MarkdownHost.stickers`（展示器）、`MarkdownViewHost.stickers` 与 `report`（编辑器）；内置方言 `nbook.markdown.sticker`；贡献点 `stickers.packs`；地址 `stickers://`；取图路由 `GET /api/nbook.stickers/image/<id>/<file>`；`nbook.stickers` 的远程合同（`catalog`、`packs`、事件 `changed`）与服务 `stickersServiceKey`、浏览器服务 `stickerResolverKey`；Profile 声明的 `stickers` 与 `profileSettings[key].stickers`；扩展 `nbook.agent.stickers` 交槽 `stickers`；表情包页：设置页分区 `nbook.stickers.packs`、`nbook.stickers` 远程合同的写入方法（`pack`、`createPack`、`updatePack`、`renamePack`、`deletePack`、`updateSticker`、`deleteSticker`、`listFiles`、`deleteFile`、`copyPack`、`revealPack`）、HTTP 路由 `PUT /api/nbook.stickers/packs/<id>/images/<文件名>`、`POST /api/nbook.stickers/import`、`GET /api/nbook.stickers/export/<id>`、Agent 提供的服务 `stickerAllowlistUsageKey`（页面可选依赖，查哪些 Profile 选了这个包）；选择器与补全（planned）：浏览器服务 `stickerPickerKey`（目录、搜索、最近用过与面板组件）、用户记录 `stickers.recent`、命令 `nbook.edit.sticker`、nb-markdown 的 `isStickerOnlyText`。
- **owner 与依赖方向**：`nbook.stickers` 持有表情目录、`stickers://`（`nbook.files` 的挂载方案）、取图路由与浏览器目录，插件包目录经平台服务 `plugin-platform/packages` 取（可选依赖）；`nbook.agent` 可选依赖 `stickersServiceKey`，持有白名单与槽，白名单的合成与 Skill 共用 `shared/profile-allowlist.ts`；表情包页与它的写入归 `nbook.stickers`（经 `nbook.files` 的写入接口写 `user://stickers/`），页面第一次需要名单时才解析 Agent 提供的 `stickerAllowlistUsageKey`（服务 id 必须以提供者插件 id 开头，所以键定义在 Agent 一侧；Agent 入口起不来时页面照常出现，改名对话框写通用提醒）；`nbook.markdown` 可选依赖 `stickerResolverKey`，经 `withHost` 交给 nb-markdown 的展示器与编辑器。nb-markdown 不依赖应用，只认端口。
- **关键不变量**：
  - 读写法、打字时的输入规则与写回时的转义共用一个判断（`stickers.ts` 的 `stickerAt`）；文字后面紧跟别的行内节点时，转义参考那个节点写出的第一个字（`codec.test.ts`“同一块里加了留作文字的写法，别处的写法不变”）；节点的原文一定是一个写法：读、输入规则与粘贴（`parseHTML` 校验）都只造合法的原文，写回原样（`sticker.dom.test.ts`“从展示器复制来的 HTML 粘贴回来”）。
  - 大图与间隙的类名由展示器的块后处理与编辑器的装饰给，判断是同一组函数；编辑器只重算改到的顶层块，相邻块的装饰不动（`sticker.dom.test.ts`“别的块里打字、删掉整块”）。
  - 交给浏览器的目录与概要按序列化字节装入，不超过远程单条消息上限（`stickers.test.ts`“目录与设置页的概要序列化后不超过远程消息的预算”）。
  - 稳定槽的文字只随白名单里的表情包变（`stickers-slot.test.ts`“输出 14、17”）。
  - 表情包页的写入只经文件服务写 `user://stickers/`：同一文件夹的写入排队，导入、导出、复制同时只做一个；改包名、删除、替换按文件夹身份令牌条件执行，令牌随目录扫描在读内容之前取、页面取自打开对话框与确认框那一刻；删除只认包内的图片文件；清单项按清单里的原样名字定位；导出的包满足导入端同样的限制（`stickers.test.ts`“表情包页的写入”“表情包页的上传、导入与导出”，`web/packs-page.test.ts`“改包名与删除用页面传来的令牌”）。

## 证据

- 批准依据：开发者在 2026-11-17 的对话里确认：表情写法、两种大小、在 Agent 回复里显示、按 Skill 的方式选包、第一版不做用户发表情、先用占位图（“其他的都同意”）；表情写法做成方言、编辑器也能用（“可以，都同意”）；设计审查后改为 nb-markdown 的内置方言加宿主端口、槽里一律教带包的写法、在 Files 修挂载点被换掉后的重开（“没问题”）。2026-11-18 开发者提出表情的 `when` 改成可选的说明、名字可以不写；确认清单可省、没有表情列表时图片都算常用、文件名当不了名字时隔离并写诊断、写了列表只认列表（[`w00050 t07`](../../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t07-sticker-format-simplify/README.md)）。2026-11-18 开发者提出要有表情包设置页（新建、编辑、导出导入），经三轮评审板定稿，并定了改包名不迁移白名单、改名写进清单、超限图片的边角与 zip 格式（[`w00050 t08`](../../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t08-sticker-settings-page/README.md) 的“决定”）。Task：[`w00050 t02`](../../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t02-sticker-system/README.md)。
- 实现入口：[`plugins/stickers/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/stickers/backend/plugin.ts)、[`plugins/stickers/backend/editor.ts`](../../../packages/neuro-book/src/plugins/stickers/backend/editor.ts)、[`plugins/stickers/web/packs-page.ts`](../../../packages/neuro-book/src/plugins/stickers/web/packs-page.ts)、[`plugins/stickers/web/plugin.ts`](../../../packages/neuro-book/src/plugins/stickers/web/plugin.ts)、[`agent/backend/stickers/extension.ts`](../../../packages/neuro-book/src/plugins/agent/backend/stickers/extension.ts)、[`nb-markdown/src/stickers.ts`](../../../packages/nb-markdown/src/stickers.ts)、[`nb-markdown/src/language/syntax/sticker/index.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/index.ts)
- 合同测试：[`stickers.test.ts`](../../../packages/neuro-book/src/plugins/stickers/stickers.test.ts)、[`backend/archive.test.ts`](../../../packages/neuro-book/src/plugins/stickers/backend/archive.test.ts)、[`web/packs-page.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/packs-page.test.ts)、[`web/sticker-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/sticker-page.dom.test.ts)、[`web/pack-view.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/pack-view.test.ts)、[`web/upload-queue.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/upload-queue.test.ts)、[`web/http.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/http.test.ts)、[`web/zip-preview.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/zip-preview.test.ts)、[`web/resolver.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/resolver.test.ts)、[`web/markdown-wiring.dom.test.ts`](../../../packages/neuro-book/src/plugins/stickers/web/markdown-wiring.dom.test.ts)、[`stickers-slot.test.ts`](../../../packages/neuro-book/src/plugins/agent/stickers-slot.test.ts)、[`profile-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.dom.test.ts)、[`shared/manifest.test.ts`](../../../packages/neuro-book/src/plugins/stickers/shared/manifest.test.ts)、[`nb-markdown stickers.test.ts`](../../../packages/nb-markdown/src/stickers.test.ts)、[`sticker/codec.test.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/codec.test.ts)、[`sticker/sticker.dom.test.ts`](../../../packages/nb-markdown/src/language/syntax/sticker/sticker.dom.test.ts)
- Smoke：[`e2e/stickers.e2e.ts`](../../../packages/neuro-book/e2e/stickers.e2e.ts)、[`e2e/sticker-packs.e2e.ts`](../../../packages/neuro-book/e2e/sticker-packs.e2e.ts)（表情包页：验收 9、10、改包名、Esc、方向键）
