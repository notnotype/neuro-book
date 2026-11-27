/**
 * 产品版本：内置插件的版本、第三方插件 `engines.neurobook` 的兼容检查都以它为准（ADR 0027，
 * docs/specs/runtime/plugin-install.md）。
 *
 * 写成常量而不是读 `package.json`：前端构建与服务端都引用它，不必把整份包清单打进页面。与包 `package.json` 的
 * `version` 保持一致，由 `product.test.ts` 核对。
 */

export const PRODUCT_VERSION = "0.18.0";

/**
 * 插件 API 的兼容起点：从这个产品版本起，插件能用的接口（SDK 公开面、内置插件导出的服务与合同、宿主共享的模块）没有不兼容的
 * 改动。第三方插件的 `engines.neurobook` 与“起点到当前版本”有交集就算兼容，所以产品提版而插件 API 没破时，已构建的插件不用
 * 重新构建（docs/specs/runtime/plugin-api.md 的“兼容”）。插件 API 有不兼容的改动时，发版前把它改成那一版（发布手册的“发版”）。
 *
 * 0.12.1：0.12.0 到 0.12.1 之间 nb-ui 有改名（nb-ui 的 migration-0.4），0.12.1 之后只有新增。
 */
export const PLUGIN_API_SINCE = "0.12.1";

/** 发布阶段：canary（早期验证版）→ preview（预览版，也叫测试版）→ stable（稳定版），规则见 ADR 0053。 */
export type ProductStage = "canary" | "preview" | "stable";

/**
 * 这一版产品所处的阶段，随提版一起改（`bun run release:prepare <版本> --stage <阶段>`）。版本号本身不带阶段：
 * 发布流水线的标签门禁读这里，GitHub Release 的标题与说明按它写。
 */
export const PRODUCT_STAGE: ProductStage = "canary";

/** 支持的 Bun 版本范围，与包 `package.json` 的 `engines.bun` 相同。`npm` 与 `bun add` 都不拦低版本，`nbook` 入口自己核对。 */
export const BUN_ENGINE = ">=1.4.4";
