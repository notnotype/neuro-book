---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: images.recipes
owners:
  - nbook.images
---

# 图像配方：节、预设、风格组合与片段

## 目标与非目标

一份配方说明一张图“要生成什么”。本 Spec 规定以下几件事：
- **文件格式：**配方、预设、片段、风格组合四种文件的格式。
- **节与角色框：**配方怎样分节，角色框怎样组织。
- **预设：**预设怎样以“引用加差异”挂在节上，更新预设时谁跟着变。
- **风格组合与本书默认：**一组预设怎样一次套上，新配方从哪一组开始。
- **片段：**片段怎样引用、怎样展开。
- **本书、预设库与官方预设：**三处的预设各在哪里、怎样互相复制。
- **展开：**配方怎样展开成与后端无关的生成请求。
- **快照与恢复：**每一批生成怎样存下配方当时的样子，以及怎样从快照恢复。
- **按 id 的索引：**怎样按 id 找到这些文件，以及复制出重复 id 时怎么办。

提示词本身的表示与写法见 [`images/prompt`](prompt.md)。

不承诺：

- 生成、排队、费用、后端的能力声明：归 `images/generation`。参数有哪些字段、取值范围，由那里的能力声明给出。
- 生成记录、仓库、快照文件的存放与对账：归 `images/library`。本 Spec 只规定快照里有什么、哈希怎么算。
- 要用词库的检查与粘贴拆分：归 `images/checks`。
- 工作台怎样画这些东西：归 `images/workbench`。
- 角色框的内容来自角色设定；底图字段只预留形状，没有行为。

已知限制：两台机器各自给同一份复制出来的文件换了不同的新 id，经 Git 合并时这一行会冲突，由作者选一个。

## 术语与参与者

- **配方**：一张图“要生成什么”，由有序的节、角色框、参数、尺寸、张数、种子与底图组成。
- **节**：文字提示词按用途分的格子，有种类与可选的名字。
- **角色框**：一个角色（或一个物体、一格分镜）自己的正面与负面提示词。
- **预设**：一种节或参数的一份有名字的内容。
- **差异**：配方里一节相对它所引用的预设改了什么，由若干条改动组成。
- **锚点**：“加一项”记着加在哪一项后面，记那一项的规范化文字。
- **作废的改动**：针对预设里已经没有的项的改动。
- **风格组合**：一组“节的种类与名字，对应一个预设”，外加一个参数预设。
- **本书默认**：新建配方时套上的那个风格组合。
- **片段**：有名字的一小组词，分核心词与陪衬词，可以有主提示词与各角色框几部分。
- **本书、我的预设库、官方预设**：
  - 本书指作品目录里的文件；
  - 我的预设库是 `user://image-presets/` 里跨书的文件；
  - 官方预设随插件提供，只读。
- **展开**：把配方变成与后端无关的生成请求。
- **内容快照**：某一时刻配方、预设或片段的完整内容，按哈希认。
- **id 索引**：本书里每个 id 当前在哪个文件。
- 规范化文字、项、一段提示词：见 [`images/prompt`](prompt.md)。

## 输入与前置条件

四种文件，都是 UTF-8 的 JSON：

| 文件 | 扩展名 | `schema` |
|---|---|---|
| 配方 | `.recipe.json` | `nbook.image-recipe/v1` |
| 预设 | `.preset.json` | `nbook.image-preset/v1` |
| 片段 | `.fragment.json` | `nbook.image-fragment/v1` |
| 风格组合 | `.style.json` | `nbook.image-style/v1` |

每个文件都有 `schema` 与 `id`。

- id 在本书里唯一，由插件生成，至少 12 个字符，取自小写字母与数字。
- 官方预设的 id 以 `official:` 开头。

配方：

```ts
{
  schema: "nbook.image-recipe/v1",
  id: string,
  model: string,                       // 后端的模型 id
  sections: Section[],                 // 有序
  characters: Character[],             // 有序，先后决定人物大致的左右站位
  params: {preset?: ParamsRef; values: Record<string, unknown>},
  size: {width: number; height: number},
  count: number,                       // 一批几张
  seed: number | null,                 // null：每批随机
  base?: unknown,                      // 预留：源图、遮罩、强度
}
type Section = {
  id: string,
  kind: "subject" | "style" | "quality" | "content" | "language" | "general" | "negative",
  name?: string,
  disabled?: true,
} & ({prompt: Prompt} | {preset: PresetRef})
type PresetRef = {id: string; diff: Change[]}
type Change =
  | {op: "add"; item: Item; after: string | null}       // after：锚点；null 表示加在最前
  | {op: "remove"; key: string; nth?: number}            // key：规范化文字；nth：第几次出现，缺省 0
  | {op: "set"; key: string; nth?: number; weight: number}
type ParamsRef = {id: string; diff: ({op: "set"; field: string; value: unknown} | {op: "unset"; field: string})[]}
type Character = {id: string; title: string; positive: Prompt; negative: Prompt; disabled?: true}
```

