# Agent Skill Package Contract

## User Request / Topic

- 修正 `HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PREFIXES` 每次启动都删除 llmlint `node_modules` 的错误生命周期。
- 建立正式 Skill package 规范，支持 Skill 版本更新、首次安装依赖与后续依赖失效。
- 修复 llmlint prompt 对 `.nbook/agent/skills/llmlint` 的硬编码，使同一 Skill 可安装到其它 Agent skill root。
- 沿 source、vendored snapshot、user-assets、catalog prompt 和 CLI 初始化链路做完整审查，忽略无关 Git 变更。

## Goal

1. `node_modules` 永远不进入受管资产更新；普通同步和非依赖更新保留本地安装。
2. 只有实际影响 Bun install 的 package 合同或 `bun.lock` 发布时，精确失效对应 Skill 的依赖。
3. runnable Skill 用 `package.json.version` 作为唯一 SemVer 真相源，`SKILL.md` 保持可移植。
4. Agent 第一次使用 llmlint 时先 install，成功后才进入 `status` 初始化门。
5. llmlint 所有 Agent 命令从 SkillCatalog 的绝对路径推导 root，不依赖宿主目录名。

## Decisions

- `node_modules` 从 deleted/hard-cut 列表移除；废弃官方资产清理与运行依赖失效是两个机制。
- Skill 版本不重复写进 `SKILL.md metadata`，由 runnable package 的 `package.json.version` 提供。
- 版本号、说明和普通 prompt/rule 文件变化不改变安装结果，因此不清依赖。
- package dependencies、安装脚本、平台/package-manager 字段或 `bun.lock` 变化会清理对应 Skill 的 `node_modules`。
- 用户同名 Skill 仍按整个目录覆盖 system Skill，不引入逐文件 merge 或多版本并存。

## Implementation Walkthrough

### 2026-07-26

- `novel-workspace.ts` 将 llmlint `node_modules` 从 deleted/hard-cut 前缀移除，并在受管文件真正发布时识别任意 runnable Skill 的安装合同变化。
- 受管资产黑名单泛化为排除任意 `agent/skills/<key>/node_modules/`，不是 llmlint 特判。
- 新增 no-op、prompt-only、force no-op、version-only、JSON 键重排、dependency、lockfile 和第二个合成 runnable Skill 回归；旧 `.git` / `evals` hard-cut 清理继续保留。
- `SkillCatalogItem` 新增可选 `version`，从 `package.json.version` 读取；模型可见 catalog 同时输出绝对 `root` 和 `location`。
- 新增稳定参考 [skill-package.md](../../../reference/agent/skill-package.md)。
- sibling llmlint 升级为 `2.0.1`，移除 `SKILL.md` 中重复 metadata version，并把命令统一改为 `<skill-root>`。
- llmlint 首次使用仍强制 install 成功后再进入 `status`；依赖合同未变化时复用安装。
- 最终链路审查补上两处故障隔离：损坏的用户 Skill package 只隔离自身且继续遮蔽同名 system Skill；`force` 更新可覆盖损坏的用户 `package.json`，并把旧 `node_modules` 视为失效。

### 2026-07-31 · llmlint 3.0.0 同步复核

- sibling llmlint 已升至 `3.0.0`，依赖字段与 `bun.lock` 未变化；本轮只是版本、scope、规则、提示词与源码更新，不应触发依赖失效。
- `HARD_CUT_DELETED_MANAGED_SYSTEM_ASSET_PREFIXES` 仍只列已废弃的 llmlint 受管目录，没有 `node_modules`；依赖失效继续由 `package.json` 安装字段与 `bun.lock` 的独立合同负责。
- source → vendored 同步更新 27 个文件，vendored → 当前 user runtime 更新 27 个受管文件；三处各 122 个 runtime 文件，逐文件 SHA-256 零差异。
- 当前真实 user runtime 同步前没有 `node_modules`，因此不能把这次真实同步说成“保留了既有安装”；保留与失效行为由隔离 fixture 的 sentinel 覆盖。
- 宿主 hard-cut/首次安装测试随 3.0.0 CLI 合同更新：要求 `guide` 与 `rules`，并明确拒绝旧 `show-llm-rules`。

### 2026-08-01 · Task 130 解冻后最终检查点

