# 文档与治理基线检查

## 已运行

- `bun run docs:check`：exit 0，`failures: []`，检查 5530 个候选文件（含源码，不等于 5530 份 Markdown）。初次输出见[原始证据](../evidences/docs-check-initial.txt)。独立审查若修改正文，随后重跑文档门禁。
- `bun run governance:context -- --work w00017-application-runtime-architecture --task t01-architecture-proposal --role leader`：exit 0，`failures: []`；识别主树 master / `45906272915ff43e83318653af62afa9ce668206`、w00017/t01/leader。
- `bun run governance:check`：exit 1，两项非本轮路径失败；[原始输出](../evidences/governance-check.txt)。未宣称全仓治理通过。
- 额外只读路径检查：新提案与四份 Work/Task 文档共 5 个文件、25 个相对链接，未发现不存在的目标。不是完整 Markdown anchor 验证，正式链接/结构检查以上述 docs:check 为准。

## 两项既有失败的依据

1. `.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t14-agent-profile-nav-lab-migration/` 当前只有 `evidences/product-exclusion-2026-09-04.json`，没有 README。该目录未由本轮创建或修改；不能虚构一个 Task 正文恢复历史身份。
2. `scripts/ci/agent-governance-contract.ts:531` 对根 AGENTS 检查四个固定字符串，其中“开发者批准一个目标、范围和关键取舍后”“本地可逆开发动作”“远端Issue/Project/PR写入”未在当前根 AGENTS 原文出现；“统一评审通过后”存在。根 AGENTS 开工时已是用户未提交改动，本轮保持不动。此检查是文本标记检查，不足以据此宣布所有授权语义已丢失。

本轮不修改门禁脚本、不恢复旧文案骗取绿灯、不接管 w00003 的 provenance 修复。两项既有失败不妨碍本轮文档评审与可解析的 w00017 身份。

## 未运行

无产品代码变化，按 `docs/testing/README.md` 纯文档门禁未运行产品测试、typecheck、build、浏览器、迁移或 Provider/Model。没有提交、push 或远端更新。

## 最终检查与交付边界

- 全部提案修订、索引、Work/Task 与独立审查报告集成后，`bun run docs:check` 再次 exit 0，`failures: []`，`checkedFiles: 5535`；输出与正文 SHA-256 见 `../evidences/docs-check-final.txt`。
- t02、t03 分别执行 `bun run governance:context -- --work w00017-application-runtime-architecture --task <taskId> --role reviewer`，均 exit 0、`failures: []`。连同 t01，三份 Task 均解析到正确 Work 和 role。
- `governance:check` 的两项既有失败保持明确未解决；其涉及的旧 Task/根治理文件和校验脚本本轮未修改，没有为了重复得到同一失败而重跑。
- 最终提案 SHA-256：`2c91e533accc78ad2c58504161791b522e6368bc7d257fee78921f7f309cd2d1`。验证覆盖 master `45906272915ff43e83318653af62afa9ce668206` 加未提交文档，不对应独立 revision。
- 没有创建临时脚本、应用服务、浏览器实例或验收数据根；无待清理运行资源。既有用户/其他 Work 改动保持原状，未暂存、提交或 push。
- 本次完成四项设计与质量交付。推荐方案仍 `reviewing`，未批准细节没有登记为 `planned`，产品实现未变化。
