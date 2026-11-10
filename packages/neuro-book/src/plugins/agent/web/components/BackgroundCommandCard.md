---
标签: [state:local, state:inject]
别名: ["后台命令卡片"]
---

# BackgroundCommandCard

`shell` 带 `async` 转到后台的命令（对话视图的节点，宿主经 `renderers.backgroundCommand` 注入；[`conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 33–39、[`jobs.md`](../../../../../../../docs/specs/agent/jobs.md)）。

## 布局与交互

- 卡头：图标、“后台命令”、命令（等宽、截断）、任务与用时；运行中转圈并有“停止”（以用户的身份停，`killJob`），结束后是状态图标。
- 下面一行：运行中写输出的最后一行，结束后写退出码与行数；右边是输出文件的地址。点这一行展开输出的最后 50 行（限高、区内滚动），展开时才取；运行中跟着最后一行的变化至多每秒取一次。
- 任务已移出任务中心（取过结果、应用重启）时，终态从 `status.json` 读。

## 数据

属性同工具节点（`ToolComponentProps`）；事件 `action`。

## 隐藏通道理由

`state:local`：输出的展开与取到的最后几行。`state:inject`：卡片的数据与动作（`subagent-store.ts`），与插件的界面文字。
