**1. 结论**
已完成生产归档 crc32 修复。要求的完成标准 1–3 已满足；lifecycle 命令退出 1 仅因预期保留的 L3 `drain-new-request` 失败。

全部证据位于 [t35 证据目录](/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t35-archive-crc32-bundle/evidences)。

| 完成标准 | 已验证结果 | 完整输出 |
|---|---|---|
| 1：新增产物检查 | 修复前退出 1，修复后退出 0 | `archive-check-before.log`、`archive-check-after.log` |
| 2：相关测试与指定类型检查 | 6 个测试文件、26 个测试通过；两条应用类型检查均退出 0、0 错误 | `build-tests-first.log`、`build-tests-plugin.log`、`scripts-typecheck.log`、`typecheck.log` |
| 3：含生产构建的 L1/L3/L4 | L1 通过；L3/L4 在途下载通过；产品日志无 crc32、unsigned 或 uncaughtException 记录 | `product-lifecycle-build.log`、`lifecycle-smoke.log`、`lifecycle-report.json`、`L3-plugins.jsonl`、`L4-plugins.jsonl` |

| 场景 | 各子断言 |
|---|---|
| L1 | `L1-login`、`L1-create-project`、`L1-seed-files`、`L1-workbench-files` 全通过 |
| L3 | `drain-new-request` 失败：无法连接，状态记录为 0；`inflight-complete`、`process-exit-and-lease`、`close-order` 全通过 |
| L4 | `drain-new-request`、`inflight-complete`、`process-exit-and-lease`、`control-stop`、`close-order` 全通过 |

L3/L4 分别收到 `134309639` / `134314820` 字节，均 EOF=true、无读取错误、进程退出 0、lease 已释放；L4 stop=graceful。验收镜像 `imageId=sha256:4ae24351c7eef12b580ab744d2c2731dc1fc45e990f9e2ee609508907a1c102e`；身份与验证范围见 `verification-summary.json`。

