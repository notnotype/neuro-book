---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: story.cli
owners:
  - nb-story
---

# 剧情图谱：命令行与 Skill

## 目标与非目标

给人和外部 Agent（Claude Code、Codex 等）一个命令行 `nbstory`：管理书库、按阅读位置查询小说记忆图、启动查看器的独立服务；再配一份 Skill，教 Agent 用这个命令行回答关于小说剧情的问题。查询命令与 [`story.queries`](queries.md) 的方法一一对应，命令行是这份接口给人与外部 Agent 用的形式；以后插件给 NeuroBook 内 Agent 的工具用同一份方法清单。

明确不承诺：

- 只有 `ask`（内置问答）、`config test`（检查问答配置）与 `ingest`（抽取）调用模型，见 [`story.qa`](qa.md)、[`story.ingest`](ingest.md)；其余命令不调用模型。Skill 教外部 Agent 自己查、自己答，不引导它调 `ask`。
- 只用 Bun 运行，支持 Linux、macOS 与 Windows（[ADR 0031](../../adr/0031-nb-story-supports-windows.md)）。命令行作为 npm 包 `@notnotype/nb-story` 发布（[ADR 0029](../../adr/0029-workspace-packages-publish-source-to-npm.md)），也可以从仓库运行。
- Skill 不保证外部 Agent 一定按它做；它给出步骤、规则与判据。

## 术语与参与者