节的种类：

| `kind` | 名称 | 去处 | 能套的预设 |
|---|---|---|---|
| `subject` | 主体 | 主提示词 | 无 |
| `style` | 画风 | 主提示词 | 画风 |
| `quality` | 质量 | 主提示词 | 质量 |
| `content` | 内容 | 主提示词 | 无 |
| `language` | 自然语言 | 主提示词 | 无 |
| `general` | 通用 | 主提示词 | 无 |
| `negative` | 负面 | 负面提示词 | 负面 |

预设：

```ts
{
  schema: "nbook.image-preset/v1",
  id: string, name: string,
  kind: "style" | "quality" | "negative" | "params",
  model?: string,                      // 在哪个模型上调的
  prompt?: Prompt,                     // kind 不是 params 时必有
  values?: Record<string, unknown>,    // kind 是 params 时必有；不含尺寸、张数、种子
  sample?: {image: string; from?: string},  // 样图：WebP 的 data URL，不超过 64 KiB；from 是原图的哈希
  origin?: {from: "library" | "official"; id: string; at: string},  // 复制自哪里，at 是 ISO 时间
}
```

风格组合：

```ts
{
  schema: "nbook.image-style/v1",
  id: string, name: string,
  entries: {kind: "style" | "quality" | "negative"; name?: string; preset: string}[],
  params?: string,                     // 参数预设的 id
  origin?: {from: "library" | "official"; id: string; at: string},
}
```

片段：

```ts
{
  schema: "nbook.image-fragment/v1",
  id: string, name: string,
  use: "appearance" | "outfit" | "action" | "expression" | "interaction" | "scene" | "composition",
  main?: {core: Item[]; support: Item[]},
  characters?: {core: Item[]; support: Item[]}[],
  note?: string,
  origin?: {from: "library" | "official"; id: string; at: string},
}
```

片段的七种用途依次是外貌、服装、动作、表情、互动、场景、构图。片段里的项只能是词与句子。

其它输入：

- **本书默认：**本书项目层配置里的一项“默认风格组合”（`images.defaultStyle`），值是一个风格组合的 id。
- **文件的位置：**四种文件放在本书的哪个目录都行，插件按扩展名在全书里找，不看 `.nbook/`、`.git/`，以及文件服务排除的目录。新建时缺省放在：配方 `插图/配方/`，预设与风格组合 `插图/预设/`，片段 `插图/片段/`。
- **我的预设库：**`user://image-presets/`，文件格式相同。
- **官方预设：**随插件提供，每本书都能直接用。

## 输出与可观察行为

**文件与 id**

1. **读文件。**
   - 按 `schema` 校验。版本比插件认识的新，就只读打开，给出 `unsupported-version`，不改写。
   - 插件改写文件时，原样保留不认识的字段。
   - 写出的 JSON 用两个空格缩进，字段按本 Spec 的顺序排，末尾有换行，所以改一处只在 Git 里显示为一处改动。
2. **新 id。**这些情况都给新 id：新建；“复制”配方、预设、片段或风格组合；从我的预设库或官方预设拿进书里。从别处拿进来的，记下 `origin`。
3. **id 索引。**
   - 项目入口激活时，扫描全书，建立 id 到文件路径的索引；之后跟着文件的变化更新。
   - 每个 id 上次所在的路径记在 `.nbook/images/ids.json`。
   - 按 id 查找要等第一次扫描完成。
4. **重复的 id。**两个文件的 id 相同时：
   - 路径和记录对得上的那个保留 id，另一个由插件换新 id。那个文件正开在工作台里时，换 id 作为一次编辑交给工作台，否则经文件服务写入。
   - 两个都没有记录时，两个都不动，给出 `duplicate-id`；在作者打开其中一个、选定哪个是原件之前，按这个 id 的引用一律当作 `duplicate-id` 处理。

**节与角色框**