**2. 根因**
错误发生在 `patch-nitro-runtime-deps.mjs` 调用 `bundleProductRuntime()` 的 esbuild 后处理，不是 Nitro Rollup：完整 raw 产物仍外部导入 `yazl/index.js`，见 `nitro-raw-archive-imports.txt`；实际 Nitro API 探针见 `nitro-raw-probe.mjs`。
共享 `product-reproducible-bundle.ts:27` 设置 `conditions: ["bun", "node", "import", "module"]`，把 `import` 全局激活。`buffer-crc32` 的 exports 中 import 在 require 前，故 yazl 的 `require-call` 被解析到 `dist/index.mjs`，见 `resolver-before.json`。
旧实际产物为 `JOo={};qA(JOo,{default:()=>$_g})`、`POo=(YOo(),ct(JOo))`，调用 `POo.unsigned(A,this.crc32)`；unsigned 在 default 函数上，不在命名空间上。修复后为 `POo=YOo()`、`JOo.exports=$_g`。两份实际代码证据为 `product-before-crc32.txt`、`product-after-crc32.txt`。条件语义依据：[esbuild 官方文档](https://esbuild.github.io/api/#how-conditions-work)。

**3. 修复**
在现有 `productRuntimeCompatibilityPlugin()` 的 onResolve 边界，仅对 `buffer-crc32` 的 `require-call` 使用 `createRequire(args.importer || import.meta.url).resolve(args.path)`，按调用者选择公开 CJS 入口；解析失败直接使构建失败。
选择这一层因为错误就在 Product 链接器，且仓库已有同一插件处理依赖互操作。未修改依赖源码、业务调用、Nitro 配置或全局 conditions；ESM 导入及其它依赖保持原解析策略，避免顺带修复报告范围之外的依赖。

**4. 新增检查**
`product-reproducible-bundle.test.ts` 用正式 bundler 与 compatibility plugin 生成真实 `.mjs`，在隔离 Temp 中由 Bun 执行。缓冲区和两个数据块的流各生成一个 ZIP 条目，核对中央目录 CRC=`0xcbf43926`、长度=9、条目名及解压内容=`123456789`。
修复前同一检查因 `TypeError: V.unsigned is not a function` 失败，修复后通过。复跑命令：`bun x vitest run --config scripts/vitest.config.ts scripts/build/product-reproducible-bundle.test.ts -t '执行真实 Product bundle'`。
删除该文件原有的构建源码文本断言，改由真实产物行为保护。相关测试首轮 24 通过、2 失败，原因是既有 plugin 测试漏导入 `testHostPath`；补公开导入后重跑该文件，3 个测试全部通过，未放宽断言。

**5. 同类排查**
已审计完整 raw server 图的 4101 个输入，以及命令、Profile worker 和 yazl 图的 4339 个输入；native islands 不经此 bundler，未据此声明全依赖无问题。证据为 `dual-entry-audit-before.json`、`dual-entry-audit-after.json` 及对应 metafile。
确认另一个同类缺陷：`json-bigint` 1.0.0 的 parse/stringify `require("bignumber.js")` 解析为 `bignumber.js` 9.3.1 的 ESM 命名空间。修复后产品仍有 `var Lto=(Vhe(),ut(Whe))` 并对 Lto 执行 instanceof；真实 bundle 大整数解析报 `TypeError: Object is not a constructor`。见 `product-bignumber-risk.txt`、`bignumber-interop-probe.log`，未修复。
其余 require→ESM 边集中于 `@smithy/core`、`@aws-sdk/core`、`@aws-sdk/nested-clients`、`gaxios`，目标使用命名导出；`tslib` 含 default 但调用方使用命名 helper，且没有独立 require 条件，不属于本次默认函数/构造器错取模式。未调用真实 Provider/Model。

**6. 改动文件**
- `.worktree/w00017-runtime-foundation/scripts/build/product-bundle-plugins.ts`：定向 CJS 入口解析。
- `.worktree/w00017-runtime-foundation/scripts/build/product-reproducible-bundle.test.ts`：真实 ZIP 产物回归检查，移除源码文本断言。
- `.worktree/w00017-runtime-foundation/scripts/build/product-bundle-plugins.test.ts`：补缺失的公开 fixture 导入。
- t35 `evidences/**`：完整命令输出、解析图、产物片段、lifecycle 日志与截图、本汇报；未修改 Work/Task、README、docs、package.json、锁文件或开发者研究 README。

**7. 禁止清单自查**
1. 通过：不按错误文案分支，不新增静默 catch；解析按 `args.kind` 分支，解析失败保留诊断。
2. 通过：未跳过用例、放宽断言、改报失败或加入产品测试分支；L3 已知失败如实保留，`-t` 仅用于红绿聚焦检查。
3. 通过：无任务外源码、配置或注释改写；仅在允许范围补 fixture 导入并替换无效文本测试。
4. 通过：保留原有资源清理与收口；新增测试 finally 清理 Temp，无第二运行路径或不可达代码。
5. 通过：永久代码只使用包公开入口，无跨包源码深导入；CJS 文件路径由公开条件解析返回。
6. 通过：使用现有 plugin、Vitest 与生产 smoke 自然路径完成检查，没有以“无法做到”替代验证。
另：未 commit、push、stash、切分支或改 Git 配置；未设置 http_proxy、时区或 locale；未跑全量 `bun run test`。本次临时探针已清理，见 `temporary-cleanup.json`。

**8. 后续注意**
- L3 新请求排空仍失败；归档 staging 清理、停止来源汇合、自有宿主入口与内核恢复均未改动。
- `json-bigint` → `bignumber.js` 已有真实失败证据，需要独立 Task；本次刻意保留全局解析策略。
- 额外根脚本 typecheck 退出 2：`auth.ts` 缺 Nuxt 自动导入声明，11 错误；额外改动文件 typecheck 退出 2：既有 `Map.get(args.path)` 字面量键类型错误，1 错误。分别见 `build-scripts-typecheck.log`、`changed-files-typecheck.log`；两条指定应用 typecheck 均通过，未修改这些既有边界。
- 本次仅实测 Linux x64；全量测试由主 Agent 执行，未用聚焦通过冒充全量或跨平台通过。
- 踩坑回写建议：共享构建器启用全局解析条件前核对 require/import 消费者，并以真实产物验证默认导出互操作；拟写入 `docs/standards/code/tooling.md`，见 `reflection-proposal.json`，仅交主 Agent 汇总，未回写。
