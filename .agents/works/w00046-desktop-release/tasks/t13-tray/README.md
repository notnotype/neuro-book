---
schema: nbook.task/v2
taskId: t13-tray
status: active
updated: 2026-11-16
---

# 系统托盘与关掉最后一个窗口时的去向

## 目标与范围

托盘图标与菜单；关最后一个窗口默认退出、设置里可改为留在托盘。计划 r3 起不做缺省模式下的“在后台继续”（拆出另建 Task，见待确认清单），`runtime.browser-host` 不变。

合同：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 28 到 31（后台与托盘、关最后一个窗口的去向）与 [`runtime.desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 输出 6（留在托盘时的更新文字），都是 planned。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 写好计划，设计审查三轮（Opus）收敛；切片 1（Spec，master c3088ead3）提交。

切片 2 到 5 已合入 master（2026-11-16，82d15e3cc；分支与 worktree 已删；表里除最后一行外是变基前的提交号）：

| 切片 | 提交 | 内容 |
|---|---|---|
| 2 设置值与桥 | c7c221816 | `closeLastWindow` 的声明、桥、缓存逐项读、逐键去重 |
| 3 协调器 | 769751fd2 | 按输出 29 的表定原因；后台、应用级退出、托盘打开与退出 |
| 4 壳与适配层 | 37bb293ec | `trayView`、托盘退出取工作（8 秒）与对话框、`Tray` 的生命周期、后台时意外退出的正文 |
| 5 页面 | fca6ee29b |
| 实现审查 r1 | 07ce676f7、5da60e861（合入后为 a306f03d4、82d15e3cc） | 前端 Sonnet 7 条、后端 Opus 5 条，见 evidences 的 disposition | 更新文字按托盘、插件说明 |

与计划的出入：页面的更新文字不从配置读模式，改由壳在 `update-hint` 里标 `tray`（托盘图标此刻显示着）。页面宿主层没有设置服务；壳知道关窗后会不会真的留在后台（图标没建出来时不会），文字照它写更准。通知发出后不随设置变化改写，两种做法一样。

收口验证（2026-11-16，负载约 9 到 20）：`bun test src/desktop/` 125 项通过；`bun run test:affected --since c3088ead3` 通过（其间一次全量里 `pack.test.ts`、`plugins.test.ts` 因负载超时，单独重跑通过）；类型检查通过；e2e `desktop-settings`、`desktop-update` 7 项通过。

Windows 上的验收（切片 6）要等 pc-notype 能构建（t18 里 Defender 删了 Hutch，等开发者处理）。`desktop/src/bun/index.ts` 不在包的类型检查里；用临时 tsconfig 把 `electrobun/main` 指到 2.0.6 的源码检查过，只有基线就有的 4 处事件名类型错误。

## 下一步

切片 6（Windows 探针与验收）等 pc-notype 能构建；验收清单另加：图标建不出来后的重试（开机自启时任务栏未就绪）、“有工作在跑”对话框点 X 等于取消、Esc 与 Enter。通过后 Spec 条目晋升由开发者批准。
