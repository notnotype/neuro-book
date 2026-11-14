---
schema: nbook.task/v2
taskId: t11-release-pipeline
status: active
updated: 2026-11-14
---

# 打标签自动发布流水线

## 目标与范围

release.yml：标签与产品版本一致性、标签提交上调用可复用的 ci.yml、ubuntu 冒烟 11 个包、windows 组装与冒烟安装包与便携包、npm CLI trusted publishing 发同一批 tarball（publish.ts 增加 CI 入口）、草稿 Release 核对后公开、重跑与不回拨 latest；11 个包在 npm 上配置信任（开发者操作）。依据提案 4.8、ADR 0051 决定 7。

2026-11-13 w00043 t12 加了以源码发布的 `nb-flock`（[ADR 0052](../../../../../docs/adr/0052-non-stale-file-lock-package.md)），上面的 11 个包变成 12 个。`nb-flock` 从没发布过，npm 要包已经存在才能配置信任：它的首发由开发者在本机手工完成，之后再配信任。

合同：行为合同不变。流水线兑现 [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 与 [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 的 Smoke，以及 t10 交下来的发布完成门禁；流程写进 [`repository-workflow.md`](../../../../../docs/standards/repository-workflow.md) 的发布一节。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13 经 nbdev 新建。

2026-11-14：计划初稿写成。要点：
- Windows 冒烟用 Playwright 经 WebView2 的远程调试端口驱动装好的应用；
- Agent 的命令用 e2e 已有的本机假模型端点；
- npm 发布冻结一份 `release-plan.json`，低于当前 `latest` 的版本用 `history` 标签；
- Release 先草稿，只补缺的资产，本次版本更高才设为最新；
- 发布后照更新器的取法核对 `latest/download`。

## 下一步

等 t10 的收口审查（omp）跑完，再交计划的设计审查（omp，阻断）。同一时间只跑一个 omp 审查。
