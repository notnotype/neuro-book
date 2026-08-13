# NeuroBook 测试规范

本文件是仓库测试约定真相源。所有 Vitest 配置、测试编写和验收脚本遵守这里；规则有冲突时以本文件为准，冲突本身按「变更本文件」处理。

## 临时目录与生命周期

**原则：任何人 clone 后运行 `bun run test`，不应在系统 Temp 根、用户目录或项目业务目录留下文件。**

1. **测试临时根统一在 `<系统Temp>/neuro-book-vitest/<runId>/`**：
   - 由 `server/workspace-files/vitest-tmpdir-setup.ts` 在每个 Vitest worker 启动时把
     `TMPDIR`/`TEMP`/`TMP` 指向该目录；测试里 `os.tmpdir()` / `mkdtemp(tmpdir()...)`
     运行期自动收敛；
   - 受控根不放在仓库 `.agent/tmp`：worktree 深路径叠加测试内部 UUID 目录名会超过
     Windows MAX_PATH（git 对象与 release staging 报 "Filename too long" /
     ENAMETOOLONG），系统 Temp 路径最短且 OS 会定期清理；
   - 每次 run 结束由 `server/workspace-files/vitest-global-setup.ts` 的 teardown 删除
     本 run 目录；并行 run 因 runId（8 位 hex）互不干扰；进程被强杀时由下一次 run 的
     setup 按 24 小时超窗兜底回收；
   - 所有 Vitest 配置的 `setupFiles` 第一项必须是该 setup 文件、`globalSetup` 必须包含
     该 globalSetup（含独立包配置）。
2. **测试自身必须清理自己创建的目录**：`afterEach` 收集并 `rm`。清理失败视为测试问题，
   不依赖全局清理兜底。
3. **进程被强杀等异常残留**由 `server/workspace-files/test-tmp-sweep.ts` 的
   `sweepStaleTmpRoots()` 在每次 run 起点回收：无 owner marker 的目录超过 24 小时才回收；
   有 marker 的目录要求 owner 进程已死且超窗。新增「目录 + marker」的测试根应使用
   `createTestTmpRoot(repoRoot, name, purpose)`。
4. **禁止在仓库根、`.worktree/`、快照目录或系统 Temp 创建业务临时数据**；仓库根下的
   `cache/`、`workspace/`、`logs/` 等业务目录不能被测试写入。
5. **脚本（非测试）的临时根**使用仓库 `.agent/tmp/`，并且必须在 `finally` 中清理
   （参见 `packages/neuro-book-manager/scripts/pack-check.mjs`）。
6. **验收/沙盒脚本**默认输出到 `.agent/tmp/<task>-<uuid>/`，禁止把用户公共目录写为默认值；
   需要仓库外路径（如 Windows Sandbox 映射）时通过参数显式传入，并在脚本结尾打印实际路径。

## 测试文件组织

- 测试文件与被测源码同目录，命名 `<module>.test.ts`；服务端需要 JSX 时用 `.test.tsx`。
- 每个 Vitest 配置显式声明 `root`（仓库根或包根），不依赖 `process.cwd()`；include 覆盖
  该作用域内全部测试文件。
- 全量测试统一 `bun run test`（node 运行时）。`bun --bun` 直接运行 vitest 时部分依赖
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

- `prepare-host.ps1` 等宿主机准备脚本：输入/证据默认落在 `<repoRoot>/.agent/tmp/`，
  所有路径可参数化；`.wsb` 等模板文件不得写死本机路径，运行说明要求按脚本输出修改。
- 面向用户的下载产物（如最终 ZIP）不属于测试临时数据：放 `.agent/artifacts/` 或用户
  指定目录，并同时给出 SHA-256 与构建身份（revision/imageId），不与其他 quick 构建混放。

## 验证门禁

- 提交前至少运行：受影响的聚焦测试、对应 typecheck、`git diff --check`。
- 全量 `bun run test` 中的既有 advisory 失败（如 Harness 黑盒超时）单独登记 Issue，
  不能把「focused 通过」写成「全量通过」。
