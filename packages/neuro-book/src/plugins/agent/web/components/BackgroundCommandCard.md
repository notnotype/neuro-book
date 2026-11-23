---
标签: [state:local, state:inject]
别名: ["后台命令卡片"]
---

# BackgroundCommandCard

`shell` 带 `async`、或前台跑过门槛自动转到后台的命令（对话视图的节点，宿主经 `renderers.backgroundCommand` 注入；[`conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 33–39、[`jobs.md`](../../../../../../../docs/specs/agent/jobs.md)）。

## 布局与交互

- 卡头：图标、“后台命令”、自动转的另写“自动转到后台”（结果的 `details.autoBackground`，[`builtin-tools.md`](../../../../../../../docs/specs/agent/builtin-tools.md) 输出 31）、命令（等宽、截断）、任务与用时；运行中转圈并有“停止”（以用户的身份停，`killJob`），结束后是状态图标。
- 下面一行：运行中写输出的最后一行，结束后写退出码与行数；右边是输出文件的地址，点了发 `reference.open` 打开（与展开的按钮并列）。点这一行展开输出的最后 50 行（限高、区内滚动），展开时才取；运行中跟着最后一行的变化至多每秒取一次，一秒内的最后一次变化在等够一秒时补取；只认最新一次请求的回应。
- 还没有任务 id 时按调用的状态写：在等审批或正在登记写“等待开始”，被拒写“没有执行”，参数不对写“参数不对，没有执行”，没登记成就出错写错误；这时没有输出可展开。
- 任务已移出任务中心（取过结果、回执已送达、应用重启）时，终态从 `status.json` 读。

## 数据

属性同工具节点（`ToolComponentProps`）；事件 `action`。

## 隐藏通道理由

`state:local`：输出的展开与取到的最后几行。`state:inject`：卡片的数据与动作（`subagent-store.ts`），与插件的界面文字。
