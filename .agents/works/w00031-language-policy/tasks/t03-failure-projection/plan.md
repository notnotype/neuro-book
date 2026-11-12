# t03 实施计划（第二版）：失败投影

2026-11-10 修订：omp 设计审查（`evidences/plan-review-v2-omp.txt`，10 条）之后，开发者同意把编辑器一域拆出去，本 Task 只做共用件与命令。

第一版（[plan-v1.md](plan-v1.md)）写于 w00028 的目录机制之前，三份审查（`evidences/plan-review-*.txt`，有效 34 条）的共同结论是它先于目录定了键与文字表、缺共用件。之后 w00028 t03 交付了消息目录，t04 交付了通知的“详情”载体，第一版的大半前提已经变了，所以重写。

## Context

**要解决的问题**：用户看到的失败说明里还混着开发诊断原文、裸的错误码和“码：原文”拼接；服务端、第三方库的原文当主文案显示，语言取决于写错误的人（[ADR 0034](../../../../../docs/adr/0034-language-policy.md) 决策 1、2）。

**依据**：

- ADR 0034 决策 1、2、4；
- 已接受的提案[《界面文字的消息目录》](../../../../../docs/proposals/i18n-message-catalogs.md)第 7 节“失败文案”：消息键 `errors.<码>` 放在拥有者的命名空间、不新增全局错误对象、闭合域穷举、未知码的中性兜底、用户要照着改的校验原因作主文案；
- [`workbench/notifications.md`](../../../../../docs/specs/workbench/notifications.md) 输出 3、5、10–12：`detail` 是已脱敏、有界的字符串，带详情的通知不自动消失；
- Work README 第 7–10 条（推进顺序、失败页语言、nb-story 网页单语、nbdev 面板显示原文）；
- 待确认清单 2026-10-29 已追认的一条：`CommandResult.reason` 放宽为 `Text`，远程合同不升版。

**现状重核（2026-11-10，对照 t02 通道矩阵）**：

| 共用件（Work README 第 7 条） | 现状 |
|---|---|
| 消息键写法与命名空间 | 已定（提案第 7 节），已有各插件目录 |
| 闭合域码表的穷举检查 | 目录检查已支持“给了码表时 `errors.<码>` 恰好覆盖”（[`ui/i18n.md`](../../../../../docs/specs/ui/i18n.md) 的“目录检查”） |
| 失败值类型与参数上限 | 全局类型被提案否决；参数上限与过滤已有（nb-ui `sanitizeParams`，500 字符） |
| 未知码的中性兜底 | **没有**：宿主目录没有这条；各插件各写一份（照原样显示码、拼 `码：detail`、`码（cause）`） |
| “详情”载体 | 已交付（w00028 t04） |

另外，远程路由的 10 个码按提案归宿主文案，现在散在 projects、plugins 两个插件的目录里，只覆盖 6 个。

各域的问题（编号沿用 t02 矩阵）：

- 已解决或改由别处解决：M15（t02 补查）、M10 的目录部分（w00028 t03）、失败页语言的来源（`web/host/locale-hint.ts`）、命令 `reason` 的本地化（已是 `Text`）。
- 仍在：
  - M1 的一半：`registry.ts` 把 `asError(error).message` 当 `execution-error` 的原因，另有 11 处中文字面量；通知不带详情；
  - M2：失败页把 `reason` 整句放在主文案；
  - M3：约八处拼接原文；
  - M4：编辑器把 `result.code` 当原因，`fromAction` 一律折成 `unavailable`；
  - M5、M11：问答与工具失败没有码，按中文前缀判断；
  - M6：`entryReason` 三份；
  - M8：nbdev 校验返回字符串，`writes.ts` 按文字判断；
  - M9：nb-story 网页显示服务端 `message`；
  - M14：状态栏存储码表 7/14，`problems()` 无调用方；
  - M16：示例插件抛中文；
  - 两个命令行的 `--json` 里 `message` 是中文。

**交付形态**：

