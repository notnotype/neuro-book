# 《Agent 审批》第二稿的审查处理（2026-11-18）

审查对象：第二稿 `docs/proposals/agent-approval-simplification.md`，提交 `ce5eaf6e6` 时的固定副本。开发者同意两项待定之后，按开发者要求派一位 Claude Opus 做轻量审查（前后端都看，以判定语义与接口为主）：[报告](approval-proposal-review-r2-backend-opus.txt)，10 条（重要 5、建议 5）。

主 Agent 在主工作区用真实钩子与文件服务重跑了审查者的复现（[repro](approval-proposal-review-r2-repro.test.ts.txt)，`packages/neuro-book` 下 `bun test`，3 条都过）：A 的文件确实写在会话目录之外、`by` 为 `mode:scratch`；B1 逐个确认下写宿主子目录先问；C 用户的询问规则后面加放行仍然问。另读代码核实：`shell` 每次调用从布局的工作目录起、不保留 `cd`（`kit/tools/shell.ts`）；内核询问只有 `reason`、`remember`（`kernel/api/tool.ts`），NeuroBook 不传 `escalate`；`mergeLayers` 的先后；“以后都允许”加在末尾并同时按“本会话都批准”应答（`permissions.md` 输出 23）；宿主子目录判断区分大小写，`.nbook` 不区分（`schemes.ts`、`files/backend/rooted.ts`）；待审批视图已有表示后代会话的 `source`（`nb-agent-ui/src/types.ts`）；`builtin-tools.test.ts` 的预览用例写 `session://` 等批准。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 `cd` 之后的相对重定向被算成只写自有目录 | 成立（现有缺口，已复现） | 第四节第 2 小节加一条：有 `cd`、`pushd`、`popd` 时相对的写重定向算不出；`shell` 不跨调用保留 `cd`，只看一次调用就够；写进问题与行为变化 3 |
| 2 不能用的记住按钮不止两种来源 | 成立（已复现） | 按钮按是否起作用列表：规则询问只给“本会话都批准”；审批模式、审批模型转问两个都给；Agent 模式、写用户设置、规则文件读不了都不给 |
| 3 来源送不到界面、分不出层、漏了审批模型转问、撞 `source` | 成立 | 内核询问与放行加宿主定义的 `cause`，原样进审批请求与 `toolStarted.approval`；命中结果带层与条；来源补上审批模型转问；字段不叫 `source`；备选里写明不沿用 `reason` 固定串 |
| 4 “写不了直接失败、不弹审批”与判定顺序矛盾 | 成立 | 改成“执行时失败；逐个确认下照样先问，批准后同样失败”；自动模式下多一次审批模型调用写进行为变化 2 |
| 5 布局只留 `own`、`confirmWrites` 不够 | 成立 | 布局写全：`own: {roots, except}`、`autoWrites`、`confirmWrites`；第一轮处理表第 9 条当时没落到正文，这次补上 |
| 6 宿主子目录按区分大小写判 | 成立（从代码推断，未在大小写不敏感的卷上验证） | 名单与判断共用，按名字不分大小写（同 `.nbook`），写成行为变化 5；符号链接一半不做：要先批准一次 `ln -s`，属于 `shell` 能绕过的范围 |
| 7 每次非读都取判定对象改了激活时机 | 成立 | 只在能改变结论时取（非读，且不是全部放行、不是放行写入下的写入工具）；写明审批前激活与按声明等级判的后果；补 `contributions.md` 输出 5、`permissions.md` 输出 9 |
| 8 现有 `by` 做不出放行来源的例子 | 成立 | 放行同样带 `cause`；`by` 不变以兼容旧日志；例子改成“本会话批准过 · `git diff *`”；写明 `by` 的分布会变 |
| 9 Spec 与测试清单漏项 | 成立 | 第六节按报告补齐（含 `runtime.md` 输出 17、39，`contributions.md` 输出 5，`permissions.md` 输出 6、8、9、18、21 与关键不变量，`modes.md` 实现合同与验收 1，`resources.md` 公开入口，`host-kit.md` 输出 2）；第五节加“测试”一项；删掉不存在的“验收结果表” |
| 10 两句固定说法与判定不符 | 成立 | 改成“没有规则拦着时，会话自己的目录（含临时目录）写了不问”；逐个确认的说明列全不问的几类 |
| 第 9 维度：逐个确认下命令只写自有目录也不问，是否在开发者同意的范围内 | 说明没写清 | 开发者同意前看过的逐步讲解里，结果表“逐个确认”一列就有 `cat a.md > tmp://x` 从问变成放行；说明里没给这张表。正文行为变化 1 补上命令的例子 |