- Task 130 的双 clean build 与仓库外 Windows smoke 完成后解除 NeuroBook Source 写入冻结；随后重跑两级同步，source → vendored 为 `copied=0 / unchanged=122 / removed=0`，vendored → 当前 user runtime 为 `copied=0 / skipped=326 / updatedAssets=0`。
- source、vendored snapshot 与当前 user runtime 各 122 个 runtime 文件；source → vendored、vendored → runtime 两段逐文件 SHA-256 差异均为 0。
- 聚焦复跑依赖生命周期与旧 hard-cut 清理用例，结果为 2 passed / 70 skipped。版本、提示词、规则或源码更新保留 `node_modules`；只有安装合同或 `bun.lock` 变化才失效的边界不变。

## Verification

### 2026-07-26 历史基线

- [x] NeuroBook SkillCatalog / Profile DSL：2 files / 41 tests passed；新增坏用户 package 隔离回归。
- [x] NeuroBook workspace assets：目标 2 tests passed（依赖生命周期 + 旧 hard-cut/首次 install，84 skipped）。收尾首轮曾在 fixture 建立阶段遇到一次 `ENOSPC`、另一次 `beforeAll` 超过 60 秒，均为 0 test 执行；清理后的单 worker 串行复跑通过，不计为产品失败。
- [x] llmlint：TypeScript 通过；30 files / 282 Vitest passed；Bun tests 69 passed；`skill-creator` validator 通过；CLI `--version` 输出 `2.0.1`。
- [x] sibling source → NeuroBook vendored snapshot：最终 no-op 为 `copied=0, unchanged=118, removed=0`。
- [x] Bundled Workspace Template → Workspace Root `.nbook`：最终 no-op 为 `updatedAssets=0`、`skipped=318`，已安装 `commander` 仍存在。
- [x] 真相源、vendored snapshot、真实 runtime 的 7 个 package / prompt 关键文件 SHA-256 一致；bundled 无 `.git` / `evals` / `node_modules`，runtime 只有本地派生 `node_modules`。
- [x] 真实 runtime 首次 `bun install --cwd "<skill-root>" --frozen-lockfile` 成功；随后 `status` 为 `version:2.0.1`、`initialized:false`。
- [x] 隔离 `LLMLINT_HOME` 初始化：`false/fragments → true/stats`，未修改真实用户共享设置。
- [x] NeuroBook 根 typecheck 已运行；Bun isolated linker 首轮因既有宿主 peer/transitive 包没有根链接产生模块缺失，按同一 frozen lock 建立 hoisted 派生链接后，仍只剩既有 `server/agent/skills/llmlint.test.ts` 26 项类型漂移（缺 `ignoreTerms`、一处旧 source kind），本轮生产文件无新增类型错误。该基线已在 `PROJECT-STATUS.md` 的 Task 118 中记录，本任务未扩到无关旧测试修复。

### 2026-08-01 · 3.0.0 当前验证

- [x] 3.0.0 隔离安装 smoke：副本安装前无 `node_modules`，`bun install --cwd <skill-root> --frozen-lockfile` 成功后 `status` 返回 `version:3.0.0`、`initialized:false`、`fragments + auto`、`login:none`。
- [x] 3.0.0 NeuroBook 聚焦测试：`同步系统 assets 会清理未手改的旧 llmlint 受管文件` + `Skill 同步只在依赖合同更新时失效 node_modules` 共 2 passed / 70 skipped；覆盖 prompt/version/force no-op 保留与 dependency/lockfile 失效。
- [x] source → vendored → 当前 user runtime 各 122 个文件，两段逐文件 SHA-256 差异均为 0；最终两级同步均为 no-op。

## Plan Differences

- 初步方案曾考虑把版本写进 `SKILL.md`；按 portable Skill 约束改为 `package.json.version`，避免 NeuroBook 私有 frontmatter。
- 初步依赖失效按整个 `package.json` hash 触发；实现进一步收窄为 Bun install 输入，版本号或说明变化不会造成无意义重装。
- 初步只修 llmlint 黑名单；完成审查时发现这不能约束未来 runnable Skill，最终泛化到任意 Skill key，并增加合成 Skill 回归。

## References

- [Skill package contract](../../../reference/agent/skill-package.md)
- [统一 Agent 资产发布包协议](../../../reference/agent/agent-asset-package.md)：在本任务的本地 Skill 依赖合同之上，统一 Workshop 的 Skill / Workflow / Profile 外壳与发布 SemVer。
- [ADR 0011：Agent 资产安装身份](../../adr/0011-agent-asset-install-identity.md)：发布包只以 `package.json.name` 为安装身份；不新增别名字段。
- [Task 84 llmlint standalone repo](../84-llmlint-standalone-repo/README.md)
- [Workspace terms](../../../reference/workspace/TERMS.md)
- sibling llmlint source: `../llmlint/skill/`
