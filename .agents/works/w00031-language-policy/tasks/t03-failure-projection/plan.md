# t03 实施计划（第二版）：失败投影

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
- **本 Task 实施共用件和第一个错误域（命令与编辑器）**。命令与编辑器排第一，因为 w00028 t05（编辑器、资源管理器改走通知）等着编辑器的失败码。
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
4. **码到键用表，不拼键**：
   - 每个拥有者用 `as const satisfies Record<码, 键>` 的表把码映射到自己目录里的键；表里查不到就是未知码。
   - 因为不从码拼键，提案第 7 节“拼键之前先校验码”在这条写法下用不到，翻译端口也不加 `exists`。
   - 闭合域的表登记给目录检查，做穷举。
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
10. **开发诊断改英文与失败投影解绑**（Work 第 7 条），归 t04。各域 Task 只改它碰到的失败出口。
11. **测试**断言码、结构与文字引用（键加参数），不断言中文文案（矩阵 M17）。
12. **与 ADR 0034 后果表对齐**：后果表写“`reason` 不当主文案，按码投影”。命令的 `reason` 已追认为拥有者目录里的文字值，这本身就是按拥有者取文案；要禁止的是把诊断原文放进 `reason`。这一点写进 `workbench/commands.md`，ADR 正文不改。

## 关键设计（本 Task 实施的部分）

### 共用件：`packages/neuro-book/src/web/locales/`、`src/shared/failure-text.ts`

- **宿主目录**加两组：
  - `errors.unknown`（参数 `code`）；
  - `remoteErrors.<码>`，10 个远程路由码（`nb-runtime/src/remote/protocol.ts` 的码表）。
  
  “结果未知”（`unknown-outcome`）的文案要用户先核对；`cancelled` 不说失败。
- **新文件** `src/shared/failure-text.ts`：
  - `codeText(table, code, params?): Text`：查到返回拥有者的文字引用，查不到返回宿主的 `errors.unknown`；
  - `REMOTE_ERROR_KEYS`：路由码的闭合表；
  - `remoteFailureText(code)`。
  
  它替换 `projects/web/failure-text.ts` 里的 `lookup` 与 `REMOTE_FAILURE_KEYS`，以及 plugins 插件里的同类表；两个插件目录里的 `remoteErrors.*` 删掉。
- **登记**：路由码表作为闭合域登记给目录检查（`scripts/ci/message-catalogs.ts`）。
- **现有“未知码照原样显示”的调用点**，本 Task 只改 projects 与 plugins 两处；其余随各域 Task 改。

### 命令：`packages/neuro-book/src/plugins/commands/`

- **`CommandFailure` 加 `detail?: string`**（开发诊断原文，已脱敏）。
  - 远程合同 `nbook.commands/remote` 不变，不传 `detail`，不升版。它的提供方是窗口、调用方是服务端，界面通知不经过它。
- **`registry.ts`**：
  - `execution-error` 的原因改为命令插件目录里的“命令执行出错”，异常经 `describeDiagnosticError` 进 `detail`；
  - “没有返回结构化结果”和其余 11 处中文字面量改成目录键。
  
  命令插件现在没有目录，要新增 `commands/locales/`，经 `src/web/plugins.ts` 的 `builtinPluginCatalogs` 登记（w00028 t03 的做法）。
- **`workbench/web/commands/failure-notice.ts`** 把 `failure.detail` 交给通知；按通知输出 3，带详情的通知不自动消失。
- **`keymap.ts`** 记诊断时写码与 `detail`，不再把原因拼进 `Error`。

### 编辑器：`packages/neuro-book/src/plugins/editor/web/`

- **`ActionResult`、`BatchCloseResult`、`OpenResult` 的失败分支**加两个字段：
  - `failure: "refused" | "failed" | "unknown-outcome"`：拒绝（没有活动文档等）、做了但没成、结果未知；
  - 可选的 `detail`。
- **`commands.ts` 的 `fromAction`、`fromBatch`**：`refused` 映射到 `unavailable`，`failed` 与 `unknown-outcome` 映射到 `execution-error`。原因照用编辑器给的文字值，`detail` 透传。
- **`save`、`saveAll`、`overwrite` 的失败**：
  - 不再把 `result.code` 当原因，改用编辑器目录里按文件写入失败码取的一张闭合表（键 `saveFailure.<码>`）；
  - `unknown-outcome` 单独一句：可能已写入，先核对；
  - `saveAll` 的原因是“{{count}} 个文件没有保存”，逐个文件的“地址：码”进 `detail`。
- **`clipboardFailed`** 不再把异常 message 当参数，异常进 `detail`。
- **不动 `EditorGroup.vue` 的横幅**：那是 w00028 t05 的范围，它会改用这里的失败码。

