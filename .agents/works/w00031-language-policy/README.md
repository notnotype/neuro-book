---
schema: nbook.work/v1
workId: w00031-language-policy
issueId: null
status: active
updated: 2026-11-10
---

# 语言政策与错误处理

## 目标

定下界面文字、开发诊断与给模型的文字各用什么语言（ADR），并按错误域把失败说明改成按错误码本地化、开发诊断改英文。界面文字的目录机制本身在 [w00028](../w00028-i18n/README.md) 做。

## 开发者已确认的决定

都是 2026-10-27 与开发者讨论时确认的；讨论稿与三轮审查见 [t01 证据](tasks/t01-adr/evidences/)。

1. 文字按读者分三类：界面文字与给用户看的失败说明要本地化；开发诊断（异常 message、诊断事件 message、日志、堆栈）用英文，不做 i18n；第三方库的错原样保留。程序只按错误码分支，错误码、事件名、字段名是英文标识符。
2. 界面按错误码取失败说明，`error.message`、`reason` 只放进“详情”。各错误域保留自己的合同（跨进程帧、`RemoteCallError`、`DiagnosticsError`、命令失败结果），不统一成一个形状；跨进程只传码、结构化参数与安全 detail，服务端不产生界面文字。
3. 领域提示词用中文，并跟着作品语言走（界面语言、作品语言、回复语言是三条独立的轴）。基础设施提示词：新写的用中文；现有的英文说明（含命令 `description`）先不动，等 [t05](tasks/t05-prompt-language-eval/README.md) 的对照评测（已搁置）。OMP 原生工具（`read`、`edit`）的错误文本原样保留英文。
4. 界面文字用按插件、按包分的消息目录，不用 vue-i18n；用 i18next 的原生格式（`{{name}}`、`_one`/`_other`），需要 ICU 时再加插件。细节在 w00028。
5. 先做错误处理的只读审查，开发诊断改英文排在失败投影设计之后。
6. 语言政策写成一份新 ADR，取代 ADR 0023 中“前端使用 vue-i18n”一项，0023 正文不改；`common.md` 加“语言”一节。
7. 推进顺序（2026-10-27，t03 计划审查后开发者同意）：先做 w00028 t01，并把消息键写法（含错误码的命名空间）、目录里码表的穷举检查、共用的失败值类型与参数上限、未知码的中性兜底、界面统一的“详情”载体并入它的范围；t03 之后按错误域拆成几份设计，建在这些共用件之上；开发诊断改英文与失败投影解绑，单独成片。
8. 失败页在显示语言加载前出现时：照明暗主题的做法，把上次的界面语言记在浏览器本地，失败页读它，读不到用中文（2026-10-27）。
9. nb-story 网页保持单语中文，只把错误改成按码取文案（2026-10-27）。
10. nbdev 面板继续显示错误原文（改英文后照样显示）；只有面板与命令行共用的校验函数改成返回码加参数（2026-10-27）。
11. 简单的实施任务可以派 Claude Sonnet 或 Haiku 子代理做（2026-10-27）。
12. 给模型的文字的长期目标是 i18n，以后可以为不同语言各备一套提示词；现在新写的提示词用中文是因为方便，以后改造工作量大但难度不大，可以接受。t05 的中英文对照评测继续搁置，不并进 w00032 t18（2026-10-28，接入 Agent 讨论 t11 时定；写进 [`common.md`](../../../docs/standards/code/common.md) 的“文字用哪种语言”，ADR 0034 正文不改）。
13. 失败投影的拆分（2026-11-10，[t03 计划](tasks/t03-failure-projection/plan.md)第二版与 omp 审查后开发者同意）：不新建提案，计划作为各域 Spec 里“（planned）”条目的批准依据；t03 做共用件（未知码兜底、远程路由码的文案归宿主、按拥有者取文字的函数）与命令一域，其余各域按下表各一个 Task；`nbstory`、`nbook` 的 `--json` 里 `code` 稳定、`message` 改英文诊断、不加版本字段；开发诊断改英文（t04）不全量翻译，新写的英文、碰到就改、机检告警新增的中文诊断。

## 任务

按表中顺序推进；t06 排在 [w00028 t05](../w00028-i18n/tasks/t05-editor-explorer-to-notifications/README.md) 之前，两者共用“编辑器保存与关闭的失败码”合同。

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-adr/README.md) | 语言政策 ADR 0034（完成） |
| [t02](tasks/t02-error-audit/README.md) | 错误处理只读审查与通道矩阵（完成） |
| [t03](tasks/t03-failure-projection/README.md) | 失败投影：总则、共用件与命令一域（完成） |
| [t06](tasks/t06-editor-files-failures/README.md) | 编辑器、文件客户端与资源管理器（未开工） |
| [t07](tasks/t07-window-failure-page/README.md) | 窗口失败页与握手（未开工） |
| [t08](tasks/t08-platform-failures/README.md) | 设置、存储、项目与插件平台（未开工） |
| [t09](tasks/t09-agent-qa-failures/README.md) | Agent 与问答（未开工） |
| [t10](tasks/t10-story-web-cli-failures/README.md) | nb-story 网页与两个命令行（未开工） |
| [t11](tasks/t11-nbdev-failures/README.md) | nbdev（未开工） |
| [t12](tasks/t12-sdk-example-failures/README.md) | SDK 示例（未开工） |
| [t04](tasks/t04-migration/README.md) | 开发诊断改英文，与失败投影解绑（未开工） |
| [t05](tasks/t05-prompt-language-eval/README.md) | 提示词中英文对照评测（搁置） |
