/**
 * 插件描述：一条顶层贡献 `agent.evalObjects`，登记一个 Agent 的 eval 代码里可用的全局对象（docs/specs/agent/contributions.md
 * 输出 25，docs/specs/agent/eval.md）。
 *
 * - 对象只有声明：名字、一行摘要、给模型读的说明。它没有实现，也不用激活事件：`nbook.agent` 读到声明就把它列进 eval 的说明，
 *   并生成文档 `docs://eval/stats.md`（docs/specs/agent/resources.md 输出 16）。
 * - 对象的方法是普通的工具，由服务端入口另外贡献（`backend/plugin.ts`），声明里写 `global: {object: "stats", method: "count"}`。
 *   一个方法一个工具：审批、规则、参数校验、日志都按方法走，和别的工具一样。
 * - 摘要进 eval 的说明，一行就好；完整的用法写在 `docs` 里，模型要用之前去读文档（说明里只放地址，省上下文）。
 *
 * `evalObject` 来自 SDK 的 `/agent`，它只在服务端用（同 `skill-pack/plugin.ts` 的说明）。
 */

import {evalObject} from "@notnotype/nb-plugin-sdk/agent";

import {plugin, STATS_OBJECT} from "./shared/contracts";

export const descriptor = plugin.descriptor([
    evalObject(`${plugin.id}.${STATS_OBJECT}`, {
        name: STATS_OBJECT,
        summary: "数一段文字的字数与行数",
        docs: "统计中文正文时按字符数，不按词。要统计一章，先 `await tool.read({path})` 读出正文再交给 `stats.count`。",
    }),
]);
