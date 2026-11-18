# v0.14.0 与 v0.14.1 的发版经过（2026-11-18）

开发者授权：“做完后 github 发一版（有 windows 产物就行了，npm 如果发不了就别发），后续有问题不用问我”。

| 时刻 | 事 | 结果 |
|---|---|---|
| 1 | 推 master（之前落后 origin 963 个提交）、`release:prepare 0.14.0`、打 `v0.14.0` | Release 运行 44372795560：CI“治理、文档与受影响的包”失败（master 上已有的测试规则与架构测试失败，与本 Work 无关）；Windows 安装版冒烟失败：新加的首次启动向导挡住了冒烟的命令面板。没有资产、没有 Release、没有 npm |
| 2 | 冒烟先跳过向导（4c4d9a5c1）；演练（workflow_dispatch）运行 44376866419 | 安装版、便携版通过；更新冒烟失败：同一个作业里缺省状态根已看过向导，它不再出现，硬等超时 |
| 3 | 更新冒烟改成更新提示与向导谁先出来（0d854a955）；演练运行 44380012182 | Windows 桌面作业全部通过 |
| 4 | `release:prepare 0.14.1`、打 `v0.14.1`；Release 运行 44382213997 | CI 同上失败，npm 与 Release 被跳过；桌面作业通过，资产冻结 |
| 5 | 本机用 `scripts/release/github-release.ts` 的 `draft`、`publish`（与流水线同一脚本）建 Release，说明用门禁生成的那份，改掉“npm 同时发布”一句 | v0.14.1 公开、设为最新，7 个 Windows 资产 |
| 6 | 本机 `scripts/release/verify-update-feed.ts 0.14.1` | 更新文件按更新器的取法取得到，与冻结的资产相同 |
| 7 | `desktop-macos.yml`（tag v0.14.1，release-run 44382213997，publish）运行 44385399270 | 通过；补传 `NeuroBook-macos-arm64.dmg`、`stable-macos-arm64-*`、`SHA256SUMS-macos` |

没做：npm（0.14.0、0.14.1 都没发，命令行与 SDK 仍是 0.13.0）；`upgrade-from-previous`（0.13.0 → 0.14.1 的真实升级）没跑；macOS 版没有冒烟、没在真机试过。`v0.14.0` 标签留着，没有对应的 Release。
