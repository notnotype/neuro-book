/**
 * 产品版本：内置插件的版本、第三方插件 `engines.neurobook` 的兼容检查都以它为准（ADR 0027，
 * docs/specs/runtime/plugin-install.md）。
 *
 * 写成常量而不是读 `package.json`：前端构建与服务端都引用它，不必把整份包清单打进页面。与包 `package.json` 的
 * `version` 保持一致，由 `product.test.ts` 核对。
 */

export const PRODUCT_VERSION = "0.13.0";

/** 发布阶段：canary（早期验证版）→ preview（预览版，也叫测试版）→ stable（稳定版），规则见 ADR 0053。 */
export type ProductStage = "canary" | "preview" | "stable";

/**
 * 这一版产品所处的阶段，随提版一起改（`bun run release:prepare <版本> --stage <阶段>`）。版本号本身不带阶段：
 * 发布流水线的标签门禁读这里，GitHub Release 的标题与说明按它写。
 */
export const PRODUCT_STAGE: ProductStage = "canary";

/** 支持的 Bun 版本范围，与包 `package.json` 的 `engines.bun` 相同。`npm` 与 `bun add` 都不拦低版本，`nbook` 入口自己核对。 */
export const BUN_ENGINE = ">=1.3.14";