5. **新建配方。**
   - 先建这些节：主体、画风、质量、内容、自然语言，再加三个负面节，依次名为“官方段”“我的负面”“要避开的画师”。
   - 然后套上本书默认的风格组合（输出 17）。
   - 本书默认没设或找不到时，各节为空，并提示一句。
6. **节的操作。**可以：
   - 加一个任意种类的节，可起名；
   - 改名、调顺序、删除、停用。

   同一种节可以有几个。停用的节不参与展开。
7. **角色框的操作。**可以加、删、调顺序、改标题、停用。每个角色框有正面与负面两段提示词。
8. **主体数量自动补。**展开时，如果主体节里没有主体数量的词（`1girl` 到 `6+girls`、`1boy` 到 `6+boys`、`1other` 到 `6+others`、`no humans`），而又有没停用的角色框：
   - 按正面第一项的规范化文字是 `girl`、`boy`、`other` 的角色框各数几个，补成 `2girls`、`1boy` 这样的词；
   - 补的词放在第一个主体节的最前面；
   - 已经有这些词就不动。

**预设与差异**

9. **套用预设。**只能给能套这种预设的节套（见“节的种类”表），参数预设只能套在参数上。套上以后，节的内容就是预设的内容，差异为空。种类对不上时给出 `kind-mismatch`，不套。
10. **节的实际内容。**
    - 从预设当前的内容出发，按差异依次做：先做全部“去”，再做全部“改值”，最后按差异里的顺序做“加”。
    - “加”放在锚点那一项后面，锚点可以是前面加进来的项；锚点不在了，就加到末尾。
    - “去”与“改值”找不到对应的项（按规范化文字与第几次出现），就是作废的改动：不做，给出 `diff-void`，不写任何文件。
11. **差异怎么算。**作者在一个引用了预设的节里编辑以后，差异由节的当前内容与预设的内容算出：
    - 两边按规范化文字取最长公共子序列；
    - 预设里不在子序列中的项记为“去”；
    - 节里不在子序列中的项记为“加”，锚点是它前面最近的一项；
    - 两边都有、权重不同的记为“改值”。

    所以调换顺序会记成一去一加，没有“挪位置”这种改动。
12. **节上的三个动作。**
    - **还原：**清空差异。
    - **另存为新预设：**用节的实际内容新建一个预设，节改为引用它，差异为空。
    - **更新预设：**把节的实际内容写回预设，节的差异清空。
13. **更新预设。**写回前列出本书里引用这个预设的全部配方，每份写明哪些项会跟着变、哪些项保持它自己的值。确认后只写预设文件，不写任何配方文件。之后各配方的实际内容按输出 10 重新算，差异里作废的改动在该配方打开或展开时给出 `diff-void`。
14. **换预设。**给一节换成另一个同种的预设，差异保留，按输出 10 对新预设重新算；作废的改动给出 `diff-void`。
15. **模型对不上。**预设的 `model` 与配方的 `model` 不同时，那一节给出 `model-mismatch`，不阻止生成。
16. **参数预设。**参数的实际值这样算：先取参数预设的字段，再按它的差异 `set`、`unset`，最后补上配方 `values` 里有、而预设没有的字段。预设里出现尺寸、张数或种子时，给出 `invalid-file`。

**风格组合与本书默认**

17. **套用风格组合。**对组合里的每一条：
    - 挂到配方里同种、同名的节；没有同名的，挂到同种的第一节；没有同种的，新建一节。
    - 挂的规则同输出 14：节原来引用了别的预设，差异保留并重新算；原来没引用，就按输出 9 套上。

    组合里有参数预设时，同样换掉参数的预设。
18. **本书默认。**`images.defaultStyle` 指向的组合，只在新建配方时用一次，以后改了它，已有的配方不变。

**片段**

19. **插入片段。**
    - 在一节里插入片段，那一节得到一个指向片段主提示词部分的片段引用。
    - 片段有角色框部分时，第 i 部分插进第 i 个角色框的正面（没有的就新建角色框），各是一个带 `part` 的片段引用。
20. **展开片段。**一个片段引用展开成：所指部分的核心词，加上没被关掉的陪衬词，每一项的权重再乘以引用的权重。片段找不到时给出 `fragment-missing`。
21. **拆开成普通词。**把片段引用换成它展开以后的项。

**本书、我的预设库与官方预设**