## 后续各域（各建一个 Task）

编号按 Work 现有的最大编号续排；顺序是推荐的推进顺序。

| Task | 域（矩阵编号） | 要点 | 主要 Spec |
|---|---|---|---|
| t06 | 窗口失败页与握手（M2） | `WindowState` 的失败带状态码与 `detail`，失败页主文案按状态取，原文放“详情”（`DetailDialog`）；握手的 `message` 改英文诊断 | `runtime/browser-host.md`、`runtime/plugin-channel.md` |
| t07 | 设置、存储、项目、插件平台（M3、M6、M14 码表） | 各码表补全并用共用件兜底；存储 14 个码；三份 `entryReason` 合成一个；插件页 `entry-failed` 的原文进详情；设置 `layer-text` | `settings/*`、`state/*`、`runtime/plugin-*` |
| t08 | Agent 与问答（M5、M11、M13，`problems()`） | nb-story 领域工具给 `details.code`；`readRefused` 按码判断，旧日志走总则 9；问答记录回放按 `code`/`kind` 取文案；nb-agent-ui 的工具失败文案由宿主按码提供；删除 `problems()` 或接展示位 | `agent/builtin-tools.md`、`story/qa.md`、nb-agent-ui 的包级规则 |
| t09 | nb-story 网页与两个命令行（M9） | `StoryCallError` 按码取单语中文表（Work 第 9 条）；`nbstory`、`nbook` 的 `--json` 见待确认 2 | `story/cli-skill.md`、`story/viewer.md` |
| t10 | nbdev（M8） | 共用校验改返回码加参数，命令行与面板各自拼文字；`writes.ts` 改读 `writtenPaths`；面板其余错误照原文显示（Work 第 10 条） | dev-panel 命令行文档与包级规则 |
| t11 | SDK 示例（M16） | 按 counter 的写法加目录与码，随 SDK 文档与场景测试一起改 | `runtime/plugin-api.md` |
| t04 | 开发诊断改英文（B1、B2，M7 的剩余，nb-ui `GridResult`、nb-markdown 的中文抛错） | 与失败投影解绑；做法见待确认 3；旧应用按 nb-history 中文文案分支的坑见 t04 README | `runtime/diagnostics.md` |

**每个域 Task 都守的规则**：

- 同一份合同的生产者与全部直接消费者放在同一片里切换，不留兼容窗口（第一版审查 omp 第 8 条）；
- 改了远程结果形状的，那一片升该合同的版本。

**不做**：

- B4：未接产品的基础库不虚构迁移；
- 矩阵 9.5 节未追到的读取方：只在找到消费者的域里处理，不新增统一的 HTTP 错误读取；
- nb-story 网页的语言选择（Work 第 9 条）；
- 远程命令合同传 `detail`。

## 第一版审查意见的去处

| 来源 | 条目与去处 |
|---|---|
| omp | 1 B4：不做清单。2 旧数据按载体：总则 9，具体载体随 t08、t10。3 `origin`：不引入，远程合同不变。4 全局兜底码：总则 5。5 `detail` 分类：总则 2。6 版本：总则 8。7 未追到的读取方：不做清单。8 生产者与消费者拆片：后续各域的规则。9 命令行合同：待确认 2 |
| Sonnet 前端 | 1 详情载体：w00028 t04 已交付。2 命令原因：`reason` 已是文字值，加 `detail`。3 失败页语言：Work 第 8 条，已实现。4 文字表搬两次：目录已落地。5 Agent 视图类型：t08。6 用户要改的校验：总则 1。7 nb-story：Work 第 9 条。8 nbdev 范围：Work 第 10 条、t10。9 共享包自带文字：w00028 t03 已做。10 中性未知码：总则 3。11 旧前缀：总则 9。12 `entryReason`：t07。13 `problems()` 与 B4：t08、不做清单。14 命令桥给模型的原因：远程合同不变，原因在窗口按当前语言翻译，总则 7。15 拼键：总则 4 |
| Sonnet 拉远看 | 1 命令行与机检：t09、t04。2 给模型的文字：总则 7。3 nb-story 语言：Work 第 9 条。4 共用件：本 Task 的共用件。5 键先于 w00028：已解决。6 诊断英文单列：t04 与待确认 3。7 旧前缀：总则 9。8 升版：总则 8。9 Spec 归属：各域 Task 改 Spec，用“（planned）”条目，ADR 表不改。10 `problems()`：t08 |

## Spec 与文档改动

