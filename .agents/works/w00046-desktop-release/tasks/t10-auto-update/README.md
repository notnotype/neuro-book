---
schema: nbook.task/v2
taskId: t10-auto-update
status: active
updated: 2026-11-13
---

# 桌面版自动更新

## 目标与范围

Electrobun Updater 接 GitHub Releases：后台检查与提示、下载前核对版本只升不降、下次启动时换上、安装级排他、目标移动后重新检查；便携版只提示。依据提案 4.6、ADR 0051 决定 6。

合同：[`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)；[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 11；[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13。计划见 [plan.md](plan.md)，更新器调研见 [evidences/electrobun-updater-research.txt](evidences/electrobun-updater-research.txt)。

## 当前状态

2026-11-13：
- 页面一侧的设计审查（Sonnet）8 条，均改（[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-sonnet-disposition.txt)）。
- 壳与更新器的设计审查（omp）17 条，阻断 3 条（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-omp-disposition.txt)）。阻断三条指向同一个上游问题：Spec 要求的“安装独占保持到新版本接手”，Electrobun 2.0.6 的原生 helper 做不到。停下交开发者定方向。

2026-11-14：开发者选方向 A，即改 Spec，靠更新器的 helper 与 Windows 的文件占用：
- 壳只在没有别的壳在用时才发起换上；
- 换上期间又有人打开旧程序时，这次换上失败、还原，通知“更新没有完成”，下次再试。

Spec desktop-update 已随之修改（术语“安装的使用与换上”、输出 4、7、8，时序、失败表与场景 4）。计划按这个方向与 omp 的另外 14 条修订后，交第二轮设计审查。

2026-11-14：第二轮设计审查（omp）10 条，阻断 3 条，全部成立、均改进计划（[报告](evidences/design-review-r2-omp.txt)、[处理](evidences/design-review-r2-omp-disposition.txt)）：状态文件改单写者、换上终态读更新器的结果文件、拿不到共享锁不启动、下载结果按 `updateInfo` 判断、版本来源改为 `PRODUCT_VERSION`。交第三轮（最后一轮）设计审查。

2026-11-14：第三轮设计审查（omp）3 条重要、没有阻断，均成立、已改进计划（[报告](evidences/design-review-r3-omp.txt)、[处理](evidences/design-review-r3-omp-disposition.txt)）：未对账时运行中每 30 秒重判，进行中与否看换上程序的进程而不是 10 分钟墙钟，验收前确认缺省状态根不存在。满三轮仍有实质问题，停下问开发者；开发者 2026-11-14 定：按修订后的计划直接实施，修订部分（运行中重判、按进程判进行中）在实现审查里重点看。

切片 1 `4bc20008f`：nb-flock 的共享锁。本包测试 6 条、类型检查，使用方的锁测试（nb-harness 日志 32 条、nb-story 669 条、Skill 安装 8 条）通过；Windows 上用真实子进程核对了四种关系（两个共享共存、共享挡独占、独占挡共享、持有者退出后可拿）。随 t08、t09 一起合入 master（`fe4560370`）。

## 下一步

切片 2：核心 `update.ts`（控制器、`applyAtStartup`、`reconcileAtStartup`）、`shell.ts` 接入、`windows.ts` 的提示交付。
