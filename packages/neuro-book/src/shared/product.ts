/**
 * 产品版本：内置插件的版本、第三方插件 `engines.neurobook` 的兼容检查都以它为准（ADR 0027，
 * docs/specs/runtime/plugin-install.md）。
 *
 * 写成常量而不是读 `package.json`：前端构建与服务端都引用它，不必把整份包清单打进页面。与包 `package.json` 的
 * `version` 保持一致，由 `product.test.ts` 核对。
 */

export const PRODUCT_VERSION = "0.12.1";

/** 支持的 Bun 版本范围，与包 `package.json` 的 `engines.bun` 相同。`npm` 与 `bun add` 都不拦低版本，`nbook` 入口自己核对。 */
export const BUN_ENGINE = ">=1.3.14";