- **不新建提案**。方向已由 ADR 0034 与已接受提案第 7 节批准。本计划经开发者确认后，作为各域 Spec 里“（planned）”条目的批准依据（[`docs/specs/README.md`](../../../../../docs/specs/README.md) 第 33 行）。
- **本 Task 实施共用件和命令一域**。
- **编辑器、文件客户端、资源管理器合成一个 Task（t06）**，排在 w00028 t05 之前，两者共用同一份“编辑器保存与关闭的失败码”合同（开发者 2026-11-10 定，见“后续各域”）。
- **其余各域各建一个 Task**，开工时各写短计划。

**工作方式**：代码在 worktree `.worktree/w00031-t03`（分支 `feat/w00031-t03-failure-projection`）；Spec 与 Task 记录在主工作区 master；验证后直接合入。

## 总则（各域共用的裁决）

各域 Task 照这几条写，不再各自重议。

1. **三类读者**（提案第 7 节，Work 第 10 条）：
   - 一般失败：主文案按“拥有者 + 码”取；
   - 用户或插件作者要照着改的校验原因：主文案，带位置与参数；
   - nbdev 面板：开发者工具，显示原文。
2. **原文只进“详情”**：异常 message、服务端 `detail`、第三方库的错一律进 `detail`，不进主文案，也不拼进主文案。
   - **谁来产出**：持有原错的进程，用 nb-runtime 的 `describeDiagnosticError`（脱敏、4000 字符上限，浏览器可用）产出字符串。
   - **跨进程时**：由发送方脱敏后再发。
   - **载体合同**：通知的 `detail` 保持字符串，不改形状。
3. **未知码**：宿主目录的中性文案，只陈述收到了不认识的结果并附码（“未能识别的结果（`码`）”），不说“失败”“未保存”。拼接写法（`码：detail`、`码（cause）`）一律删掉，原文进详情。
4. **闭合域用表，不拼键；开放域照提案第 7 节**：
   - **闭合域**（码表是唯一来源，例如命令的九个码、远程路由的十个码）：拥有者用 `as const satisfies Record<码, 键>` 的表把码映射到自己目录里的键，表里查不到就是未知码；表登记给目录检查做穷举。不从码拼键，所以用不到“拼键之前先校验码”。
   - **开放域**（码由别人新增，例如插件声明的业务码、`edit-<种类>`、nb-form 的 `FormIssue.code`）：照提案第 7 节，拥有者已知、码合格、目录里有 `errors.<码>` 才显示，否则走未知码兜底。查目录是否有这一条要一个存在性查询；本 Task 的范围里没有开放域，查询接口由第一个用到它的 Task（t08）设计，不给翻译端口预先加接口。
   - **目录整份没取到**（窗口取目录失败、只记问题继续启动）：闭合域的键照 `ui/i18n.md` 的“键不存在”处理，不另做兜底；这是目录机制的失败，不是失败投影的。
5. **未知异常按各域已有的码兜底**：命令为 `execution-error`，远程为 `provider-error`，插件入口为 `entry-failed`。不新增全局的 `unexpected` 码（第一版审查 omp 第 4 条）。
6. **语义不合并**（矩阵 B3）：失败、取消、中性拒绝、结果未知、保护态各自取文案。“结果未知”的文案要用户先核对，不承诺未写入，也不承诺可安全重试。
7. **给模型的文字不在“改英文”之列**（ADR 决策 4）：工具结果的 `content` 照旧，领域工具失败时在 `details.code` 给码（[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) “共同”第 2 条已有此约定）；界面按 `details.code` 取文案。
8. **版本**：
   - 改了闭合远程合同的结果形状，就升那份合同的 `version`；
   - 只有帧的形状或含义变了才升 `WIRE_PROTOCOL_VERSION`，现在列出的各域都不改帧；
   - 握手只把 `message` 改成英文诊断，不升版。
