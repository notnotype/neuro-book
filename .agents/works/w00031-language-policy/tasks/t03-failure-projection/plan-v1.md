# t03 实施计划：失败投影与切片设计

## Context

ADR 0034 决策 1、2 定了方向：开发诊断用英文；界面按“拥有者命名空间 + 码”取失败文案；各错误域保留自己的合同。t02 的通道矩阵（[`../t02-error-audit/artifacts/channel-matrix.md`](../t02-error-audit/artifacts/channel-matrix.md)）列出 17 条必须先定的问题（第 6.1 节 M1 到 M17）、4 条迁移时注意（6.2 节 B1 到 B4）和 8 项未追到（9.5 节）。本 Task 把它们定成一份提案，再给 t04 列出切片。

开发者已确认的决定：Work README 第 1、2、5 条（来源写在各条里）。

产出与停点：提案 `docs/proposals/failure-projection.md`（`status: reviewing`），t04 的切片清单写进 t04 README。按 [`docs/proposals/README.md`](../../../../../docs/proposals/README.md) 的生效规则，提案要开发者接受后才能当实施依据，所以本 Task 交付后停下等开发者，t04 不接着开工。

依赖：w00028 的目录机制还没设计。本提案只定“码与参数从哪来、在哪里变成文字”，文字表在目录落地前沿用各拥有者现有的 `LocalizedText` 表，目录落地时由 w00028 t03 一并搬进目录。

工作方式：自主推进；只改文档，在主工作区 `master` 直接改并按路径提交。

## 技术选型

无。

## 关键设计（提案的方案部分）

### 1. 总则

- **投影值**：跨到界面的失败，在所属错误域现有的合同形状里带 `code` 与可选的 `params`（结构化、有上限、不含凭据与大正文），不新增全局错误对象。
- **消息键**：`<拥有者>:errors.<code>`。拥有者是定义这个码的插件 id（如 `nbook.files`）或包名（如 `nb-story`、`nbdev`）。
- **渲染**：界面按拥有者的文字表取文案并代入 `params`；表用 `Record<码, 文字>` 写成穷举，漏码过不了类型检查。
- **未知码**：显示通用说明加码（例如“操作没有完成（`io-error`）”），诊断原文放在可展开的“详情”里。
- **字符串槽**：各合同里现有的 `reason`、`message`、`detail` 改为英文诊断，只进诊断与“详情”，不当主文案。
- **语义不合并**：失败、取消、中性拒绝、结果未知、保护态在投影里分开（B3），文案不承诺未写入或可安全重试。

### 2. 按问题定

| 问题 | 方案 |
|---|---|
| M1、M4 命令失败 | 命令的失败码集合不变；`CommandFailure` 加可选 `origin: {owner, code, params}`，放底层领域的失败（例如 files 的 `unknown-outcome`）；通知先按 `origin` 取拥有者文案，没有时按命令失败码取命令插件的文案；`reason` 改英文诊断。编辑器 `ActionResult` 加 `code`，`fromAction` 按码填 `origin`，“结果未知”不再折成 `unavailable` 的一句话。保留 `NOTIFIED` 白名单与 `stale-target` 不通知 |
| M2 窗口失败页与握手 | 失败页只按 `WindowState` 的状态码取固定文案；握手 `reject` 保留现有阶段码，`message` 改英文诊断进详情。失败页在显示语言加载前出现，用什么语言见待定项 1 |
| M3、M14 `detail` 当展示文字 | 所有域的 `detail` 定为英文诊断；各域码表补齐为穷举（状态栏存储码表补到 14 个）；对不认识的码不再拼 `码：detail` |
| M5、M11 Agent 与问答 | 领域工具的失败和中性拒绝（`chapter_limit`，仍是 `isError: false`）都在 `details` 给 `{code, params}`；界面优先读 `details.code`；SSE 可以截断正文但保留 `details.code`；问答记录回放按 `code`/`kind` 取文案，`message` 只作详情；旧记录与旧日志没有码时，按 `kind` 取通用文案，旧的中文前缀判断只留给旧日志 |
| M6 插件与入口失败 | 插件问题与入口失败的摘要保留 `PluginCodeError` 的 `code` 与安全参数（插件 id、入口 id），不透传任意异常字段；四份 `entryReason` 合成一个放在拥有 `EntryState` 的模块 |
| M7 兜底 catch | 新增一个把未知异常描述成 `{code: "unexpected", detail}` 的工具，界面显示通用文案，原错经 `Error.cause` 进诊断 |
| M8 nbdev | 共用校验改为返回 `{code, params}`；CLI 拼英文，面板拼中文；HTTP `errors[]` 保留 `code`，`message` 改英文并加 `params`；面板按 `details.writtenPaths` 判断，不按文字 |
| M9 nb-story 网页 | `StoryCallError` 保留 `code` 与 `candidates`，页面按码取表；网页用什么语言见待定项 2 |
| M10 共享包 | 以 nb-form 的 `FormIssue {path, code, params}` 加包内文字表为基线；nb-markdown、nb-ui 的结构化失败由宿主按码取文案 |
| M12 版本边界 | 闭合 schema 的线协议帧加字段要升 `WIRE_PROTOCOL_VERSION`（旧窗口按现有规则显示“不兼容，请刷新”）；业务合同的 `detail` schema 由各合同拥有者改；无版本的项目 IPC 信封随同一进程版本发布，不做跨版本兼容；HTTP 四种外壳各自保留 |
| M13 旧数据 | 不批量改写会话、问答记录、Task 证据；读旧数据时没有码就按类别取通用文案、原文进详情；旧会话能否续跑只受工具声明影响，本提案不改工具声明 |
| M15、M16、M17 | 分区缺口已在 t02 补齐；示例插件的失败写法随 SDK 文档在同一片里改；测试改成断言码与结构，OMP 原生编辑文本的断言不动 |
| B1、B2 | 进程内包装点保留标准 `Error.cause`；CLI 插件日志并入诊断边界的脱敏与上限，`Error` 的 `code` 记进诊断数据 |

