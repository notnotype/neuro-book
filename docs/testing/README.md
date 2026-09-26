# NeuroBook 测试规范

本文件是仓库测试、临时根、环境和验收约定的真相源。所有 Vitest 配置、测试编写、fixture 和验收脚本遵守这里；规则冲突时先更新本文件，不在 `AGENTS.md` 维护第二份正文。

## 用户视角人工评测

[`manual-eval/README.md`](manual-eval/README.md) 是测试体系中的人工验收子系统：`criteria.md` 定义判定与证据合同，`journeys/` 保存用户旅程用例，`agent-guide.md` 定义一次评测的执行步骤，`report-template.md` 约束结果格式。它不属于 `packages/neuro-book/docs/runbooks/`，因为整套资产不仅包含操作步骤，还包含测试判据、用例和报告合同。

1. **测试临时根统一在 `<系统Temp>/neuro-book/vitest/<runId>/`**：
   - 由 `@notnotype/neuro-book-test-support/vitest` 在每个 Vitest worker 启动时把
     `TMPDIR`/`TEMP`/`TMP` 指向该目录；测试里 `os.tmpdir()` / `mkdtemp(tmpdir()...)`
     运行期自动收敛；
   - 受控根不放在仓库 `.agent/tmp`：worktree 深路径叠加测试内部 UUID 目录名会超过
     Windows MAX_PATH（git 对象与 release staging 报 "Filename too long" /
     ENAMETOOLONG），系统 Temp 路径最短且 OS 会定期清理；
   - 每次 run 结束由 `@notnotype/neuro-book-test-support/vitest` 的 teardown 删除
     本 run 目录；并行 run 因 runId（8 位 hex）互不干扰；进程被强杀时由下一次 run 的
     setup 按 24 小时超窗兜底回收；
   - 所有 Vitest 配置的 `setupFiles` 第一项必须是该 setup 文件、`globalSetup` 必须包含
     该 globalSetup（含独立包配置）。
2. **测试自身必须清理自己创建的目录**：`afterEach` 收集并 `rm`。清理失败视为测试问题，
   不依赖全局清理兜底。
3. **进程被强杀等异常残留**由 `@notnotype/neuro-book-test-support/tmp` 的
   `sweepStaleTmpRoots()` 在每次 run 起点回收：只删除带合法 owner marker、超过 24 小时且
   owner 进程已死的真实目录；无 marker、symlink/reparse point、普通文件、窗口内目录和活跃
   owner 一律保留并报告。新增测试根使用 `createTestTmpRoot(name, purpose)`。
4. **禁止在仓库根、`.worktree/`、快照目录或系统 Temp 根直接创建业务临时数据**；仓库根下的
   `cache/`、`workspace/`、`logs/` 等业务目录不能被测试写入。
5. **脚本（非测试）的临时数据**使用 `@notnotype/neuro-book-test-support/paths` 分配的系统 Temp
   子目录，并且必须在 `finally` 中清理。
6. **验收/沙盒脚本**默认输出到 `<系统Temp>/neuro-book/acceptance/` 或 task/run 专用子目录，
   禁止把用户公共目录写为默认值；需要仓库外路径时通过参数显式传入，并打印实际路径。
7. **公开环境键由测试支持包拥有**：

   | 环境键 | Owner 与约束 |
   | --- | --- |
   | `NBOOK_HOST_SYSTEM_TEMP_ROOT` | `neuro-book-test-support` 的宿主 Temp locator；只供隔离测试或验收宿主注入绝对路径 |
   | `NBOOK_AGENT_TEMP_ROOT` | Agent 测试、fixture、cache、scratch 与 acceptance 的共同父根；必须是宿主 Temp 内的绝对真实路径 |
   | `NBOOK_AGENT_WORKTREE_ROOT` | governance/worktree 工具的 repo-relative locator；默认 `.worktree`，不得指向包源码或运行数据根 |
   | `NBOOK_TEST_TMPDIR` | Vitest global setup 为单次 run 写入；必须包含在 `NBOOK_AGENT_TEMP_ROOT` 内，普通测试不得长期覆盖 |

## 测试文件组织

- 测试文件与被测源码同目录，命名 `<module>.test.ts`；服务端需要 JSX 时用 `.test.tsx`。
- 每个 Vitest 配置显式声明 `root`（仓库根或包根），不依赖 `process.cwd()`；include 覆盖
  该作用域内全部测试文件。
- Vitest 包的全量测试统一用包脚本 `bun run --cwd packages/<pkg> test`（node 运行时）。`bun --bun` 直接运行 vitest 时部分依赖
  （如 zod）的 CJS/ESM interop 与 node 不同，过滤单文件可能误报
  `zod does not provide an export named 'z'`；以 node 运行时为准。
- 新增测试目录（如新 `scripts/<area>/`）必须同步加入对应配置的 `include`，否则测试
  永远不运行——「写了但从不跑」比没有测试更危险。
- 测试导入使用与源码一致的 `nbook/*` / `#manager/*` 别名，不使用跨项目相对路径。

