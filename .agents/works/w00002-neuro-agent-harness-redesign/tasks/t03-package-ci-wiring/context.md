# 新包 CI 接线恢复卡

## 当前状态

- Current Task：`t03-package-ci-wiring`（canonical role: tasker）；Work `w00002-neuro-agent-harness-redesign`；Issue #193。
- 授权：开发者 2026-09-11「都授权」「继续」。
- 起因：`t02` 新建的两个包未接入 CI；`scripts/ci/workspace-workflows.test.ts` 的合同（每个 `packages/` 目录必须出现在 `code-baseline.yml` 与 `product-platforms.yml` 的 PR paths）在包创建后 RED（实测失败于 `packages/agent-file-tools`）。
- 修复范围：`scripts/ci/workspace-package-matrix.ts` + `.github/workflows/{workspace-packages,code-baseline,product-platforms}.yml`；见 `README.md` 允许文件。

## 恢复顺序

1. [Issue #193](https://github.com/notnotype/neuro-book/issues/193)；2. `packages/neuro-agent-harness/docs/issue-193-roadmap.md`；3. 本 Task `README.md`；4. `scripts/ci/workspace-package-matrix.ts` 与三个工作流；5. 存在时读 `evidences/`。

## 下一合法动作

本 Task 已完成（2026-09-11）：矩阵脚本与三个工作流路径已补齐，`scripts/ci/workspace-workflows.test.ts` 由 12 pass/1 fail 变为 **13 pass/0 fail**，本地矩阵选择验证通过（证据见 `evidences/2026-09-11-ci-wiring-verification.md`）。未改包内实现与其它工作流语义。