### 3. 未追到的 8 项

诊断查询的读取方、通用 HTTP 错误外壳的统一读取方两项关系到回退：提案定为“没有已知读取方的外壳，界面一律按未知码处理”，t04 对应切片再确认读取方。其余 6 项写进 t04 对应切片的待查。

### 4. 提案结构

按 `docs/proposals/README.md` 的最小结构：问题、目标与非目标、当前行为与证据（引 t02 矩阵）、方案（上面两节，加备选：全局错误对象、服务端按请求语言出文案，各写否决理由）、影响（数据、接口、线协议版本、迁移与回滚）、对 Spec 的预期改动（逐份列出，t04 每片先改 Spec 再改代码）、待定项、决策记录（空，等开发者）。

### 5. t04 的切片清单

写进 t04 README，不进提案。按错误域切：命令与编辑器（M1、M4）；窗口与握手（M2，含线协议版本）；文件、设置、存储、项目的码表（M3、M14）；插件平台（M6）；兜底工具（M7）；Agent 与问答（M5、M11）；nbdev（M8）；nb-story 网页（M9）；共享包（M10）；诊断边界（B1、B2）；示例与测试随各片。每片写 Spec、消费者、旧数据读取与验收（直接消费者、真实子进程、会话与问答读回、CLI JSON）。

## Spec 与文档改动

- 新建 `docs/proposals/failure-projection.md`，登记进 `docs/proposals/README.md` 的活跃提案。
- 改 t04 README 的范围与切片。
- 本 Task 不改 Spec（等提案接受，随 t04 各片改）。

## 切片

1. 提案正文，`docs:check`，提交。
2. t04 README 的切片清单，提交。

## 验收映射

无 Spec 条目，行为合同未变。完成判据：M1 到 M17、B1 到 B4、9.5 节的 8 项都在提案或 t04 切片里有去处；待定项每项给推荐选项。

## 验证

`bun run docs:check`、`bun run governance:check`。

## 不做与风险

- 不改 Spec 与代码；不设计目录机制（w00028）。
- 风险：`origin` 这类新增字段让命令合同变复杂。对策：只在命令失败需要带出底层领域失败时才填，没有时行为不变。
- 风险：提案定得太细，侵占 t04 的实施细节。对策：提案只写合同层的决定，字段的具体 schema 留给各片的 Spec。

## 待定项（交开发者）

1. 窗口失败页在显示语言加载之前用什么语言。推荐：按浏览器语言在支持的语言里选，选不到时用 zh-CN。
2. nb-story 网页的语言。推荐：跟随浏览器语言，用与应用相同的文字表写法，默认 zh-CN。
3. 接受提案；接受后 t04 按切片开工。