## 平台与 CI

- 依赖 Windows 路径语义的测试用 `it.runIf(process.platform === "win32")`，其余平台跳过；
  POSIX 独有的信号语义测试用 `it.skipIf(process.platform === "win32")`。
- 测试不得依赖本机用户目录、`Program Files`、`C:\t145-*` 等机器特定路径；需要真实目录
  时全部使用 `mkdtemp(tmpdir()...)`（受控根）。
- CI 与本地跑同一套配置：clean-runner 不生成 `.nuxt/tsconfig.json` 时，相关配置使用独立
  esbuild transform（`oxc: false`），不依赖 Nuxt prepare 产物。

## 验收脚本（Task 145 及后续 Desktop 任务）

- `prepare-host.ps1` 等宿主机准备脚本：输入/证据默认落在系统 Temp 下的 Agent 受控目录，
  所有路径可参数化；`.wsb` 等模板文件不得写死本机路径，运行说明要求按脚本输出修改。
- 面向用户的下载产物（如最终 ZIP）不属于测试临时数据：放用户指定目录，并同时给出
  SHA-256 与构建身份（revision/imageId），不与其他 quick 构建混放。

## 验证门禁

- 实施前确定当前目标的可观察行为、直接受影响边界与完成证据；有 Task 时写入快照，否则使用会话计划，不强制创建额外文件。
- 纯文档修改检查链接、结构与语义，不运行产品测试、typecheck、构建或浏览器；治理脚本变化仅运行直接相关脚本测试与类型检查。VitePress 投影仍按 [文档目录合同](../AGENTS.md) 运行 `bun run docs:build`。
- 实现变化运行受影响既有测试；类型表面改变才运行对应 typecheck。工具只支持全应用检查时运行一次，区分本次诊断与已有基线，不借失败扩大修复范围。CSS 生成物按包合同构建。
- 局部 UI 按 [UI 验收分档](#ui-验收分档) 取证，不为超出该档的覆盖额外加测；改动面更广或存在具体未解风险时，说明要消除的不确定性再扩大；不因“最后验证”默认跑全主题、全库测试或生产构建。UI、迁移、集成和发布的既有授权边界不变。
- 长期测试保护可观察合同、真实回归、边界或时序，不匹配措辞、源码镜像或无意义转发。用户报告的现象作为事实处理；有合适切入点时用能捕获缺陷的最小复现形成回归，否则以聚焦 smoke 说明缺口。低风险可逆改动不为“有测试”而新建测试。
- 失败先区分产品、测试模型和环境，修直接根因后只重跑失效项。后续代码／环境变化使证据失效、真实失败或新增具体风险才重跑或扩大；叙事更新与新 revision 本身不使有效证据失效。
- 当前目标的所需证据齐全且无范围内未解决缺陷即交付，不为更多截图、报告格式或各 Skill 清单继续检查。命令结果与覆盖边界记录一次；截图／JSON 按复现、交接或用户要求保留，必要但不可恢复的工具输出保留最小持久副本，不默认新建证据包。
- 提交前运行 `git diff --cached --check`。既有失败与本次失败分开报告，不能把“focused 通过”写成“全量通过”；远端登记 Issue 仍需授权。

## 浏览器工具

- OMP 默认使用内置 `browser.open`、`tab.observe` 与 `tab.run`。只有内置能力不可用、存在具体能力缺口或用户指定 CLI 时，才使用 `playwright-cli`；无内置浏览器的宿主可以直接使用 CLI。
- 页面业务失败不构成换工具的理由；先区分产品、环境和工具问题。备用工具不自动授权安装依赖、修改全局配置、连接用户登录态或迁移数据。
- 普通 UI 运行验证不自动升级为完整人工评测：Agent 用内置浏览器自检属日常验证，不需要额外授权；用真实数据跑完整用户旅程的人工评测按 [人工评测](manual-eval/README.md) 单独取得授权，不得用 focused 测试冒充未执行的浏览器场景。

### UI 验收分档

浏览器取证按改动面分档，做到本档要求即可，不默认扩到全主题、全视口：

| 改动面 | 必备取证 |
| --- | --- |
| 普通 UI 改动 | 走实际交互路径（点击、输入、跳转等），核对一个代表状态 |
| 主题变量或窄屏布局 | 追加受影响的主题组合或 390px 视口 |
| nb-ui 共享基础组件 | 主题轴 × 配色轴四组合（nbook/macos × light/dark），外加 390px 视口 |

- 每项给出实测结果（元素计算样式 ↔ 同名变量解析值、几何、交互前后差异），不用静态推断或截图观感冒充实测；内置浏览器确实做不到时如实说明未做，并按本节首条选择工具。
- 分档只决定取证范围；人工评测的授权要求见本节「普通 UI 运行验证不自动升级为完整人工评测」一条。

## 应用包真实模型 smoke（`test:real-model`）

`bun run test:real-model`（等价 `bun run --cwd packages/neuro-book test:real-model`）是应用包唯一会真实调用
Provider 的测试入口：独立配置 `packages/neuro-book/vitest.real-model.config.ts` 只收集
`packages/neuro-book/scripts/smoke/real-model/**`，默认门禁（`bun run --cwd packages/neuro-book test`）显式排除该目录，常规测试零模型调用。

- **凭据**：从仓库根 dotenv（`.env`，含 `.env.local` / `.env.real-model*` 变体）白名单注入测试进程（`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_API_BASE`）；缺凭据的用例 skip 并在证据中记为「未验证」，不得写成通过。`REAL_MODEL_SMOKE_MODEL` 可覆盖模型（默认 `deepseek/deepseek-flash`）。
- **隔离**：测试使用独立 State Root 与临时 workspace；写入的全局配置只落在本 run 的隔离根内（缺少 `NEURO_BOOK_STATE_ROOT` 时直接拒绝写入），POSIX 下收紧为 0600，随 run teardown 删除。
- **外部前置**：HTTP 与写作 workflow 用例需要已启动的 dev server（`AGENT_HTTP_BASE_URL`，默认 `http://localhost:3000`），仅网络层不可达时 skip，已监听但接口失败按测试失败暴露；workflow 用例还需 `REAL_MODEL_SMOKE_PROJECT` 与 `REAL_MODEL_SMOKE_CHAPTERS`（缺一即 skip），写盘场景仅在显式设置 `REAL_MODEL_SMOKE_WRITE_CHAPTER` 时执行。
- **与 smoke CLI 的关系**：`smoke:agent`、`smoke:agent-http`、`smoke:writing-workflow` 面向手工单次执行、失败即退出；测试命令提供统一入口与 skip 语义。两者共用 `packages/neuro-book/scripts/smoke/` 的装配与运行函数。
- **CI**：默认工作流不运行该命令（无外部凭据）；发布或人工验收需要时手动执行。

## 通用包测试合同（2026-09-11）

适用于 `packages/agent-*` 这类领域无关通用包；由 Issue #193 的 `D-TEST-01` 决定（记录见 `.agents/works/w00002-neuro-agent-harness-redesign/tasks/t01-product-host-success-research/walkthroughs/006-decision-record.md`）。与本文其余规则叠加，冲突时以本节为准。

2026-09-22 修订：运行器统一为 Bun 自带测试器，原“每包一份 `vitest.config.ts`、`setupFiles` 指向测试支持包”的要求作废；`nb-session`/`nb-profile`/`nb-harness` 已按 `bun test` 实现并发运。

- **TDD**：新行为先写失败测试（RED）→ 最小实现（GREEN）→ 重构；bug 修复先写复现测试。
- **只测关键**：覆盖公共合同、边界与上限、失败与恢复、并发与顺序、资源释放；不写镜像实现、措辞或框架行为的测试；不为可逆小改动强制测试。
- **Smoke 必测**：每个包至少一条 smoke（包入口可导入 + 一条最小真实路径）。
- **分层**：L1 纯函数单元 / L2 公共合同 / L3 组件集成（内存假件）/ L4 真实进程与 IO——包内必须有 L1–L3，L4 至少覆盖一条真实边界；L5 宿主验收不属于包。
- **放置与运行**：测试放在包内（`src/**` 或 `tests/**`，与被测源码同包）；运行器用 Bun 自带测试器 `bun test`，不引入 vitest 配置；包脚本 `test`/`typecheck` 可独立执行（`bun run --cwd packages/<pkg> test`）；导入使用包内相对路径或包名，禁止 `nbook/*` 等产品别名；不得依赖产品 workspace、Prisma 或 `@earendil-works/pi-*`。
- **真实 LLM 不 mock**：需要 LLM响应的测试直接调用真实 DeepSeek（`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_API_BASE`）；不要伪造 LLM API 数据。凭据只放仓库根 `.env`（已被忽略）或 CI secret，不落盘、不打印、不进用例名。缺凭据时 skip 并在证据中记为“未验证”，不得写成通过；断言结构化结果（状态、字段形状、finish 原因），不断言措辞。
- **测试支持**：`@notnotype/neuro-book-test-support` 仅作 devDependency；包若离开本仓需自带等价物。

## Component Lab 夹具规范

1. **舞台画布（Stage Box）纯净性准则**：
   - 夹具在画布区使用 `data-lab-subject` 标记被测零件，Lab 据此画高亮描边。
   - **画布区严禁拼接非本组件自有的辅助 Chrome**：例如切换语言、外部更新、触发重做/撤销等测试辅助按钮，必须统一部署到 `<LabFixtureControls>` 中，由 Lab 底部抽屉面板通过 Teleport 承载，保持舞台画布（`data-lab-subject` 所在区域）仅呈现目标组件自身真实像素。
   - **单零件检视原则**：单个原子零件夹具（如 `EditorTabItem`）画布内仅呈现单一被测原子，严禁在原子夹具内私自拼接多项列表；细分状态一律通过数据属性、场景切换及 `<LabFixtureControls>` 交互开关表达。

