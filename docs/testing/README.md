# NeuroBook 测试规范

本文件是仓库测试、临时根、环境和验收约定的真相源。测试编写、运行器配置、fixture 和验收脚本遵守这里；规则冲突时先更新本文件。`AGENTS.md` 的“测试”一节只摘要最核心的几条，正文以本文件为准。

## 测试写法

**测行为，不测实现。** 断言调用方或用户能观察到的结果：重复下单不重复扣款，而不是某个方法被调用了几次。行为没变的重构让测试失败，说明测试写错了。以下两类测试有害：

- **同义反复**：期望值由被测代码本身或同一份逻辑算出，替身返回什么就断言什么。
- **变更探测**：断言内部调用顺序、私有状态、措辞、快照或偶然的默认值，任何重构都会让它失败。

**先列场景与失败方式，再写实现。** 有 Spec 时，验收场景与“失败与恢复”逐条就是测试清单；没有 Spec 的模块先写出它会怎样失败。测试名写可观察的行为，能对应 Spec 场景时标出场景编号。写完实现再照着实现补测试，容易只证明“代码做了它做的事”，漏掉没想到的失败路径。

**bug 修复的测试。** 先确认 bug 暴露的是哪条行为的覆盖缺口：有缺口就在那条行为的测试里补用例（修复前失败、修复后通过）；没有缺口（已有测试本该抓到却写错了）就改那条测试，不另加只针对这个 bug 的测试。