9. **旧数据**：
   - 各拥有者的读取器把旧值归一成现有合同；
   - 没有码的旧记录按类别取通用文案，原文进详情；
   - 不按旧文案猜码。唯一例外是 nb-story 已有的“没有读：”前缀判断：它只对没有 `details.code` 的旧日志保留，集中成一处常量，不再新增同类判断。
   - 不批量改写会话、问答记录与 Task 证据。
   - 各域 Task 的计划要逐个列出它拥有的持久载体，每个写明“保持原样”“只改展示”或“要兼容读取”，并给磁盘读回的验收；只为实际存在的旧形状写兼容。已知的载体见“后续各域”的表。
10. **开发诊断改英文与失败投影解绑**（Work 第 7 条），归 t04。各域 Task 只改它碰到的失败出口。
11. **测试**断言码、结构与文字引用（键加参数），不断言中文文案（矩阵 M17）。
12. **与 ADR 0034 后果表对齐**：后果表写“`reason` 不当主文案，按码投影”。命令的 `reason` 已追认为拥有者目录里的文字值，这本身就是按拥有者取文案；要禁止的是把诊断原文放进 `reason`。这一点写进 `workbench/commands.md`，ADR 正文不改。

## 关键设计（本 Task 实施的部分）

### 共用件：`packages/neuro-book/src/web/locales/`、`src/shared/failure-text.ts`

- **宿主目录**：
  - `errors.<码>`：远程路由的 10 个码（`nb-runtime/src/remote/protocol.ts` 的码表），宿主是它们的拥有者。“结果未知”（`unknown-outcome`）的文案要用户先核对；`cancelled` 不说失败。
  - `unknownResult`（参数 `code`）：未知码兜底。放在 `errors` 之外，这样宿主目录的 `errors.*` 恰好是路由码，现有目录检查（`closedCodes` 只查 `errors.*`）不用改。
- **新文件** `src/shared/failure-text.ts`：
  - `codeText(text, table, code, params?): Text`：`text` 是拥有者绑定了命名空间的构造函数（例如 `projectsText`，`pluginText` 的返回值），表值是该命名空间里的键；查到返回 `text(键, params)`，查不到返回宿主的 `unknownResult`。命名空间由构造函数带，不靠表或全局状态推断。
  - `REMOTE_ERROR_KEYS`：路由码的闭合表；`remoteFailureText(code)`。

  它替换 `projects/web/failure-text.ts` 里的 `lookup` 与 `REMOTE_FAILURE_KEYS`，以及 plugins 插件里的同类表；两个插件目录里的 `remoteErrors.*` 删掉。
- **登记**：宿主目录登记 `closedCodes` 为路由码表。
- **现有“未知码照原样显示”的调用点**，本 Task 只改 projects 与 plugins 两处；其余随各域 Task 改。

### 命令：`packages/neuro-book/src/plugins/commands/`

- **`CommandFailure` 加 `detail?: string`**（开发诊断原文，已脱敏）。失败类型只定义一次，`CommandResult` 的失败分支引用它。
  - 远程合同 `nbook.commands/remote` 不变，不传 `detail`，不升版。它的提供方是窗口、调用方是服务端，界面通知不经过它。
- **`registry.ts`**：
  - `execution-error` 的原因改为命令插件目录里的“命令执行出错”，异常经 `describeDiagnosticError` 进 `detail`；
  - “没有返回结构化结果”和其余 11 处中文字面量改成目录键；
  - 处理函数主动返回的失败（`settled` 分支）保留它给的 `detail`：是字符串才收，经 `redactText` 截到上限；现在这个分支只取 `code` 与 `reason`，`detail` 会被丢掉。

  命令插件现在没有目录，要新增 `commands/locales/`，经 `src/web/plugins.ts` 的 `builtinPluginCatalogs` 登记（w00028 t03 的做法）。
- **`workbench/web/commands/failure-notice.ts`** 把 `failure.detail` 交给通知；按通知输出 3，带详情的通知不自动消失。
- **`keymap.ts`** 记诊断时写码与 `detail`，不再把原因拼进 `Error`。

## 后续各域（各建一个 Task）

