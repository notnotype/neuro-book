# t05 实施计划：内置问答与 `nbstory ask`

## Context

nb-story 第一版只给外部 Agent 用 Skill 问答。开发者 2026-10-15 改定做内置问答，引擎建在 nb-harness 上（[t05 README](README.md) 决定 1 到 3）；nb-harness 的加强（Profile 选工具、收尾工具、`turn()` 的结果）已在 [w00002 t21](../../../w00002-neuro-agent-harness-redesign/tasks/t21-harness-profile-tools/README.md) 完成并合入。

- 合同：[`story/qa.md`](../../../../../docs/specs/story/qa.md)（新，`planned`）；连带改 [`story/queries.md`](../../../../../docs/specs/story/queries.md) 输出 15 与“副作用与数据”、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md) 的命令表、退出码与边界；[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 输出 18 补“provider 错误回显的密钥要遮盖”。
- 开发者已定：一问一个 Agent 从头答到尾（决定 13），工具由 Profile 选（决定 9、14），不设步数上限（决定 10），Spec 要点与四点（决定 16 到 20：章数上限 20、出处必须读过、全读只记录、`nbstory qa` 现在做），回归门槛（56 题与 16 题）。
- 设计审查：omp 12 条，全部成立，本计划已按它修订（[evidences/design-review.txt](evidences/design-review.txt)）。
- 工作方式：代码在 worktree `.worktree/w00024-t05-qa`（分支 `feat/w00024-t05-qa`）；主会话写代码；后端审查交 omp。

## 关键设计

### `packages/nb-story/src/core/queries/search.ts`：按词拆开、按命中排序

- `terms(query)`：按空白与中英文标点（`\s` 与 `\p{P}`）拆开，去空、去重。拆不出词的查询（空串、只有标点）沿用现在的行为，不在这次改。
- 每条候选算命中的不同词数 `hits`，`hits > 0` 才收；各类内按 `hits` 降序，再按原来的先后（对象按首次出现、说法按数组顺序、原文按章段），用稳定排序保住原来的先后。
- `snippet` 截在第一个命中的词周围；`matches`（`context.ts`）不改，逐词调用。
- 测试：单个词时各类的条目与顺序（用样例书里已知的名字与原文，断言完整的前几条与总数）、多词命中与排序、标点拆词、第二页取回新条目。

### `packages/nb-story/src/core/api.ts`：固定一代的书会话

问答要求一问固定在开始时的一代上，而 `api.call` 每次调用都重新解析书。新增：

```ts
interface StoryApi {
    // 已有 library、call
    /** 固定这本书当前的一代；之后的调用都在这一代上，删除与重新导入不影响它。 */
    openBook(book: string | undefined): Promise<BookSession>;
}
interface BookSession {
    readonly id: string;
    readonly generation: string;
    readonly meta: BookMeta;
    call<M extends StoryMethod>(method: M, params: unknown): Promise<StoryOutcome<M>>; // 只接受书级方法；params 里的 book 被忽略
}
```

- 把 `bookCall` 拆成“取索引”与“在给定索引上查询”两段；`call` 用 `openBookIndex` 每次取，`BookSession.call` 用 `openBook` 时取到的那份。参数与结果的 schema 校验共用同一段。
- `openBookIndex` 返回的索引整份在内存里、取完即释放文件（`book-index.ts`），所以会话不持有文件句柄，不需要 `release`。

### `packages/nb-story/src/core/library.ts` 与 `qa-records.ts`：问答记录

只用 `node:fs`，放在 core，以后的独立服务（网页问答页）直接读。

- `Library` 加两样：`bookDir(id)`（现在各方法各自 `join`，收成一处）；`writableBook(id, generation)`：书库格式与这本书的 `BookMeta.format` 都认识、书目录存在且这一代就是 `generation` 时返回书目录，否则抛 `unsupported_format` 或 `book_not_found`。写门禁沿用 `importBook`、`setReading` 现有的检查函数。
- 记录与会话日志一起写：先在 `qa/` 下写两个临时文件，再先改名日志、后改名记录。读者只认 `.json` 记录，所以“看到记录”时日志已经在。`qa/` 用不递归的 `mkdir` 建在已存在的书目录里，书目录不在时失败而不是造一个出来。
- 运行期间书库里不写任何东西（会话日志在内存里，见引擎），所以删除书的 `rename` + 递归删除不会与一问的写入交错；写之前调 `writableBook`，删除后或换了一代就不保存。`writableBook` 与改名之间的窗口里发生的删除：按路径写的临时文件或改名找不到目录而失败，按“不保存”返回，残留的临时文件随旧目录删掉；重新导入：记录带旧代号，列表按代过滤，仍不出现。

```ts
type QaStatus = "answered" | "failed" | "interrupted";
interface QaRecord {
    id: string; book: string; generation: string; question: string; at: Position; mode: "graph" | "full";
    status: QaStatus; answer: Answer | null; error: {code: string; kind?: ErrorKind; message: string} | null;
    chaptersRead: number[]; rejections: number; usage: Usage; ms: number; model: string; startedAt: string;
}
class QaRecords {
    constructor(library: Library, bookId: string);
    save(record: QaRecord, sessionJsonl: string): Promise<{saved: true} | {saved: false; reason: "book_not_found" | "unsupported_format"}>;
    list(generation: string): Promise<QaRecord[]>;          // 只列这一代，startedAt 降序
    get(id: string, generation: string): Promise<QaRecord>; // 不在或别的代 → qa_record_not_found
    remove(id: string, generation: string): Promise<void>;  // 经 writableBook；记录与日志一起删
}
```

- 记录 id：`<UTC 时间戳>-<6 位随机>`，只允许 `[0-9a-z-]`；`get`、`remove` 先校验 id 再拼路径，防止路径穿越。
- `StoryErrorCode` 加 `qa_record_not_found`（F5，HTTP 404，供以后的服务用）。

### `packages/nb-harness/src/harness.ts`：遮盖 provider 错误里的密钥

审查实测：本机端点回 401 并在正文里回显密钥时，密钥进了 `TurnResult.error.message`、`agent_message` 与 `run_end`，违反 harness 输出 18。改法：harness 包住 `getApiKey` 时记下这次请求用的密钥；助手消息带 `errorMessage` 时，写进日志与构造 `RunError` 之前把其中出现的密钥替换成 `[REDACTED]`（只替换精确出现，长度不足 8 的密钥不替换，免得误伤普通文字）。测试加在 nb-harness `tests/provider.test.ts`（真实 OMP provider + 本机端点），对应 harness 验收 7 的新增半句。

### `packages/nb-story/src/qa/`：问答引擎（新目录）

不在 `core/`：它依赖 nb-harness（OMP，只跑在 Bun 上）。`core/` 不依赖它。

- **`config.ts`**：`loadQaConfig(path?)` 用 TypeBox 校验 `QaConfig`；文件不在、缺必填字段、类型不对、`maxChapters` 不是 1 到 20 的整数、`fullReadMaxChars` 不是正整数，都抛 `QaError("qa_unconfigured")`，写明是哪个字段。`toModel(config)` 调 `defineModel({provider: "nbstory", api: "openai-completions", baseUrl, id, apiKeyEnv, contextWindow, maxTokens, price, reasoning: thinking !== undefined})`；`thinking` 交给 `createHarness` 的 `thinkingLevel`，不写时请求里不带思考参数（审查实测：用服务端默认档）。默认路径按 `XDG_CONFIG_HOME`，写法照 `defaultLibraryRoot`。
- **`read-ledger.ts`**：一问的读原文账本，段为单位。
  - `plan(range, at, maxChapters)`：把请求范围裁到 P 以前，算出涉及的章与其中的新章；范围整个在 P 之后、或新章会让总数超过上限时返回拒绝原因。
  - `record(paragraphs)`：只记 `source.read` 实际返回的段；`covers(ref)` 把范围出处展开到真实章段（跨章时按各章段数）逐段查；`chapters()` 给读过的章。全读时以“全部读过、不设上限”构造。
  - 账本只被 `read` 改，`read` 声明为 `concurrency: "exclusive"`（nb-harness 透传给 OMP，同一条消息里的几次 `read` 依次执行），`plan` 与 `record` 之间没有别的 `read` 插进来；其余查询工具保持并行。
- **`tools.ts`**：`registerStoryTools(registry, sessions)`，经 `registerPlugin` 一次登记全部工具（提供方 `nb-story`）。
  - 查询工具只复用命令表（`src/cli/commands.ts` 的 `COMMANDS`）的命令名、摘要与方法；参数 schema 取 `STORY_METHODS[method].input` 去掉 `book`、`at`（TypeBox `Omit`），即查询方法的原生参数，不是命令行的位置参数。工具说明在摘要后补参数写法与一个 JSON 例子（`read` 的 `from`/`to`、`para` 的 `chapter`/`paragraph`、`between` 的 `entity`/`other`、`kinds` 是数组、`perspective` 写对象 id 或名字、续页传上一页给的 `cursor`），例子写在命令表旁的一张工具说明表里。
  - `execute` 按 `ctx.sessionId` 取一问的状态 `{book: BookSession, at, ledger}`，调 `book.call(method, {...params, at})`，结果用 `formatResult(method, value, {cursor: "param"})` 排成文字：`format.ts` 的续页提示按这个选项写成 `cursor` 参数或 `--cursor`，其余排版与命令行相同。查询失败返回 `isError` 结果（码、说明、候选）。
  - `read`：`ledger.plan` 拒绝时返回工具错误（写明上限与已读的章），不调查询；通过后调 `source.read`（范围已裁到 P），只把返回的段记进账本。
  - `answer`：`finish: true`；`execute` 做 qa 输出 8 的校验：先收集出处（三处 refs，加上各段文字里匹配 `\d+\.\d+(—\d+\.\d+)?` 的内容），逐个查写法、范围、不晚于 P、`ledger.covers`；再查“知道/怀疑”行有出处、非“无法确定”时有依据。全部问题拼成一条工具错误（`isError`，nb-harness 因此不收尾）；通过时返回“已交卷”。被退回的次数记进一问的状态。
  - `releaseSession(sessionId)` 删除这一问的状态。
- **`rules.ts`**：作答规则文字。把 w00005 t20 `system.ts` 的 `ANSWER_RULES_V4` 套上 `ANSWER_RULES_V5` 的替换后的定稿抄成一个常量（不再依赖评测代码），后接三条新增（qa 输出 9）与“正文里引用写成章.段，所有出处都要是读过的段落”。去掉评测里“工作目录”“文件”的说法，改成工具名。规则文字改动时 Profile 的 `version` 加一（会话快照因此能区分）。
- **`story-qa.profile.tsx`**：`defineProfile`，manifest `{key: "story-qa", version: "1"}`；`initialSchema` 为 `{title, at: string, mode, maxChapters: number | null}`；`tools` 列出全部 `story.*` 查询工具与 `story.answer`（都是必需的）；`context` 渲染系统提示词（身份、阅读位置、做法说明、工具用法、规则）与 `HistorySet`。全读的原文不进 `initial`（否则快照里存一整份原文），放在第一条用户消息里。
- **`engine.ts`**：

  ```ts
  function askQuestion(input: {
      api: StoryApi; book?: string; at?: PositionInput; mode: "graph" | "full"; question: string;
      config: QaConfig; signal?: AbortSignal; onProgress?: (event: QaProgress) => void;
      streamFn?: StreamFn; // 透传给 createHarness（它的公开选项），测试用脚本化模型
  }): Promise<QaOutcome>;
  ```

  顺序：读配置得模型 → `api.openBook` 固定一代 → 用 `book.info` 落定 P（查询类失败在这里报出）→ 全读时读出 P 以前原文、超上限报 `full_read_unavailable` → 建记录 id 与内存会话日志（`createMemorySessionLog`）→ 建登记表、登记工具、`createHarness` → `turn(问题)`。之后按停止原因分派：`finished` 交卷；`stop`、`length` 没交卷时发固定提醒，至多两次，用完报 `no_answer`；`error` 报 `model_failed`（带 `kind`）；`aborted` 记中断。`finally` 关闭 harness，把日志条目排成 JSONL，经 `QaRecords.save` 与记录一起写下。
  - 进度：订阅 harness 事件，工具开始时按工具名与参数给一条人话（“查人物卡：苏天晴”“读 37.1—37.96”），`answer` 的错误结果给“作答被退回”与原因。
  - 用量：各次 `turn` 的 `usage` 逐项相加，费用任一次为 `null` 则为 `null`，`complete` 取与。
  - `save` 不成功（书删了、换了代、格式不认识）不改变返回的答案，结果带 `recordSaved: false` 与原因。
- **`format.ts`**：答案给人读的格式（`ask` 与 `qa <id>` 共用），出处一律“章.段”。另给 `answerText(answer)`：结论、结论类型、表或分点、展开说明与覆盖说明连成的正文，回归送判时用它（不含用量、记录 id 这类运行信息）。

### `packages/nb-story/src/cli/`：`ask` 与 `qa`

- `commands.ts`：命令表加 `ask`（位置参数问题；选项 `mode`、`config`、`book`、`at`）与 `qa`（可选位置参数 id，或 `rm <id>`），`method: null`，像 `serve` 一样在 `main.ts` 单独分派。`qa` 的可选位置参数要放宽 `decodeArguments` 的个数检查（加 `optional` 标记）。
- `main.ts`：`ask` 才动态导入 `src/qa/`（同 `serve` 只在需要时加载服务端代码），其余命令不加载 OMP。`process.on("SIGINT")` 中止 `AbortController`，等记录写完后以 130 退出；`QaError` 与 `model_failed` 退出码 4；`recordSaved: false` 时在标准错误说明原因。
- 用法文字加两条命令。

### 包与边界

- `packages/nb-story/package.json` 加 `@notnotype/nb-harness`、`@notnotype/nb-profile`、`@notnotype/nb-session` 依赖；`.profile.tsx` 文件头 `@jsxImportSource @notnotype/nb-profile`（同 nb-profile 的 fixture）。
- `packages/nb-story/AGENTS.md` 的“边界”与 [`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md) 的剧情图谱一行：加上依赖 nb-harness、nb-profile、nb-session，只在 `src/qa/` 里用。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/story/qa.md` | 新建；按设计审查修订 |
| `docs/specs/story/queries.md` | 非目标指向 qa；输出 15 拆词与排序；问答记录写在 `qa/` |
| `docs/specs/story/cli-skill.md` | 非目标、命令表、退出码、边界 |
| `docs/specs/agent/harness.md` | 输出 18 与验收 7：错误正文回显的密钥要遮盖 |
| `docs/specs/README.md` | 待实现表加一行 |
| `packages/nb-story/AGENTS.md`、`docs/modules/monorepo-boundaries.md` | 依赖边界（S4） |

Skill 不改（决定：Skill 不变）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S1 | `search` 拆词与排序 | `bun test src/core/queries/search.test.ts` |
| S2 | `openBook`、`Library.bookDir`/`writableBook`、`qa-records.ts`；nb-harness 遮盖密钥 | `bun test src/core`；`bun run --cwd packages/nb-harness test` |
| S3 | `src/qa/`：配置、账本、工具、规则、Profile、引擎、格式 + 引擎测试 | `bun test src/qa`；`bun run typecheck` |
| S4 | 命令行 `ask`、`qa` + 进程测试；包依赖与边界文档 | `bun run test`；`bun run typecheck` |
| S5 | 回归脚本、真实模型 Smoke 与回归，报告进 Task 证据 | 见“验证” |

每片一次提交；S1 到 S4 完成后做实现审查（omp），再跑 S5。

## 验收映射

引擎测试（`src/qa/engine.test.ts`）用真实 harness、真实书库与样例书，模型换成 nb-harness 的 `scriptedModel`；命令行测试（`src/cli/ask.test.ts`）跑真实 `nbstory` 进程，模型请求发往本机 OpenAI 兼容端点（写法照 nb-harness `tests/provider.test.ts`）。断言的是模型拿到的工具结果里的已知事实（例如第 38 章某段原文、苏天晴的某个称呼），不从被测代码生成期望。

| Spec 条目 | 覆盖 |
|---|---|
| queries 输出 15 | `search.test.ts`：单词、多词排序、标点拆词、第二页 |
| qa 输出 1、2、3 | `engine.test.ts`：模型调 `card`、`between`、`read`（跨章）、`para`、带数组筛选与角色视角的查询，拿到的文字含已知事实；带 `at` 的参数被拒；按结果里的 `cursor` 取第二页拿到新条目 |
| qa 输出 4、验收 1 | `engine.test.ts`「防剧透」 |
| qa 输出 5、验收 2 | `engine.test.ts`「章数上限」：顺序、同一条消息并批两个新章、跨章整次拒绝 |
| qa 输出 6、验收 5 | `engine.test.ts`「全读」：上限过小时脚本化模型一次都没被请求 |
| qa 输出 7、8、验收 3 | `engine.test.ts`「退回后交卷」：三处问题一次列出、正文出处、分两次读的并集与留洞；另逐项覆盖五条校验 |
| qa 输出 9 | 不写措辞测试；规则文字在设计与实现审查里逐条看，效果由 S5 回归检验 |
| qa 输出 10、验收 4 | `engine.test.ts`「提醒」：含 `length`；`error` 不提醒 |
| qa 输出 11 | `engine.test.ts`：两次 `turn` 的用量相加，单价缺省时费用为空 |
| qa 输出 12、14 | `ask.test.ts`：标准输出与标准错误分开、`--json` 形状、退出码 4 |
| qa 输出 13、验收 6 | `ask.test.ts`「取消」：端点挂起请求时发 SIGINT |
| qa 输出 15、16、验收 7 | `qa-records.test.ts`（保存、列出、按代过滤、删除、id 校验、格式不认识时只读）；`engine.test.ts`「运行中删除」三种时序（脚本化模型在一步里等删除、重新导入、另一问写记录）；`ask.test.ts` 跑 `qa` 与 `qa rm` |
| qa 输出 17、验收 8 | `ask.test.ts`「密钥」：成功请求与 401 回显两种；nb-harness `provider.test.ts` 的遮盖 |
| qa F1 到 F5 | F1 `config.test.ts`（含 `maxChapters` 越界）；F2 `ask.test.ts`（401，以及不设密钥环境变量）；F3、F4 `engine.test.ts`；F5 `qa-records.test.ts` |
| qa 验收 9、Smoke | S5 |

## 验证

- S1 到 S4：`bun run --cwd packages/nb-story typecheck`、`bun run --cwd packages/nb-story test`、`bun run --cwd packages/nb-harness test`；`bun run docs:check`。
- S5 Smoke：本机配置指向 luna 渠道（`baseUrl` 取 `NBOOK_LLM_BASE_URL`，`id` 为 `gpt-6-luna`，`apiKeyEnv: NBOOK_LLM_API_KEY`，`maxTokens` 16000，`thinking` 不写，与 w00005 t34 作答一致），在样例书上 `nbstory ask` 一问，再 `nbstory qa` 列出与显示。
- S5 回归：Task 目录下新写 `scripts/qa-eval.ts`（不沿用 t03 的 `skill-eval-check.ts`：它固定 16 题三遍、缺答时仍以 0 退出）。
  - **输入清单**（写进脚本头并在报告里列出）：题集 t34 `questions-ch21-100-fixed.json`（56 题）与 `questions-knowledge16.json`；原文 t23 `evidences/source-ch001-100.json`；判分器 t22 `scripts/judge-v2.ts`（判分模型参数沿用它的 xhigh、16000 输出上限）；样例书 `packages/nb-story/tests/fixtures/sample-100ch.json.gz`；Profile 版本、作答模型与请求参数。
  - **三批**：图当目录 56 题 × 3（168 份，门槛错 33 份以内）、图当目录 16 题 × 3（48 份，门槛 11 份以内）、全读 16 题 × 1（16 份，只记录）。每批声明题 id、遍数与应有份数。
  - **作答**：每份 `nbstory ask --json --at <requiredPrefix>`，并发 4，已有结果且输入清单相同的跳过（可续跑）。
  - **送判**：t22 输入的 `answers[].answer` 用 `answerText`，`evidence` 为三处 refs 的并集，`conclusionType` 照填；用量、用时、记录 id 只留在外层。
  - **判定**：整数计数；任何一份缺答、缺判、没有出处、提到阅读位置之后的内容，或图当目录两批超门槛，脚本非零退出；全读批只要求 16 份完整。报告列每题结果、读过的章数、被退回次数、撞章数上限的份数、用量与费用。
  - 答案与判分进 `evidences/qa-eval/`，会话日志留本地 `.local/agent/works/w00024-nb-story/tasks/t05-qa/`。
- 未验证的边界：不同模型的答对率（门槛只对 gpt-6-luna 成立）；Windows（问答本身不依赖平台，但没测）。

## 不做与风险

- 不做网页问答页、服务端的并发上限与排队（后续 Task）。命令行几个 `ask` 进程并发的正确性本次做到（各写各的记录，见 qa-records）。
- **风险：回归不达标。** 工具从 shell 换成查询接口、一个 Agent 从头答到尾、出处必须读过，都与 t34 的两步法不同，比的是端到端结果，不能把差异单独归给某一项。不达标时先按二审归因（找材料还是作答），再与开发者讨论（决定 13：再议退回两步）。
- **风险：出处必须读过会让 Agent 多读、更容易撞 20 章上限。** 撞上限后只能交只用已读出处的答案或“无法确定”，不突破上限。S5 记录被退回次数与撞上限的份数，比例高时报告开发者。
- **风险：回归耗时。** 232 份多轮作答走 luna 渠道，按 t03 Skill 评测的速度约数小时；脚本可续跑。
