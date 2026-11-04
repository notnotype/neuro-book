# @notnotype/neuro-book-test-support

各包测试共用的支持代码，只进 `devDependencies`，不发布到 npm：

- `./tmp`、`./paths`、`./test-path`：系统临时目录下的测试根与 Agent 的临时路径，测试不在仓库里写数据（[测试与验收](../../docs/testing/README.md)）；
- `./vitest`：Vitest 的 globalSetup 与 setupFiles；
- `./wait`：等可观察的状态，不按固定时长等；
- `./llm`：真实模型测试（`*.llm.test.ts`）的开关与凭据读取；
- `./import-boundary`：扫描包的导入边界，给依赖方向的机检用；
- `./style-tokens`：扫描前端包的样式写法，规则共用，各包只写扫描目录与带理由的豁免。

许可证：AGPL-3.0-only，见仓库根的 [LICENSE](../../LICENSE)。
