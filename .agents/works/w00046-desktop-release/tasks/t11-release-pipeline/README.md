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

2026-11-14：计划初稿写成，切片 1（CDP 与 WM_CLOSE 探针）在 pc-notype 上做完，选型成立（[cdp-probe-r1.txt](evidences/cdp-probe-r1.txt)）。

2026-11-14：设计审查第 1 轮（omp）23 条，阻断 4、重要 17、次要 2，都成立，计划改成 r2（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-omp-disposition.txt)）。要点：
- 桌面工程的输入在 ubuntu 上做齐；测试包 B′ 在独立 worktree 里改版本并做本地提交，壳与应用包同一版本；每个变体各自一份工程目录构建，正式产物构建完即另存；
- 发布计划在构建作业里冻结依赖与摘要，本次版本的包已发而字节不同就失败；npm 的 dist-tag 一律显式；
- Release 公开与是否设为最新在同一个请求里定，重跑时只核对；发布完成门禁核对清单身份、逐个文件的 SHA-256 并存请求证据；
- 更新冒烟用缺省状态根，补上场景 2 后半与“上一正式版到本次”；冒烟核对作品与设置不变、服务端有序停止，失败证据收全；
- 加发布后的 registry 核对；正式发布排队用 `queue: max`；一次性准备加标签规则集、Environment 的标签限制与 npm 信任的 2 天时限。
- 新增待确认 5 行。

## 下一步

切片 2：`tag.ts`、`publish.ts` 的 `--plan` 与 `--ci`、`github-release.ts`、`verify-update-feed.ts` 与单测（Work worktree）。
