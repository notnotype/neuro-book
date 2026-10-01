---
schema: nbook.task/v2
taskId: t35-archive-crc32-bundle
---

# 修复生产构建中归档下载的 crc32 打包错误

## 目标与范围

[t34](../t34-builtin-service-plugins/README.md) 验收时发现：生产构建中 `yazl` 以 `require("buffer-crc32")` 取到的对象没有 `unsigned`，项目归档下载在 42 字节处抛出未捕获异常；崩溃的请求一直占着 Project 操作，使 SIGTERM 后 Project 无法关闭。这是 `smoke:product-lifecycle` L3、L4 在途下载与关闭顺序失败的原因。本 Task 查明出错的打包步骤，在该层修复，并加一个修复前失败的产物检查。

行为合同未变：修复让生产构建恢复与源码运行一致的归档下载行为。2026-10-01 开发者确认只在 w00017 分支修复，master 等合并后获得。

不做：归档 staging 目录不清理的问题、排空期间返回 503 与停止来源汇合、内核显式恢复问题、升级或替换依赖。

编码由 omp 完成（`@default` 当时把 `openai-codex/gpt-6.1-sol` 误解析成不可用的 `-wm` 变体，改为显式 `aihub/gpt-6.1-sol:max`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**根因**：错误发生在产品后处理的 esbuild 链接（`bundleProductRuntime()`），不在 Nitro 的 Rollup 构建。共享的 `product-reproducible-bundle.ts` 把 `import` 写进全局 `conditions`，`buffer-crc32` 的 `exports` 中 `import` 排在 `require` 之前，`yazl` 的 `require("buffer-crc32")` 因此被解析到 `dist/index.mjs`，取到的是只有 `default` 的模块命名空间。产物代码对比见 [product-before-crc32.txt](evidences/product-before-crc32.txt) 与 [product-after-crc32.txt](evidences/product-after-crc32.txt)。

**修复**：在已有的 `productRuntimeCompatibilityPlugin()` 中，对一份带注释的清单（`buffer-crc32`、`bignumber.js`）里的包，只把它们的 `require-call` 按调用者的 `require` 入口解析；ESM 导入与其它依赖保持原条件，不改全局解析策略。

**同类缺陷（审查中并入本 Task）**：omp 的同类排查发现 `json-bigint` 的 `require("bignumber.js")` 有同样问题，产物里大整数解析会抛 `Object is not a constructor`。这个缺陷的影响链是 `pi-ai → @google/genai → google-auth-library → gcp-metadata → json-bigint`，即 Google Vertex 与 GCP 默认凭据路径。目前产品只开放 `google-generative-ai`，它用显式 API key，不走这条链，所以属于潜在影响（[rework-1-product-impact.json](evidences/rework-1-product-impact.json)）。其余 `require` 到 ESM 入口的边使用的都是命名导出，不属于这一类（[dual-entry-audit-after.json](evidences/dual-entry-audit-after.json)）。

**新增检查**：`scripts/build/product-reproducible-bundle.test.ts` 新增两条真实产物检查，都经正式 bundler 与兼容插件打包后用 Bun 执行：
- 用 `yazl` 生成 ZIP，覆盖缓冲区与分块流两种写法，核对中央目录 CRC、长度与解压内容；
- 用 `json-bigint` 解析大整数，核对结果为 BigNumber 且不丢精度。
两条在修复前都失败（[archive-check-before.log](evidences/archive-check-before.log)、[rework-1-bigint-before.log](evidences/rework-1-bigint-before.log)）。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：
- omp 删除了同文件中“正式 Product builders 在同一个 esbuild graph 中完成链接与压缩”这条源码文本断言。审查要求原样恢复，omp 拒绝，依据是 [`docs/standards/code/common.md`](../../../../../docs/standards/code/common.md) 规定测试不匹配源码字符串。核实规则确实如此，接受删除；这条约束目前没有行为级检查替代。
- `product-bundle-plugins.test.ts` 在 HEAD 上使用了 `testHostPath` 却没有导入，omp 补上了导入并删掉未使用的 `tmpdir`。

返工在验证阶段因系统内存不足被终止，验证由主会话完成，`delivery.md` 只含首轮汇报。两份 esbuild metafile（各约 6 MB）与 500 KB 的审计日志可以重新生成，没有放进证据目录。

**验证**（主会话运行）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `scripts/build/product-reproducible-bundle.test.ts`、`product-bundle-plugins.test.ts` | 2 个文件、7 条全部通过 | [acceptance-test-build.txt](evidences/acceptance-test-build.txt) |
| `scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:product-lifecycle --only L1,L2,L3,L4,L5,L6`（含生产构建） | L1、L2、L4、L5、L6 通过；L3 只有 `drain-new-request` 失败（SIGTERM 后连接被拒，不是 503，属宿主入口切片），在途下载完整、关闭顺序通过；日志中没有 crc32 异常 | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与基线相同，无新增 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |

## 下一步

修复内核显式恢复逐层推进的缺陷（[t34](../t34-builtin-service-plugins/README.md) 已知问题 1），再进入自有宿主入口与 `nbook.http`。