- [`ui/i18n.md`](../../../../../docs/specs/ui/i18n.md)：新增“失败文案”几条（未知码兜底、路由码归宿主、码到键用表），标“（planned）”。
- [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)：
  - 结果合同加 `detail`；
  - `execution-error` 的原因不含诊断原文；
  - 通知带详情；
  - 总则 12 那一句。
  
  都标“（planned）”。
- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：保存类命令的失败分为拒绝、失败、结果未知；“全部保存”的原因与详情。标“（planned）”。
- Work README：任务表加 t06–t11，写明推进顺序；t04 README 改范围（只管诊断改英文）。
- 本 Task README：当前状态与下一步。

## 切片

1. **Spec 与记录**（主工作区）：上一节各项，`bun run docs:check`，按路径提交。
2. **共用件**：宿主目录、`failure-text.ts`、projects 与 plugins 改用、目录检查登记。验证：
   - `failure-text.test.ts`（查到、查不到、路由码）；
   - projects、plugins 受影响的测试；
   - `bun run governance:check`。
3. **命令**：命令目录、`registry.ts`、`failure-notice.ts`、`keymap.ts`。验证：
   - `registry.test.ts`：异常变成 `execution-error`、原因是目录引用、`detail` 含原文且已脱敏；
   - `WorkbenchCommandHost.dom.test.ts` 或 failure-notice 的测试：通知带详情、不自动消失；
   - `keymap.test.ts`。
4. **编辑器**：结果类型、`fromAction`、保存类与剪贴板失败。验证：
   - 编辑器命令测试：保存失败为 `execution-error`，结果未知单独一句，“全部保存”的详情逐个列出；
   - `editor-commands.test.ts`。
5. **收口**：
   - `bun run test:affected`；
   - e2e：现有 e2e 没有断言命令失败通知的。在 `e2e/commands.e2e.ts` 补一条：从命令面板执行一条会抛错的命令，看通知正文是目录文案、“详情”里是原文（用哪条命令开工时找，Lab 命令场景优先）；再跑 `e2e/editor-area.e2e.ts`、`e2e/editor-autosave.e2e.ts`，确认编辑器结果类型的改动没有回归；
   - 实现审查：后端与领域部分交 omp，通知与界面部分交 Claude Sonnet；
   - 合入。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `ui/i18n.md` 新增的失败文案条目 | `failure-text.test.ts`、目录检查 |
| `workbench/commands.md` 结果合同的 `detail`、执行错误的通知 | `registry.test.ts`、failure-notice 测试、`commands.e2e.ts` 新增的一条 |
| `workbench/editor.md` 保存类失败的三种 | 编辑器命令测试 |

具体编号在切片 1 写进 Spec 后回填。

## 验证

- **真实浏览器**：用 `nbdev dev start` 起服务，在 Lab 或产品页里让一条命令抛错，从命令面板执行，看通知标题、正文是目录文案，“详情”里是原文，复制得到原文；英文界面下正文变英文、详情不变。
- **未验证的边界**：服务端调用窗口命令（远程合同）拿到的原因仍是翻好的字符串，不带 `detail`。这是有意不做，见“不做”。

## 不做与风险

- 不做：上面“后续各域”的内容；EditorGroup 横幅（w00028 t05）；远程命令合同传 `detail`。
- 风险：编辑器结果类型加 `failure` 字段，会牵动所有返回 `ActionResult` 的函数（约 50 处失败返回）。
  - 对策：这些函数大多是“没有活动文档”这类拒绝，给它们一个构造函数统一写 `refused`，只有保存、覆盖、剪贴板这几处写 `failed` 或 `unknown-outcome`。
- 风险：`describeDiagnosticError` 只留 `name: message`，丢掉 `cause` 链。
  - 对策：通知的详情本来就只要一行能复制的原因，完整的 `cause` 照旧由诊断记录保留（命令执行错误已按贡献方插件记入诊断）。

## 待确认（交开发者）

1. **交付形态与顺序**：本 Task 实施共用件与命令、编辑器；其余各域按上表建 t06–t11，按表中顺序推进，w00028 t05 排在本 Task 之后。推荐：同意。
2. **两个命令行的 `--json`**：`code` 是稳定合同；`message` 改为英文诊断，不加版本字段，因为调用方本来就该按 `code` 分支；`nbstory` 给人看的输出仍是中文。推荐：同意，t09 开工时照此改 `story/cli-skill.md`。
3. **开发诊断改英文的做法**：t04 不做一次性全量翻译（带中文的抛错约 1000 处，断言中文的测试约 370 个文件）。改成三条：
   - 新写的必须英文；
   - 碰到哪个文件就改哪个文件；
   - `governance:check` 对新增的中文诊断构造给告警。
   
   推荐：同意；需要全量时再单独排期。
