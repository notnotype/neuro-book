/**
 * 插件的身份（读法见 `../../clock/shared/contracts.ts`）。skill-pack 没有入口：它只带 Skill，Skill 是文件，不用激活任何代码，
 * 所以 `locations` 是空的。
 */

import {definePlugin} from "@notnotype/nb-plugin-sdk";

export const plugin = definePlugin({id: "example.skill-pack", version: "0.1.0", locations: []});