编号按 Work 现有的最大编号续排；顺序是推荐的推进顺序。“持久载体”一列是各 Task 计划里要逐个定“保持原样、只改展示、兼容读取”的对象（总则 9）。

| Task | 域（矩阵编号） | 要点 | 持久载体 | 主要 Spec |
|---|---|---|---|---|
| t06 | 编辑器、文件客户端、资源管理器（M3 的文件部分、M4） | 见下方专节；排在 w00028 t05 之前 | 无（文档状态只在内存） | `workbench/editor.md`、`workspace/resources.md`、资源管理器的 Spec |
| t07 | 窗口失败页与握手（M2） | `WindowState` 的失败带状态码与 `detail`，失败页主文案按状态取，原文放“详情”（`DetailDialog`）；握手的 `message` 改英文诊断 | 无 | `runtime/browser-host.md`、`runtime/plugin-channel.md` |
| t08 | 设置、存储、项目、插件平台（M3 其余、M6、M14 码表） | 各码表补全并用共用件兜底；存储 14 个码；三份 `entryReason` 合成一个；插件页 `entry-failed` 的原文进详情；设置 `layer-text`；插件声明的远程业务码是开放域，存在性查询在这里设计 | 设置文件（解析错误的位置与参数） | `settings/*`、`state/*`、`runtime/plugin-*` |
| t09 | Agent 与问答（M5、M11、M13，`problems()`） | nb-story 领域工具给 `details.code`；`readRefused` 按码判断，旧日志走总则 9，并区分持久日志与会丢 `details` 的临时事件；问答记录回放按 `code`/`kind` 取文案；nb-agent-ui 的工具失败文案由宿主按码提供；删除 `problems()` 或接展示位 | 会话日志、问答记录与配对日志（现行与旧的一问一条形状都要求失败带 `code`） | `agent/builtin-tools.md`、`story/qa.md`、nb-agent-ui 的包级规则 |
| t10 | nb-story 网页与两个命令行（M9） | `StoryCallError` 按码取单语中文表（Work 第 9 条）；`--json` 按 README 决定 2 改 | 抽取的 `usage.jsonl`（`error` 只有字符串）、`activity.jsonl`（分 stopped 与 failed）、`state.json`（稳定的 `stopReason`） | `story/cli-skill.md`、`story/viewer.md`、`story/ingest.md` |
| t11 | nbdev（M8） | 共用校验改返回码加参数，命令行与面板各自拼文字；`writes.ts` 改读 `writtenPaths`；面板其余错误照原文显示（Work 第 10 条） | 通知记录、`audit.jsonl`、init 记录（其中 `code: null` 是合法值，不是缺码） | dev-panel 命令行文档与包级规则 |
| t12 | SDK 示例（M16） | 按 counter 的写法加目录与码，随 SDK 文档与场景测试一起改 | 无 | `runtime/plugin-api.md` |
| t04 | 开发诊断改英文（B1、B2，M7 的剩余，nb-ui `GridResult`、nb-markdown 的中文抛错） | 与失败投影解绑；做法按 README 决定 3；旧应用按 nb-history 中文文案分支的坑见 t04 README | 诊断日志 | `runtime/diagnostics.md` |

### t06 要先定的事（来自本计划的 omp 审查第 2–5 条，已在真实链路上复现）

