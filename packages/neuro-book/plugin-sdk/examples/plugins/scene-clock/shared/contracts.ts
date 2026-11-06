/**
 * `example.scene-clock` 的身份：id、版本，以及它只在浏览器里有入口（场景是窗口里画的）。读法同 `../../clock/shared/contracts.ts`。
 */

import {definePlugin} from "@notnotype/nb-plugin-sdk";

export const plugin = definePlugin({id: "example.scene-clock", version: "0.1.0", locations: ["browser"]});

/**
 * 场景提供者的贡献 id：插件 id 加 `.` 加短名。主题（`plugin.ts`）与入口（`web/plugin.ts`）都用它，所以写在合同模块里；入口用同一个
 * 短名建提供者，场景测试核对两边拼出的 id 相同。
 */
export const SKY_PROVIDER_NAME = "sky-painter";
export const SKY_PROVIDER = "example.scene-clock.sky-painter";
