/**
 * 插件的身份（读法见 `../../clock/shared/contracts.ts`）。word-stats 只在服务端有入口：方法的实现在那里执行。
 *
 * 对象名与方法 id 也放在这里：插件描述（顶层的全局对象）与服务端入口（方法工具）都要用，它们互相不引用。
 */

import {definePlugin} from "@notnotype/nb-plugin-sdk";

export const plugin = definePlugin({id: "example.word-stats", version: "0.1.0", locations: ["server"]});

/** 代码里的全局名：`await stats.count({text})`。要是 JS 标识符，不能与内核给的名字（`tool`、`console`…）或 JS 的全局重名。 */
export const STATS_OBJECT = "stats";
/** 方法 `stats.count` 是一个工具，id 照工具的规则用插件 id 开头。 */
export const COUNT_TOOL = `${plugin.id}.count` as const;