22. **复制进出预设库。**“放进我的预设库”与“拿进书里”都是复制一份、给新 id、记 `origin`。复制风格组合时，连同它引用的预设一起复制，组合里的引用改指新的 id。
23. **官方预设。**官方预设只读，配方可以直接引用；“复制到本书”得到一份可以改的副本。

**展开**

24. **展开结果。**展开一份配方得到下面的数据。其中 `Weighted` 是词或句子加实际权重；`raw` 是按原文保存、拆不开的提示词：

    ```ts
    type Expanded = {
      model: string;
      params: Record<string, unknown>;
      size: {width: number; height: number};
      count: number;
      seed: number | null;
      images: {                        // 一张一份，共 count 份
        main: Weighted[];
        text?: string;                 // 图中文字
        negative: Weighted[];
        characters: {title: string; positive: Weighted[]; negative: Weighted[]; text?: string}[];
        picks: number[];               // 抽签结果，按随机项在配方里出现的顺序
      }[];
      snapshots: {recipe: string; presets: Record<string, string>; fragments: Record<string, string>};
    };
    type Weighted = {kind: "tag" | "sentence"; text: string; weight: number} | {kind: "raw"; text: string};
    ```
25. **展开的步骤。**
    - 按节的顺序跳过停用的节；每一节按输出 10 算出实际内容，展开片段，去掉停用的项。
    - 不是负面的节依次接成 `main`，负面节依次接成 `negative`，图中文字取出放进 `text`。
    - 按输出 8 补主体数量。
    - 角色框各自照同样的规则展开。
    - 然后按张数逐张抽签（[`images/prompt`](prompt.md) 输出 16）。
    - 每项的实际权重，是它所在各层权重的乘积。
26. **展开会失败的情况。**有 `preset-missing`、`fragment-missing`、`duplicate-id`、`invalid-file` 中任何一个时，展开失败，交回全部问题，不交回部分结果。`diff-void` 与 `model-mismatch` 不让展开失败。

**快照与恢复**

27. **内容快照。**
    - 快照是一个对象的完整内容：配方用展开那一刻编辑器里的内容（包括没保存的修改），预设与片段用当时解析到的内容。
    - 哈希是快照的规范 JSON 的 SHA-256。规范 JSON 是 UTF-8，键按码元顺序排，没有空白。
    - 展开结果的 `snapshots` 记下配方快照的哈希，以及每个被引用的预设与片段的快照哈希（按 id）。
28. **从快照恢复。**给一组快照，得到一份配方内容。这份内容不写文件，怎样交给编辑器见 `images/workbench`。
    - 引用了预设的节：
      - 预设现在还在，就仍引用它。节的内容要和快照那时的实际内容一样，差异按输出 11 对预设现在的内容重新算。
      - 预设不在了，那一节改成普通的一段提示词，内容是快照那时的实际内容，并给出提示。
    - 片段引用：
      - 片段还在，就保留引用；片段的内容和快照不同时给出提示，可以选择按快照的内容拆开成普通词。
      - 片段不在了，就按快照的内容拆开成普通词。
29. **引用不见了的修法。**一节给出 `preset-missing` 或 `fragment-missing` 时，有两个修法：从最近一批的快照把这一节恢复成普通词（规则同输出 28）；或另选一个预设、片段，差异按输出 14 处理。

## 状态与转换

- 配方文件在工作台里编辑，保存、未保存标记、外部改动照编辑器的规则（[`workbench/editor`](../workbench/editor.md)）。
- 预设、片段、风格组合文件，在词库的管理动作与“更新预设”里写，一律带期望写入：期望不符（文件被别处改过）时给出 `conflict`，重读后再请作者确认。
- 预设或片段文件变了，打开着的配方按新内容重算实际内容，不写配方文件，也不动它的未保存修改。
- 时序与寿命：
  - id 索引在项目入口激活后的第一次扫描完成时可用，之前的按 id 查找等它。项目代次结束，索引也随之作废。
  - 同一个预设被两处同时“更新”，后写的那处得到 `conflict`。
  - 展开拿的是那一刻的内容。展开以后预设或配方再改，不影响已经展开的结果，也不影响它的快照。
  - 换 id（输出 4）与作者的编辑同时发生时，开在工作台里的文件以编辑的方式换，和其它编辑一样能撤销。

## 副作用与数据