- **保存的码是开放字符串**：`documents/store.ts` 的保存结果除 Files 的业务码与路由码外，还有本地的保护态（`closed`、`unresolved`、`unrepresentable`、`conflict`、`ended`、`not-ready`）、重建已删文件的 `exists`，核对之后还有 `not-written`。先定“编辑器保存与关闭”的码集合（闭合联合），再分哪些是拒绝（保存之前就拦下、没有写入）、哪些是失败、哪些是结果未知；同一张表供命令结果与文档状态（w00028 t05 的常驻通知）共用。
- **关闭链路在上层就丢码**：`closeOne` 把所有保存失败折成 `"failed"`，单个关闭再折成 `"cancelled"`，批量关闭与合并移动只剩普通失败；“结果未知”（写已发生、回复丢失）在命令面板里会显示成“取消”。要让关闭结果逐层带真实的取消、失败或未知与详情，覆盖单个关闭、批量关闭、合并移动与菜单。
- **“全部保存”的混合结果**：有未知项时主文案说“部分文件的保存结果没有确认，请先核对”，失败与未知分别计数，逐个文件的详情保留各自语义；不能统一说“没有保存”。
- **文件客户端与资源管理器**：`files/web/client.ts` 拼 `码（cause）`、`explorer/web/feedback-text.ts` 对未知码拼原文、`EditorGroup.vue` 的读取失败与面包屑直接显示 `detail`，都改成按码取文案、原文进详情；打开失败原位显示、批量结果、持续的未知状态分开处理。
- **验收**：取消、确定的保存失败、“已写入但回复丢失”三种各一条真实链路的测试（Files 三实例与真实磁盘，审查的实验已证明可以写）。

**每个域 Task 都守的规则**：

- 同一份合同的生产者与全部直接消费者放在同一片里切换，不留兼容窗口（第一版审查 omp 第 8 条）；
- 改了远程结果形状的，那一片升该合同的版本。

**不做**：

- B4：未接产品的基础库不虚构迁移；
- 矩阵 9.5 节未追到的读取方：只在找到消费者的域里处理，不新增统一的 HTTP 错误读取；
- nb-story 网页的语言选择（Work 第 9 条）；
- 远程命令合同传 `detail`。

## 审查意见的去处

| 来源 | 条目与去处 |
|---|---|
| 第一版 omp | 1 B4：不做清单。2 旧数据按载体：总则 9 与后续表的“持久载体”列。3 `origin`：不引入，远程合同不变。4 全局兜底码：总则 5。5 `detail` 分类：总则 2。6 版本：总则 8。7 未追到的读取方：不做清单。8 生产者与消费者拆片：后续各域的规则。9 命令行合同：README 决定 2 |
| 第一版 Sonnet 前端 | 1 详情载体：w00028 t04 已交付。2 命令原因：`reason` 已是文字值，加 `detail`。3 失败页语言：Work 第 8 条，已实现。4 文字表搬两次：目录已落地。5 Agent 视图类型：t09。6 用户要改的校验：总则 1。7 nb-story：Work 第 9 条。8 nbdev 范围：Work 第 10 条、t11。9 共享包自带文字：w00028 t03 已做。10 中性未知码：总则 3。11 旧前缀：总则 9。12 `entryReason`：t08。13 `problems()` 与 B4：t09、不做清单。14 命令桥给模型的原因：远程合同不变，原因在窗口按当前语言翻译，总则 7。15 拼键与目录未加载：总则 4 |
| 第一版 Sonnet 拉远看 | 1 命令行与机检：t10、t04。2 给模型的文字：总则 7。3 nb-story 语言：Work 第 9 条。4 共用件：本 Task 的共用件。5 键先于 w00028：已解决。6 诊断英文单列：t04 与 README 决定 3。7 旧前缀：总则 9。8 升版：总则 8。9 Spec 归属：各域 Task 改 Spec，用“（planned）”条目，ADR 表不改。10 `problems()`：t09 |
| 第二版 omp（10 条，`evidences/plan-review-v2-omp.txt`） | 1 主动返回的失败丢 `detail`：命令一节，`settled` 分支保留。2–5 编辑器保存码、关闭链路、全部保存、文件与资源管理器：拆到 t06，写进“t06 要先定的事”。6 `codeText` 缺拥有者：改为传绑定命名空间的构造函数。7 目录检查表达不了 `remoteErrors.*`：路由码改放宿主的 `errors.*`，兜底放 `unknownResult`，检查器不用改。8 开放域与目录不在：总则 4 分闭合与开放，开放域的存在性查询由 t08 设计。9 Lab 不经过产品通知链：不补 e2e，改在 `WorkbenchCommandHost.dom.test.ts` 用真实命令表验证（见“验证”）。10 旧数据逐载体：后续表加“持久载体”列 |

