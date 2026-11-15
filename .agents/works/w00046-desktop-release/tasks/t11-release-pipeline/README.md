---
schema: nbook.task/v2
taskId: t11-release-pipeline
status: done
updated: 2026-11-15
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

2026-11-14：设计审查第 2 轮（omp）有效 14 条（阻断 1、重要 12、次要 1），都成立，计划改成 r3（[报告](evidences/design-review-r2-omp.txt)、[处理](evidences/design-review-r2-omp-disposition.txt)）。要点：
- 便携 zip 改从完整包解压出的应用目录打；
- 发布计划按 npm 上的发布时间区分本次发布与历史包；
- 发布完成门禁校验 v2 清单的解压后摘要，按 SHA256SUMS 列补丁；
- “上一版到本次”移到发布之后的 `upgrade-from-previous` 作业，走真实路径；
- 更新冒烟各段之间收掉壳；换上后第一次启动用 UI 自动化取证，之后带调试端口重新启动；
- 加 `desktop.server.stopped` 诊断作服务端有序停止的正向证据；
- `nb-flock` 首发前要开发者授权 `nb-harness`、`nb-story` 提版。
- 不再开第 3 轮设计审查：余下的不确定点都排在切片 4 的 pc-notype 先验里。新增待确认 2 行。

2026-11-15：切片 2、3 完成（Work 分支 `d849b332a`、`d806e30f2`、`59759a877`）。标签门禁、发布计划与 CI 发布入口、GitHub Release 草稿与公开、发布完成门禁；壳记下检查更新的结论与自有服务端的就绪、停止、意外退出。验证见 [release-scripts-r1.txt](evidences/release-scripts-r1.txt)：72 条脚本测试（bun 与 vitest）、90 条桌面核心测试，6 处变异核对；照 B′ 的做法在一次性 worktree 里改版本、本地提交、冒烟、写计划都跑通；在没有生成目录的检出上 `--ci` 只列出要发的。

2026-11-15：切片 4、5、6 完成（Work 分支 `90e5c3efb`、`2797782ae`、`f3e7fae72`、`37925670c`）。pc-notype 上的实测见 [windows-smoke-r1.txt](evidences/windows-smoke-r1.txt)：
- 前提“复制一份 `desktop/` 单独构建”“从 tar.zst 打便携 zip”成立；用流水线同一条路（`build-variant.ts`）构建了正式、A′、B′，B′ 在本机更新源上取 A′ 生成了补丁。
- 安装版、便携版、更新冒烟都通过；第一次跑各暴露一处脚本问题，已修：shell 不一定要批准；便携版的 WebView2 数据按 Spec 留在通道根下，核对时略过；一次性的“已更新到”只停 3.2 秒，换上后的取证改为壳日志里页面交回的 `desktop.update.notice-shown`（产品多一条 info 诊断），UI 自动化改单进程连续读、读到另记。
- t10 交下来的复查：相对路径与无盘符的 `NBOOK_STATE_ROOT` 在 Windows 上拒绝，启动页说明。缺省状态根前后不变。
- 切片 5：`release.yml`、`ci.yml` 可复用、`build-variant.ts`、`tag.ts` 的 `source` 与 `bump-test`、`github-release.ts` 的 `sums`；切片 6：`repository-workflow.md` 的发布授权改写、两份 README、提案决策记录。
- 没有跑 actionlint：下载它的二进制被本机权限分类器拦下，只做了 YAML 解析与 `needs` 引用核对。
- 新增待确认 4 行。

2026-11-15：实现审查第 1 轮（omp）有效 7 条（重要 5、建议 2）：6 条成立已改（Work 分支 `e3f4d4277`：冒烟失败时也卸载、先还原用户数据，换上后第一次启动要检查过更新，PowerShell 字面量转义，就绪要带 PID，版本比较用 BigInt），1 条不成立（所指步骤在 ubuntu 作业里，缺省是 bash -e）；pc-notype 上安装版、更新冒烟重跑通过，失败路径的卸载实测成立（[报告](evidences/impl-review-r1-omp.txt)、[处理](evidences/impl-review-r1-omp-disposition.txt)）。合入 master；两份 Spec 的 Smoke 证据改为流水线入口与 pc-notype 的运行。

2026-11-15：一次性准备做完（开发者授权）：push master、actionlint 通过、`nb-harness` 与 `nb-story` 提版后在本机首发 `nb-flock` 0.1.0、标签规则集两条、Environment `release`、9 个包的 npm 信任；在 master 上演练 5 次，第 5 次全绿（[dry-run-r1.txt](evidences/dry-run-r1.txt)）。

2026-11-15：第一次正式发布 v0.13.0（[release-v0.13.0.txt](evidences/release-v0.13.0.txt)，[运行 43715099679](https://github.com/notnotype/neuro-book/actions/runs/43715099679)）：npm 9 个包经 OIDC 发出、都带 provenance，GitHub Release 公开并设为最新，更新取法核对通过。`registry-smoke` 第 1 次失败：5.3 MB 的应用包发布后约 8 分钟才在 registry 上可见，固定三次重试等不到；重跑通过。改为先轮询到要验的版本全部可见再装（master `aef02a325`，`release:smoke --from registry --wait 30`），单测与本机对真实 registry 的一遍都通过。

## 下一步

没有。有了上一个正式桌面版本以后，下一次发布的 `upgrade-from-previous` 第一次真正运行，结果补进 [`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md) 的 Smoke。
