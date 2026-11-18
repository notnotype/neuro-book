/**
 * `example.word-stats` 的服务端入口：贡献全局对象 `stats` 的方法 `count`（docs/specs/agent/eval.md 输出 6、7）。读这个文件学三件事：
 *
 * 1. **方法就是工具**：用 SDK 的 `agentTool` 写声明，多一个 `global: {object, method}`。带 `global` 的工具不进模型的工具清单
 *    （模型直接调不到它，得 `code-only`），只能在 eval 的代码里写 `stats.count({...})` 调（docs/specs/harness/runtime.md 输出 93）。
 *    `global.object` 要是同一个插件登记的对象（`plugin.ts`），不然这个工具不进工具表，诊断 `eval-object-missing`。
 * 2. **`returns` 让代码拿到对象**：声明了 `returns`（JSON Schema）的方法，成功时代码拿到的是结果的 `details`（照 `returns` 校验过，
 *    不合格算失败、得 `returns-mismatch`）；没声明的拿到结果文字。结果的 `text` 仍是给人看的那一句，界面与日志里显示它。
 * 3. **审批照常**：代码里每调一次都过审批与拦截，和模型直接调工具一样（docs/specs/agent/permissions.md 输出 24）。这里是只读的
 *    `effect: "read"`，询问模式下也直接放行；会写文件的方法要写 `write`，用户会被问到，问的时候写明是 eval 里的调用。
 *
 * 对应的场景：`scenarios/10-eval-object.test.ts`。
 */

import {agentTool, TOOLS_POINT} from "@notnotype/nb-plugin-sdk/agent";
import type {AgentToolImplementation} from "@notnotype/nb-plugin-sdk/agent";

import {COUNT_TOOL, plugin, STATS_OBJECT} from "../shared/contracts";

/** 声明与激活事件：`agentTool` 交回贡献声明，以及“第一次调用这个工具时激活本入口”的事件（`onAgentTool:<id>`）。 */
const count = agentTool(COUNT_TOOL, {
    description: "数 text 的字数（字符数）与行数。",
    parameters: {type: "object", properties: {text: {type: "string"}}, required: ["text"], additionalProperties: false},
    version: "1",
    effect: "read",
    concurrency: "shared",
    global: {object: STATS_OBJECT, method: "count"},
    returns: {type: "object", properties: {chars: {type: "integer"}, lines: {type: "integer"}}, required: ["chars", "lines"]},
});

const countImplementation: AgentToolImplementation = {
    create: () => ({
        execute: async (args) => {
            const text = args.text as string;
            const chars = [...text.replace(/\n/gu, "")].length;
            const lines = text === "" ? 0 : text.split("\n").length;
            return {text: `${String(chars)} 字，${String(lines)} 行`, details: {chars, lines}};
        },
    }),
};

export const wordStatsBackendPlugin = plugin.definition([
    plugin.entry({
        location: "server",
        // 第一次调到 `stats.count` 时才激活：会话里没人用它，就不占资源。
        activationEvents: [count.activationEvent],
        rawContributions: [count.contribution],
        activate: () => ({rawContributions: {[TOOLS_POINT]: {[COUNT_TOOL]: countImplementation}}}),
    }),
]);