## Spec 与文档改动

- [`ui/i18n.md`](../../../../../docs/specs/ui/i18n.md)：新增“失败文案”几条（未知码兜底、路由码归宿主、闭合域用表、开放域照提案第 7 节），标“（planned）”。
- [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)：
  - 结果合同加 `detail`，处理函数主动返回的 `detail` 保留；
  - `execution-error` 的原因不含诊断原文；
  - 通知带详情；
  - 总则 12 那一句。

  都标“（planned）”。
- Work README：任务表加 t06–t12，写明推进顺序（t06 在 w00028 t05 之前）；t04 README 改范围（只管诊断改英文）；w00028 t05 README 注明它依赖 w00031 t06。
- 本 Task README：当前状态与下一步。

## 切片

1. **Spec 与记录**（主工作区）：上一节各项，`bun run docs:check`，按路径提交。
2. **共用件**：宿主目录、`failure-text.ts`、projects 与 plugins 改用、宿主目录登记 `closedCodes`。验证：
   - `failure-text.test.ts`：查到、查不到、路由码；两个拥有者都有同名的 `errors.unavailable` 时各取各的，不串目录；
   - projects、plugins 受影响的测试；
   - `bun run governance:check`（目录检查核对宿主 `errors.*` 恰好是路由码）。
3. **命令**：命令目录、`registry.ts`、`failure-notice.ts`、`keymap.ts`。验证：
   - `registry.test.ts`：抛异常变成 `execution-error`，原因是目录引用，`detail` 含原文且已脱敏；处理函数主动返回的失败保留 `detail`，非字符串的 `detail` 丢掉；
   - `WorkbenchCommandHost.dom.test.ts` 补一条：真实命令表登记一条会抛错的命令，经命令面板执行，交给 `notify` 的通知带 `detail`、正文是目录引用；
   - `keymap.test.ts`。
4. **收口**：
   - `bun run test:affected`；
   - e2e 跑 `e2e/commands.e2e.ts`（命令面板与快捷键的回归）；
   - 实现审查：命令与共用件交 omp，通知部分交 Claude Sonnet；
   - 合入。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `ui/i18n.md` 新增的失败文案条目 | `failure-text.test.ts`、目录检查 |
| `workbench/commands.md` 结果合同的 `detail`、执行错误的通知 | `registry.test.ts`、`WorkbenchCommandHost.dom.test.ts` 新增的一条 |

具体编号在切片 1 写进 Spec 后回填。

## 验证

- **组件级**：命令到通知这一段由 `WorkbenchCommandHost.dom.test.ts` 用真实命令表覆盖；通知收到 `detail` 后的常驻、详情对话框、复制已由 w00028 t04 的 `notifications.dom.test.ts` 与 `lab-nb-ui.e2e.ts` 覆盖。
- **未验证的边界**：
  - 产品里没有现成的、能稳定抛错的命令，所以不补“从产品命令面板执行抛错命令”的 e2e。为此往产品命令目录塞测试命令不合适，给 e2e 外壳加测试插件的成本高于收益。
  - 服务端调用窗口命令（远程合同）拿到的原因仍是翻好的字符串，不带 `detail`；这是有意不做。

## 不做与风险

- 不做：上面“后续各域”的内容；远程命令合同传 `detail`。
- 风险：`describeDiagnosticError` 只留 `name: message`，丢掉 `cause` 链。
  - 对策：通知的详情本来就只要一行能复制的原因，完整的 `cause` 照旧由诊断记录保留（命令执行错误已按贡献方插件记入诊断）。
- 风险：命令插件新增目录后，服务端加载的 `registry.ts` 产出的文字引用要由窗口翻译。
  - 对策：命令结果的 `reason` 已经是文字值，服务端不翻译、窗口按当前语言翻译（`commands.md` 结果合同），这条路径 w00028 t03 已用过。

## 已确认

计划第二版的三项与编辑器拆出，见 README 的“第二版计划的决定”。