- **文件：**四种文件放在作品目录里与 `user://image-presets/`，是作者的数据，跟着书走，建议进 Git。
- **id 索引的记录：**`.nbook/images/ids.json` 由项目入口直接写；删掉以后，下次扫描重建，只是这时判不出谁是原件（输出 4）。
- **本书默认：**存在项目层配置里，归配置插件管。
- **快照：**本 Spec 只定内容与哈希，存放、去重与清理归 `images/library`。
- **大小：**
  - 样图不超过 64 KiB；
  - 配方文件要能装进作品文件的正文上限（[`workspace/files`](../workspace/files.md)）；
  - 一段提示词读入时的长度上限见 [`images/prompt`](prompt.md)。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-file` | 不是合法的 JSON，或者形状不对：缺字段、种类不认识、提示词数据不对、参数预设里有尺寸、张数或种子、样图超过 64 KiB | 工作台显示错误，可以用源码编辑器打开修改；这份文件不参与展开 |
| `unsupported-version` | 文件的版本比插件新 | 只读打开，不改写 |
| `preset-missing` | 引用的预设找不到 | 展开失败；按输出 29 修 |
| `fragment-missing` | 引用的片段找不到 | 展开失败；按输出 29 修 |
| `duplicate-id` | 书里两个文件 id 相同，又判不出谁是原件 | 展开失败；作者打开其中一个，选定原件 |
| `kind-mismatch` | 预设的种类和节对不上 | 不套 |
| `diff-void` | 差异里有作废的改动 | 提示；展开时忽略这几条 |
| `model-mismatch` | 预设记的模型和配方的不同 | 提示，不拦 |
| `conflict` | 写预设、片段、风格组合时，文件已被别处改过 | 重读后再确认 |
| `read-only` | 改官方预设，或改版本更新的文件 | 只能复制一份再改 |

## 边界与兼容

- 四种文件的格式是公开的：作者、Agent 与别的工具都可以直接读写。插件每次读都校验，不合法的按 `invalid-file` 处理。
- 版本：只增加可选字段时版本不变，旧插件保留不认识的字段；改变已有字段的含义时版本加 1，旧插件只读。
- 官方预设随插件的版本走。插件的新版本去掉了某个官方预设，引用它的配方得到 `preset-missing`。
- 展开结果是给后端适配器的公开接口（`images/generation`）。

## 验收与 Smoke

1. **预设更新的传播。**
   - 前提：配方 A、B 都引用画风预设 P，A 把 P 里一位画师的权重改成 0.8。
   - 操作：从 B 更新 P，加一位画师、改一个年份。
   - 结果：A 的实际内容多了这位画师、年份跟着变，那位画师仍是 0.8。A 的文件逐字节不变；B 的差异为空。
2. **作废的改动。**接场景 1，再从 B 把 A 改过权重的那位画师从 P 里去掉、更新 P。打开 A 时给出 `diff-void`；展开 A 成功，结果里没有这位画师。
3. **套用风格组合。**
   - 前提：配方有两个内容节，名为“服装”“光照”。
   - 操作：套上一个有画风、质量、三个负面预设与参数预设的组合。
   - 结果：画风与质量挂到各自的第一节；三个负面预设按名字挂到三个负面节；两个内容节不变。
4. **带角色框部分的片段。**配方只有一个角色框，插入一个有主提示词部分与两个角色框部分的片段：多出第二个角色框；展开后两个角色框各得到对应的词。
5. **复制出来的重复 id。**在资源管理器里复制一份配方。下次扫描时，原件保留 id，副本换了新 id；生成记录里引用原 id 的批次，仍然指向原件。
6. **恢复。**生成一批以后，先改了预设 P，再恢复这一批的配方：画风节仍引用 P，实际内容和当时一样。删掉 P 再恢复一次：那一节成了普通的一段提示词，内容和当时一样。
7. **多机重启。**项目重启后，id 索引照常重建；删掉 `.nbook/images/ids.json` 以后，再遇到重复 id 时给出 `duplicate-id`，而不是挑一个。

Smoke：随实现补。

## 证据

- 批准依据：[图像生成第一版：工作台、配方与标签库](../../proposals/image-generation-v1.md)（2026-11-10 `accepted`）的“配方、节、预设、片段”一节；[ADR 0048](../../adr/0048-image-recipe-sections-and-preset-diffs.md)；开发者 2026-11-10 确认的写 Spec 前的假设 R1 到 R6（[w00042 t03](../../../.agents/works/w00042-image-generation/tasks/t03-core-contracts/README.md#写-spec-前的假设2026-11-10-列出同日确认)）