- **阅读位置**、**视角**、**出处**：见 [`story.queries`](queries.md#术语与参与者)。
- **外部 Agent**：在用户终端里运行、能执行命令的编码 Agent。

## 输入与前置条件

命令（`<对象>` 可写 id、名字或任一称呼，按 [`story.queries`](queries.md#方法清单) 的规则解析，对应不止一个对象时报 `entity_ambiguous` 并列出候选；`--at` 写 `章` 或 `章.段`）。一条命令对应一个方法：

| 命令 | 对应方法 | 用途 |
|---|---|---|
| `nbstory books` | `books.list` | 列出书库里的书 |
| `nbstory import <文件> --title <书名> [--id <书 id>]` | `book.import` | 把 V9 记忆图收进书库 |
| `nbstory remove <书>` | `book.remove` | 从书库删除一本书 |
| `nbstory info [--at]` | `book.info` | 书的信息与目录 |
| `nbstory stats [--at]` | `book.stats` | 可见记录数与全书抽取统计 |
| `nbstory chapter <章>` | `chapter.digest` | 这一章的变化 |
| `nbstory find <名字或称呼> [--kind <类别>] [--at]` | `entities.list` | 找对象：全部称呼、身份、出场次数 |
| `nbstory card <对象> [--at] [--perspective <对象>]` | `entity.card` | 人物卡 |
| `nbstory knowledge <对象> [--state <状态>] [--query <字>] [--at]` | `entity.knowledge` | 他知道的事 |
| `nbstory statements <对象> [--query <字>] [--at]` | `entity.statements` | 关于他的说法 |
| `nbstory appearances <对象> [--query <字>] [--at]` | `entity.episodes` | 他参与的情节 |
| `nbstory knows [--at]` | `secrets.matrix` | 谁知道什么（秘密矩阵） |
| `nbstory ties <对象> [--perspective <对象>] [--at]` | `entity.relations` | 他和每个对象的关系：关系词、身份连接、一句说明 |
| `nbstory between <对象> <另一个> [--perspective <对象>] [--at]` | `entity.relation` | 两个对象之间的全部说法、一起出场的情节、互相知道的事 |
| `nbstory relations [--perspective <对象>] [--kinds <类别>] [--min-together <次>] [--at]` | `graph.relations` | 人物之间的关系、同场、认知与身份连接 |
| `nbstory ledger [--at]` | `ledger.tracks` | 各项数值与任务的当前值 |
| `nbstory track <数值> [--at]` | `ledger.track` | 某一项的流水与对账差额 |
| `nbstory questions [--state <状态>] [--query <字>] [--at]` | `questions.list` | 悬念与进展 |
| `nbstory timeline [--order story\|source] [--at]` | `timeline` | 时间线 |
| `nbstory episodes [--arc <主线>] [--query <字>] [--at]` | `episodes.list` | 情节 |
| `nbstory arcs [--at]` | `arcs.list` | 当前这一批主线 |
| `nbstory search <文字> [--kinds <类>] [--at]` | `search` | 搜名字、说法、原文 |
| `nbstory read <章.段[-段]> [--at]` | `source.read` | 读原文 |
| `nbstory para <章.段> [--at]` | `source.records` | 引用某一段的记录 |
| `nbstory serve [--port <端口>] [--open]` | — | 启动查看器的独立服务 |
| `nbstory ask <问题>`、`nbstory qa`、`nbstory config` | — | 内置问答、问答记录与问答配置，见 [`story.qa`](qa.md#命令) |
| `nbstory ingest <原文文件>`、`nbstory ingest --book`、`nbstory ingest --status` | — | 导入原文并抽取、接着抽、看进度，见 [`story.ingest`](ingest.md#命令) |
| `nbstory skill install [--agent claude\|codex] [--dir <目录>] [--force]` | — | 把随包的 Skill 装进外部 Agent 的 Skill 目录 |

- 所有书级命令都接受 `--book <书>`（书库只有一本书时可省略）；所有命令都接受 `--library <目录>` 与 `--json`；分页的命令接受 `--limit` 与 `--cursor`。
- 参数名与方法参数同名（多词的写成连字符形式，例如 `--min-together` 对 `minTogether`）。
- `reading.get`、`reading.set`、`graph.book`、`graph.storyline` 只给查看器用，没有命令。

## 输出与可观察行为

1. **一致。** 同一命令、同一参数下，`--json` 输出的 `data` 与对应方法经 [`story.queries`](queries.md) 返回的结果相同；同一问题、同一阅读位置，命令行与查看器给出的内容相同。
2. **输出形式。** 默认给人读的文字，出处一律写成“章.段”；`--json` 输出 `{"ok": true, "data": <方法结果>}` 或 `{"ok": false, "error": {"code", "message"}}`，标准输出只有这一个 JSON。
3. **不剧透。** 带 `--at` 时，输出按 [`story.queries`](queries.md#阅读位置与视角) 的不剧透规则给出（含它规定的唯一例外：`read` 可以读本章位置之后的原文）；不带时读到最后。
4. **查看器地址。** 有一个有效的独立服务登记（见“副作用与数据”）时，给人读的输出末尾附上查看器里对应画面的地址，形状按 [`story.viewer`](viewer.md#边界与兼容)；地址里不含登录口令。
5. **`serve`。** 启动只监听本机的独立服务（不给端口时自动选一个空闲端口），先开始监听、再写下服务登记，然后打印登录链接（形状见 [`story.queries`](queries.md#边界与兼容)）；`--open` 用默认浏览器打开它。服务在前台运行，收到 SIGINT、SIGTERM 或 SIGHUP 时停止：先停下本服务的抽取任务与问答（运行中的一轮按“中断”保存，[`story.qa`](qa.md) 输出 33），再撤销自己的登记、停止监听，口令与会话随之作废，退出码 0（撤销登记失败时为 1）。同一书库同时只允许一个有效的服务。
6. **`import`。** 成功时输出新书的 id；失败时书库不变。
7. **退出码。** 0 成功；1 查询失败（错误码见 [`story.queries`](queries.md#失败与恢复)）；2 用法错误（未知命令或参数）；`serve` 启动失败为 3；`ask` 另有 4 与 130，见 [`story.qa`](qa.md) 输出 14；`config` 的退出码见 [`story.qa`](qa.md) 输出 22；`ingest` 的见 [`story.ingest`](ingest.md) 输出 15；`skill install` 的见输出 16。

### Skill

8. **何时用。** Skill 的触发说明：用户问书库里某本小说的剧情、人物、身份、谁知道什么、数值、悬念、时间线或情节。
9. **怎么跑。** Skill 写明装好 npm 包后直接运行 `nbstory`，也写一句从仓库运行的方式，以及先用 `nbstory books` 确认书。
10. **答题步骤。** 先用 `find` 查清问题里每个对象的全部称呼与身份；按题型用 `knows`、`relations`、`ledger`、`questions`、`timeline`、`episodes`、`search` 找线索；再用 `read` 读相关章段核对；答案里每个关键结论引用“章.段”。名字或称呼对应不止一个对象时，按命令列出的候选改用 id。
11. **知情题的规则。** 回答谁知道什么时：旁白点破、读者读到的内心只说明读者知道；说一个角色知道，要指出他在场看到、被告知、看到消息或视频，或自己推断的段落；没有记录写“原文没有表明”，不当作不知道。
12. **答案格式。** 先给结论；“谁知道什么”的题再给一张一行一人的表（知道吗：知道、不知道、原文没有表明；怎么知道的；依据出处），完整说明放在表后；概括、关系类的题给结论加分点。结论标明明说、推断或无法确定。
13. **防剧透。** 用户说了读到哪里，所有命令都带同一个 `--at`，答案不提及之后的内容；用户没说时，回答前问一句读到哪里，用户说读完了或不在乎剧透时才不带。
14. **提醒。** 图是自动抽取的，结论以原文为准；命令结果与原文不一致时以原文为准，并在答案里说明。

### 用法与帮助

15. **帮助与版本。** 不带命令运行，或带 `--help`，列出全部命令与通用选项；`nbstory <命令> --help` 只给这条命令的用法与选项说明，`nbstory config <动作> --help` 给这个动作自己的选项（例如 `init` 的 `--base-url`、`--force`，`set` 的 `--max-tokens`），退出码 0。`--version` 打印 `nbstory <版本>`，退出码 0。不带命令时退出码 2。选项写在命令名前后效果相同。`config set ingest.model` 与 `config set ingest.recall.model` 除了写整段 JSON，也可以给 `--model`、`--base-url`、`--api-key-env`、`--max-tokens` 分项写。

### 安装 Skill

16. **`skill install`。** 把随包的 Skill 目录（`SKILL.md` 与 `references/`）装到目标：缺省或 `--agent claude` 是 `$HOME/.claude/skills/nbstory`，`--agent codex` 是 `$HOME/.agents/skills/nbstory`，`--dir <目录>` 是 `<目录>/nbstory`（相对路径按当前目录解析）。`--dir` 与 `--agent` 同时给是用法错误。不给 `--dir` 而 HOME 为空或不是绝对路径时按 F6 失败，不装进当前目录。父目录不存在时创建。成功时退出码 0，`--json` 的 `data` 是 `{path, state}`，替换后没能删掉旧目录时另有 `leftover`（见输出 17）：`path` 是目标的绝对路径，`state` 是下面三种之一。
    - `installed`：目标原来不存在，现在装好了。
    - `unchanged`：目标的文件集合与每个文件的内容都和随包的相同，什么都不写。
    - `replaced`：目标内容不同（多出文件也算不同），带了 `--force`，换成随包的内容；目标里用户自己加的文件随之删掉。
17. **不装半份。** 内容先写到目标旁边的临时目录，写完再换到目标位置。新内容就位之前任何一步失败，目标保持原样（原来没有就仍然没有），临时目录清掉。新内容就位之后删旧目录失败（例如里面有不可写的子目录），替换照样成功：`state` 是 `replaced`，`data.leftover` 是留下的旧目录（在目标旁边，以 `.nbstory-skill-old-` 开头），给人读的输出写明它与系统错误码，请用户确认后手动删除。

## 状态与转换

- 命令行每次运行只读或只写一次书库，不常驻；`serve` 是唯一常驻的命令。
- `serve` 运行期间，命令行的其它命令照常读写同一书库；独立服务读到的书库变化（导入、删除）在下一次请求时生效。
- 第二个 `serve` 在同一书库上、已有有效登记时启动失败（退出码 3），提示已有服务的地址；两个 `serve` 同时启动时恰有一个成功。

## 副作用与数据

- 书库的读写规则见 [`story.queries`](queries.md#副作用与数据)。
- **服务登记**：`serve` 运行期间在书库里写一份登记：这次服务的实例号（每次启动新生成）、地址与端口，不含口令。它不属于书的数据，书库版本不认识时也照写。
- **有效的登记**：登记里的地址能连上，且那里的服务报出的实例号与登记相同；连不上或实例号不同，这份登记无效（服务异常退出留下的、端口被别的程序占用的都算），下一次 `serve` 直接覆盖它。
- `serve` 启动失败时不留下登记；撤销时只撤销实例号是自己的那份。

## 失败与恢复

| 编号 | 情况 | 表现 |
|---|---|---|
| F1 | 查询失败 | 退出码 1；给人读时写错误说明与下一步，`--json` 时输出 [`story.queries`](queries.md#失败与恢复) 的错误码 |
| F2 | 未知命令或参数 | 退出码 2，打印用法 |
| F3 | `serve` 端口被占用，或同一书库已有有效的服务 | 退出码 3，写明原因；已有服务时给出它的地址 |
| F4 | `skill install` 的目标已存在、内容不同，且没给 `--force` | 退出码 2，错误码 `skill_exists`，写明目标路径与 `--force` 的后果 |
| F5 | `skill install` 的目标是符号链接或普通文件 | 退出码 2，错误码 `skill_target_invalid`；不跟随、不覆盖 |
| F6 | `skill install` 读写失败（权限、磁盘），或不给 `--dir` 时 HOME 不可用 | 退出码 1，错误码 `skill_install_failed`，写明路径与系统错误码（HOME 不可用时建议用 `--dir`）；目标保持原样 |

## 边界与兼容

- **公开接口**：命令名、参数名、`--json` 的输出形状与退出码；新增命令与可选参数不算破坏兼容。
- **Skill**：随包提供的 `SKILL.md` 与参考文件，用 `skill install` 装进外部 Agent 的 Skill 目录；属于开发者以外用户可用的资产，内容随命令变化同步更新。`skill install` 只写目标目录，不读书库与密钥。
- **安装包**：`@notnotype/nb-story` 的版本按 [ADR 0029](../../adr/0029-workspace-packages-publish-source-to-npm.md) 管理；命令行的公开接口变化照上一条判断是否破坏兼容。
- 除 `ask`、`config test`、`ingest` 外，命令行不读密钥、不发起网络请求（`serve` 只监听本机，它运行网页发起的抽取任务时同样读密钥、向模型服务发请求）；这几条命令从配置指定的环境变量读密钥，只向配置里的模型服务发请求。`config` 的其它动作只读写配置文件，不读密钥值。

## 验收与 Smoke

1. **命令与方法一致。** 对每条查询命令，`--json` 的 `data` 与进程内调用对应方法的结果逐字段相同。
2. **不剧透。** `nbstory card 苏天晴 --at 7` 的输出里没有 8.48 才出现的称呼“心月狐”，`nbstory knows --at 7` 里没有第 8 章及以后揭晓的秘密；`nbstory read 39.1 --at 38.57` 退出码 1，错误码 `beyond_position`。
3. **查看器地址。** `serve` 运行时，`nbstory card 苏天晴 --at 38` 的输出末尾地址在已登录的浏览器里打开到同一人物卡与阅读位置；地址里没有口令。
4. **服务独占。** 同一书库再次 `serve` 退出码 3 并给出已有服务的地址；第一个服务停止后再启动成功；第一个服务被强行结束（不撤销登记）后再启动也成功；两个 `serve` 同时启动恰有一个成功。
5. **Agent 按 Skill 作答。** 用提案评测里的 16 道知情、身份题，每题按它自己要求的阅读位置提问（Agent 被告知读到哪里）。先记下这次用的外部 Agent 与模型版本、题集版本与判分方式。
   1. 确定性检查：每份答案都引用了出处，且不提及这道题阅读位置之后的内容。
   2. 答对率：同一 Agent 把 16 题各答 3 次，共 48 份，一审答错不超过 11 份（与提案评测的基线 11/48 相同）。换了 Agent 或模型版本要重新跑。

6. **从安装包运行。** 把包打好装进仓库外的空 Bun 项目（不继承仓库的依赖）：`nbstory --help` 退出码 0；空书库上 `nbstory books --json` 的书是空列表；`skill install --dir` 第一次 `installed`、第二次 `unchanged`；`serve` 的登录链接在真实浏览器里打开书架页、没有脚本错误，SIGTERM 后退出码 0。

Smoke：在真实书库上，用 100 章样例书跑场景 1 到 4；场景 5 用一个外部 Agent 跑一遍并留下答案记录；场景 6 是仓库根的 `bun run release:smoke`。

## 实现合同

- **公开入口**：命令行 `nbstory`（包 `@notnotype/nb-story` 的 bin）的命令、参数、`--json` 形状与退出码；随包的 Skill（`packages/nb-story/skill/` 下的 `SKILL.md` 与 `references/`）。
- **owner 与依赖方向**：nb-story。查询命令经核心库的 `createStoryApi` 调方法，不另写查询逻辑；`serve` 装配核心库、HTTP 层与抽取服务。核心库不依赖命令行。
- **关键不变量**：
  - 查询命令由一张命令表映射到方法，`--json` 的 `data` 就是这个方法的结果；命令表里没有的方法没有命令（`cli.test.ts` 的命令与方法一致）。
  - 同一书库的 `serve` 单实例靠对书库里锁文件的操作系统独占锁，进程怎么结束锁都随之释放；登记只由持锁者写，不含口令（`server.test.ts` 的单实例与登记）。
  - `serve` 的先后：拿锁、开始监听、写登记、装上停止信号的处理，最后才打印登录链接；停止时先停本服务的抽取任务与问答，再撤销登记、停监听、放锁（`server.test.ts` 的启动与 `--json`、`server/ingest.test.ts` 的停服顺序、`server/qa.test.ts` 的运行中停服）。问答引擎依赖的 OMP 一被导入就接管终止信号，`serve` 经 nb-harness 的 `onProcessTermination` 收口（[`agent.harness`](../agent/harness.md) 输出 20）。
  - 给人读的输出附查看器地址只在登记有效（地址连得上、实例号相同）时（`server.test.ts` 的命令行查看器地址）。

## 证据

- 批准依据：[剧情图谱第一版提案](../../proposals/novel-story-app.md)（accepted，含 2026-10-15 第一版不做内置问答、随后改为做内置问答的决定）；开发者 2026-10-15 在 w00024 t02 的决定；内置问答见 [`story.qa`](qa.md)；开发者 2026-10-24 定发布到 npm、加 `skill install`（w00024 t17，[ADR 0029](../../adr/0029-workspace-packages-publish-source-to-npm.md)）。
- 实现入口：[`cli/main.ts`](../../../packages/nb-story/src/cli/main.ts)、[`cli/skill.ts`](../../../packages/nb-story/src/cli/skill.ts)、[`scripts/release/pack-smoke.ts`](../../../scripts/release/pack-smoke.ts)、[`cli/commands.ts`](../../../packages/nb-story/src/cli/commands.ts)、[`server/serve.ts`](../../../packages/nb-story/src/server/serve.ts)、[`server/registry.ts`](../../../packages/nb-story/src/server/registry.ts)、[`skill/SKILL.md`](../../../packages/nb-story/skill/SKILL.md)
- 合同测试：[`cli/cli.test.ts`](../../../packages/nb-story/src/cli/cli.test.ts)、[`cli/skill.test.ts`](../../../packages/nb-story/src/cli/skill.test.ts)（输出 16、17，F4 到 F6）、[`server/server.test.ts`](../../../packages/nb-story/src/server/server.test.ts)、[`e2e/viewer.e2e.ts`](../../../packages/nb-story/e2e/viewer.e2e.ts)（验收 3）
- Smoke：场景 1、2 由 [`cli/cli.test.ts`](../../../packages/nb-story/src/cli/cli.test.ts) 以子进程跑真实命令；场景 3 由 [`e2e/viewer.e2e.ts`](../../../packages/nb-story/e2e/viewer.e2e.ts) 在真实服务与 Chromium 上跑；场景 4 由 [`server/server.test.ts`](../../../packages/nb-story/src/server/server.test.ts) 起真实 `serve` 子进程跑；场景 6 由仓库根的 `bun run release:smoke` 跑（打包装进仓库外的项目、真实 Chrome），发布后用 `--from registry` 再跑一次；场景 5 的评测记录见 [w00024 t03 的 Skill 评测报告](../../../.agents/works/w00024-nb-story/tasks/t03-impl/evidences/skill-eval/report.md)（2026-10-15，一审答错 3/48）