**依赖用真的。** 文件系统、子进程、端口、SQLite 能用真的就用真的。外部系统不便接入时注入替身（fake），并且要有一条测试证明替身与真实系统的行为一致，否则替身会掩盖真实行为（例如同步触发运行时只会异步派发的事件）。真实模型的调用不伪造，见[真实模型测试](#真实模型测试)。

**不按固定时长等待。** 等一个可观察的状态成立（`@notnotype/neuro-book-test-support/wait` 的 `waitUntil`），或让被测代码接受注入的时钟、由测试推进时间。让出一轮事件循环（延迟为 0）不算等待。

**覆盖率用来找缺口，不设门槛。** 看哪些失败路径没测、为什么没测。Bun 只报函数与行覆盖率，子进程里执行的代码也不计入，数字会低估进程级测试。

**机检规则。** `governance:check` 检查测试文件（`scripts/ci/test-conventions.ts`）：`packages/neuro-book` 与 `packages/nb-runtime` 违反即失败，其它包给警告。

| 规则 | 拦截 | 代替做法 |
| --- | --- | --- |
| `module-mock` | `mock.module`、`vi.mock`、`jest.mock` | 真实实现，或对过契约的替身 |
| `spy` | `spyOn` | 断言可观察结果 |
| `fixed-wait` | 非零延迟的 `Bun.sleep`、`setTimeout` | `waitUntil` 或注入时钟 |
| `focus-or-skip` | `it/test/describe` 的 `.only`、`.skip`、`.todo` | 按条件跳过用 `skipIf`、`runIf` |
| `snapshot` | 快照断言 | 断言具体字段 |
| `llm-credential` | `*.llm.test.ts` 以外读取模型凭据 | 放进 `*.llm.test.ts` |

确有理由的例外在同一行或上一行写 `// test-lint-allow <规则>: <理由>`；整个文件都是规则样例时在文件开头写 `// test-lint-allow-file: <理由>`。理由不能为空。

**什么时候写测试。** Spec 的验收场景与失败方式、公开合同、边界与上限、并发与顺序、资源释放必须有测试；低风险、可逆的小改动不为“有测试”而新增测试。

## 测试分类与运行

按成本与外部依赖分类，而不是按“单元 / 集成”分：

| 类别 | 内容 | 包脚本 | 什么时候跑 |
| --- | --- | --- | --- |
| 快速 | 同进程测试与几十毫秒级的子进程测试；可以用真文件、真端口 | `test` | 每次改动，按受影响范围 |
| 浏览器 E2E | 真浏览器，从用户入口到可见结果 | `test:e2e` | Task 验收、CI |
| 真实模型 | 调用真实模型，见下一节 | `test:llm` | 显式运行，按受影响范围增量；CI 定期 |
| 全量 | 以上全部 | — | CI 定期 |

快速类单个测试的预算是 200 毫秒。`test:affected` 运行结束时列出超出预算的测试；超出的原则上改快（多半是固定等待或不必要的大数据），确实需要慢的（如性能基准）写明原因。

`bun run test:affected` 的选择方式：

- 缺省按改动：改动所在的包，加上直接或间接依赖它的包；根 `scripts/`、workflow 或根 `package.json` 有改动时加上根脚本测试；`bun.lock`、`bunfig.toml` 或 `patches/` 有改动时选中全部。`--since <rev>` 再算上与 `<rev>` 分叉以来的提交，`--all` 选中全部。
- `--package <名>`（可重复）：不看改动，只测指定的包，`scripts` 指根脚本测试；加 `--with-consumers` 连同依赖它的包。
- `--tier fast|e2e|llm`：运行哪一类，缺省 `fast`。
- `--files`：改动所在的包只跑受影响的测试文件（测试脚本是单条 `bun test` 时，追加 Bun 的 `--changed`）。Bun 按导入关系选文件，不跨包追踪，依赖方的包仍整包运行；只经路径启动的文件（例如子进程入口）改了也选不到，提交前去掉 `--files` 再跑一次。
- `--typecheck` 同时跑类型检查，`--dry-run` 只列出选中项和原因。

包内再缩小到文件时，在包目录把测试文件路径传给 `bun run test <路径>`。

## 真实模型测试

- **命名与开关**：会调用真实模型的测试放在 `*.llm.test.ts`，用 `@notnotype/neuro-book-test-support/llm` 的 `llmTestConfig()` 取配置，并以 `describe.skipIf(config === null)` 包住。只有显式设置 `NBOOK_LLM_TESTS=1` 才运行，是否调用模型由运行者的意图决定，不由环境里碰巧有没有凭据决定。包脚本 `test:llm` 设置开关并只运行这些文件；默认的 `test` 里它们显示为跳过。
- **凭据**：先看进程环境，没有时只从仓库根 `.env` 读 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_BASE`、`REAL_MODEL_SMOKE_MODEL` 三个键；`REAL_MODEL_SMOKE_MODEL` 可覆盖模型（缺省 `deepseek/deepseek-flash`）。凭据不落盘、不打印、不进用例名。开关打开却缺凭据时用例跳过，证据记为“未验证”，不写成通过。
- **断言**：断言结构化结果（状态、字段形状、工具调用、落盘内容），不断言措辞。
- **何时运行**：真实模型调用会产生费用，运行前取得开发者授权（见 [`.omp/RULES.md`](../../.omp/RULES.md)）。改到模型相关代码的 Task 验收时，用 `bun run test:affected --tier llm`（加 `--files` 只跑受影响的文件）；CI 定期或手动运行，默认工作流不运行（没有外部凭据）。
- **隔离**：测试使用独立的临时根；写入的配置只落在本次运行的隔离根内，结束时删除。

## 临时目录与环境键

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

- 测试文件与被测源码同目录，命名 `<module>.test.ts`；服务端需要 JSX 时用 `.test.tsx`；真实模型测试用 `<module>.llm.test.ts`。
- 新应用与新包用 Bun 自带测试器（`bun test`），不引入 Vitest 配置；以下 Vitest 条目只适用于仍用 Vitest 的既有包。
- 每个 Vitest 配置显式声明 `root`（仓库根或包根），不依赖 `process.cwd()`；include 覆盖
  该作用域内全部测试文件。
- Vitest 包的全量测试统一用包脚本 `bun run --cwd packages/<pkg> test`（node 运行时）。`bun --bun` 直接运行 vitest 时部分依赖
  （如 zod）的 CJS/ESM interop 与 node 不同，过滤单文件可能误报
  `zod does not provide an export named 'z'`；以 node 运行时为准。
- 测试含宿主专有模块的入口时，在对应宿主的真实子进程中验证行为；不要直接导入另一宿主的测试运行器，以免模块加载失败替代业务回归。
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

## 验证门禁

- 实施前确定当前目标的可观察行为、直接受影响边界与完成证据；有 Task 时写入快照，否则使用会话计划，不强制创建额外文件。
- 纯文档修改检查链接、结构与语义，不运行产品测试、typecheck、构建或浏览器；治理脚本变化仅运行直接相关脚本测试与类型检查。
- 实现变化运行受影响既有测试；类型表面改变才运行对应 typecheck。工具只支持全应用检查时运行一次，区分本次诊断与已有基线，不借失败扩大修复范围。CSS 生成物按包合同构建。
- 受影响的测试用 `bun run test:affected` 选出并运行，选择方式见[测试分类与运行](#测试分类与运行)；不默认跑全量。
- `docs:check` 与 `governance:check` 的失败始终检查全仓；警告默认只逐条列出未提交改动涉及的文件，其余合成一行计数。上面三个命令都按同一改动范围工作：默认是未提交的改动（含未跟踪文件），`--since <rev>` 再算上与 `<rev>` 分叉以来的提交，`--all` 不按改动裁剪。
- 局部 UI 按 [UI 验收分档](#ui-验收分档) 取证，不为超出该档的覆盖额外加测；改动面更广或存在具体未解风险时，说明要消除的不确定性再扩大；不因“最后验证”默认跑全主题、全库测试或生产构建。UI、迁移、集成和发布的既有授权边界不变。
- 长期测试按[测试写法](#测试写法)保护可观察合同、边界与时序。用户报告的现象作为事实处理；bug 修复的测试按该节“bug 修复的测试”判断加在哪里，没有合适切入点时以聚焦 smoke 说明缺口。
- 失败先区分产品、测试模型和环境，修直接根因后只重跑失效项。后续代码／环境变化使证据失效、真实失败或新增具体风险才重跑或扩大；叙事更新与新 revision 本身不使有效证据失效。
- 证据文件里记录的命令要能原样重跑出其中的结果；用了过滤或统计的，把完整命令写进去，不用占位说明代替。
- 当前目标的所需证据齐全且无范围内未解决缺陷即交付，不为更多截图、报告格式或各 Skill 清单继续检查。命令结果与覆盖边界记录一次；截图／JSON 按复现、交接或用户要求保留，必要但不可恢复的工具输出保留最小持久副本，不默认新建证据包。
- 验收脚本在构建失败等原因导致检查没有执行时，必须以非零退出；调用方除了看退出码，还要核对报告里没有未判定的项。
- 提交前运行 `git diff --cached --check`。既有失败与本次失败分开报告，不能把“focused 通过”写成“全量通过”；远端登记 Issue 仍需授权。

## 浏览器工具

- 优先使用宿主内置、运行在隔离浏览器配置中的浏览器自动化（如 OMP 的 `browser.open`、`tab.observe`、`tab.run`）。宿主没有这类能力、内置能力存在具体缺口或用户指定 CLI 时，使用 `playwright-cli`。
- 页面业务失败不构成换工具的理由；先区分产品、环境和工具问题。任何浏览器工具都不自动授权安装依赖、修改全局配置、接入用户日常浏览器及其登录态或迁移数据；直接驱动用户浏览器的集成（如 Claude Code 的 Claude in Chrome）只在用户明确要求时使用。
- 普通 UI 运行验证不自动升级为完整人工评测：Agent 用上述工具自检属日常验证，不需要额外授权；用真实数据跑完整用户旅程的人工评测需单独取得授权，不得用 focused 测试冒充未执行的浏览器场景。

### UI 验收分档

浏览器取证按改动面分档，做到本档要求即可，不默认扩到全主题、全视口：

| 改动面 | 必备取证 |
| --- | --- |
| 普通 UI 改动 | 走实际交互路径（点击、输入、跳转等），核对一个代表状态 |
| 主题变量或窄屏布局 | 追加受影响的主题组合或 390px 视口 |
| nb-ui 共享基础组件 | 主题轴 × 配色轴四组合（nbook/macos × light/dark），外加 390px 视口 |

- 每项给出实测结果（元素计算样式 ↔ 同名变量解析值、几何、交互前后差异），不用静态推断或截图观感冒充实测；所用工具做不到时按本节首条改用备用工具，仍做不到的如实说明未做。
- 分档只决定取证范围；人工评测的授权要求见本节「普通 UI 运行验证不自动升级为完整人工评测」一条。

## 通用包测试合同（2026-09-11）

适用于 `packages/agent-*` 这类领域无关通用包；由 Issue #193 的 `D-TEST-01` 决定（记录见 `.agents/works/w00002-neuro-agent-harness-redesign/tasks/t01-product-host-success-research/walkthroughs/006-decision-record.md`）。与本文其余规则叠加；2026-10-03 起测试写法以[测试写法](#测试写法)为准。

2026-09-22 修订：运行器统一为 Bun 自带测试器，原“每包一份 `vitest.config.ts`、`setupFiles` 指向测试支持包”的要求作废；`nb-session`/`nb-profile`/`nb-harness` 已按 `bun test` 实现并发运。

- **先写测试**：新行为先写失败测试再实现；场景、失败方式与 bug 修复按[测试写法](#测试写法)。
- **只测关键**：覆盖公共合同、边界与上限、失败与恢复、并发与顺序、资源释放；不写镜像实现、措辞或框架行为的测试；不为可逆小改动强制测试。
- **Smoke 必测**：每个包至少一条 smoke（包入口可导入 + 一条最小真实路径）。
- **分层**：L1 纯函数单元 / L2 公共合同 / L3 组件集成（替身须与真实实现对过契约）/ L4 真实进程与 IO——包内必须有 L1–L3，L4 至少覆盖一条真实边界；L5 宿主验收不属于包。
- **放置与运行**：测试放在包内（`src/**` 或 `tests/**`，与被测源码同包）；运行器用 Bun 自带测试器 `bun test`，不引入 vitest 配置；包脚本 `test`/`typecheck` 可独立执行（`bun run --cwd packages/<pkg> test`）；导入使用包内相对路径或包名，禁止 `nbook/*` 等产品别名；不得依赖产品 workspace、Prisma 或 `@earendil-works/pi-*`。
- **真实 LLM 不 mock**：需要模型响应的测试调用真实模型，不伪造 API 数据；命名、开关与凭据见[真实模型测试](#真实模型测试)。
- **测试支持**：`@notnotype/neuro-book-test-support` 仅作 devDependency；包若离开本仓需自带等价物。

## Component Lab 夹具规范

1. **舞台画布（Stage Box）纯净性准则**：
   - 夹具在画布区使用 `data-lab-subject` 标记被测零件，Lab 据此画高亮描边。
   - **画布区严禁拼接非本组件自有的辅助 Chrome**：例如切换语言、外部更新、触发重做/撤销等测试辅助按钮，必须统一部署到 `<LabFixtureControls>` 中，由 Lab 底部抽屉面板通过 Teleport 承载，保持舞台画布（`data-lab-subject` 所在区域）仅呈现目标组件自身真实像素。
   - **单零件检视原则**：单个原子零件夹具（如 `EditorTabItem`）画布内仅呈现单一被测原子，严禁在原子夹具内私自拼接多项列表；细分状态一律通过数据属性、场景切换及 `<LabFixtureControls>` 交互开关表达。

## 用户视角人工评测

旧产品的人工评测体系（判定与证据合同、用户旅程、执行步骤与报告格式）已归档到 [`../archived/testing/manual-eval/`](../archived/testing/manual-eval/README.md)，只作参照；新应用的人工评测在功能足够后另行建立。
