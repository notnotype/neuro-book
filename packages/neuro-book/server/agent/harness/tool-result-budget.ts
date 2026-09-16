import {formatSize, TOOL_RESULT_MAX_BYTES, TOOL_RESULT_MAX_LINES, truncateHead} from "nbook/server/agent/tools/truncate";
import type {AgentOutputSpill} from "nbook/server/agent/tools/agent-output-store";
import type {NeuroToolResult} from "nbook/server/agent/tools/types";

/**
 * 单条工具结果进模型上下文的硬安全网。
 *
 * 工具自带预算（read/bash 的 TOOL_RESULT_MAX_BYTES/TOOL_RESULT_MAX_LINES）必须低于它，
 * 该值只兜住绕开工具预算的整段输出（例如 plot 工具的全量JSON）。
 */
export const TOOL_RESULT_HARD_MAX_BYTES = TOOL_RESULT_MAX_BYTES * 2;

/** 超限文本的落盘入口；返回null表示cache不可用，调用方仍需给出可见的截断标记。 */
export type ToolResultSpill = (text: string) => Promise<AgentOutputSpill | null>;

/**
 * 把单条工具结果的文本块压到硬上限内。
 *
 * 未超限时原样返回同一个结果引用；超限时保留头部、把完整文本落盘并把locator写回可见标记，
 * 同时原样保留非文本块、details与terminate。
 */
export async function boundToolResult(input: {result: NeuroToolResult; spill?: ToolResultSpill}): Promise<NeuroToolResult> {
    const text = input.result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    const bytes = Buffer.byteLength(text, "utf-8");
    if (bytes <= TOOL_RESULT_HARD_MAX_BYTES) {
        return input.result;
    }
    const truncation = truncateHead(text, {maxLines: TOOL_RESULT_MAX_LINES, maxBytes: TOOL_RESULT_MAX_BYTES});
    // 单行本身超过上限时truncateHead没有可保留的完整行，退化为字节前缀。
    const head = truncation.firstLineExceedsLimit
        ? Buffer.from(text, "utf-8").subarray(0, TOOL_RESULT_MAX_BYTES).toString("utf-8")
        : truncation.content;
    const headBytes = formatSize(Buffer.byteLength(head, "utf-8"));
    const spill = input.spill ? await input.spill(text).catch(() => null) : null;
    const marker = spill
        ? spill.state === "available"
            ? `[工具结果 ${formatSize(bytes)} 超过单条上限 ${formatSize(TOOL_RESULT_HARD_MAX_BYTES)}：已保留前 ${headBytes}，完整内容见 ${spill.locator}（用 read 分页读取）。]`
            : `[工具结果 ${formatSize(bytes)} 超过单条上限 ${formatSize(TOOL_RESULT_HARD_MAX_BYTES)}：已保留前 ${headBytes}，完整内容超出 cache 单文件上限，可见部分见 ${spill.locator}。]`
        : `[工具结果 ${formatSize(bytes)} 超过单条上限 ${formatSize(TOOL_RESULT_HARD_MAX_BYTES)} 且无法落盘：已截断为前 ${headBytes}。]`;
    return {
        ...input.result,
        content: [
            {type: "text", text: `${head}\n\n${marker}`},
            ...input.result.content.filter((block) => block.type !== "text"),
        ],
    };
}
