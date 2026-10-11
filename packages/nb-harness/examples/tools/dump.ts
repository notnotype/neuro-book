/**
 * 一个会吐出大段文字的示例工具：演示工具结果的预算与溢出（docs/specs/harness/tools.md 输出 9）。
 *
 * 要说明的事：
 * - 工具按内核协议定义（`defineTool`），结果多大都可以原样返回；预算不归工具管，适配层统一截断，全文进溢出存储。
 * - Profile 的 `harness/tools` 字段要列出它，运行时才让模型看到。
 */

import Type from "typebox";
import {defineTool} from "@notnotype/nb-harness/tools";
import type {ToolDefinition} from "@notnotype/nb-harness/tools";

export const DUMP_LINES = 4000;

/** 第 N 行是 `N: ` 加 50 个字符，整段约 220 KiB，远超 50 KiB 的缺省预算。 */
export function dumpText(): string {
    return Array.from({length: DUMP_LINES}, (_v, index) => `${index + 1}: ${"x".repeat(50)}`).join("\n");
}

export function dumpTool(): ToolDefinition {
    return defineTool({
        id: "dump",
        description: "输出一大段编号文本（示例：演示超预算的工具结果怎样溢出到 artifact）。",
        parameters: Type.Object({}),
        risk: "read",
        execute: async () => ({ok: true, content: dumpText()}),
    });
}
