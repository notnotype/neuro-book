# 审查意见 1

根因定位与定向修复方向正确，真实 ZIP 产物检查写得好，`product-bundle-plugins.test.ts` 补上缺失的 `testHostPath` 导入也是对的（HEAD 上该文件用了它却没导入）。先用 `git status` 与 `git diff` 核对现状，再处理下面两项。

## 必须修改

1. **恢复被删除的已有测试。** `scripts/build/product-reproducible-bundle.test.ts` 删掉了“正式 Product builders 在同一个 esbuild graph 中完成链接与压缩”。它检查四个正式打包器不调用 `Bun.build(`、都经 `bundleProductJavaScript`，新加的 ZIP 检查并不覆盖这件事，汇报里“改由真实产物行为保护”不成立。按 `HEAD` 原样恢复（含 `readFile` 导入），新测试保留并列存在。
2. **一并修复 `json-bigint` → `bignumber.js`。** 它与 crc32 是同一个根因（全局 `import` 条件把 `require` 解析到 ESM 入口），你已有真实失败证据（`product-bignumber-risk.txt`、`bignumber-interop-probe.log`），修法相同：
   - 把定向解析扩展到 `bignumber.js` 的 `require-call`，两个包名写成一处带注释的清单，注释说明入选条件（该包同时提供 `import` 与 `require` 入口，`require` 方取的是默认导出或构造器）；
   - 在 `product-reproducible-bundle.test.ts` 加一条真实产物检查：经 `bundleProductJavaScript` 与兼容插件打包一段用 `json-bigint` 解析大整数的代码并用 Bun 执行，核对解析结果是 BigNumber 且数值不丢精度；修复前失败、修复后通过，两次输出都保存到证据目录；
   - 在汇报里补充 `json-bigint` 在产品中的实际使用路径（例如经 `gcp-metadata` 等），说明这个缺陷在生产中会影响哪些功能。

## 验证

- `bun x vitest run --config scripts/vitest.config.ts scripts/build/product-reproducible-bundle.test.ts scripts/build/product-bundle-plugins.test.ts`：全部通过；
- 在 `packages/neuro-book` 下 `bun run scripts:typecheck`；
- 在 `packages/neuro-book` 下 `bun run smoke:product-lifecycle -- --only L1,L4 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report-2.json`（含生产构建）：L1、L4 通过。
- 一次只跑一个重任务；构建期间不要改动 worktree。

完成后更新证据目录的 `delivery.md`（保留原内容，追加“返工 1”一节），再输出返工部分的汇报。
