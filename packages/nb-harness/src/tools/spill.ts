/**
 * 工具结果的预算与溢出（docs/specs/harness/tools.md 输出 9）：文本合计超过 `spillBytes` 时全文交给溢出存储，交给模型的只留头尾与一个回读链接。
 * 阈值按字节（照 OMP 的缺省：50 KiB，头尾各 20 KiB、500 行），与模型无关、可预测。保存失败照样截——决不把全文重新塞回上下文。
 */

import type {AgentToolResult} from "@oh-my-pi/pi-agent-core";
import type {ImageContent, TextContent} from "@oh-my-pi/pi-ai";
import type {JsonValue, ToolResultBudget} from "./types";

export const DEFAULT_TOOL_RESULT_BUDGET: ToolResultBudget = {spillBytes: 50 * 1024, headBytes: 20 * 1024, tailBytes: 20 * 1024, tailLines: 500};

/** 四个字段都要是非负整数：负数会让 `slice` 从尾部数、把整行留下来，NaN 比什么都不大。运行时在装配时就按它拒绝。 */
export function assertToolResultBudget(budget: ToolResultBudget): void {
    for (const key of ["spillBytes", "headBytes", "tailBytes", "tailLines"] as const) {
        const value = budget[key];
        if (!Number.isInteger(value) || value < 0) throw new TypeError(`工具结果预算 ${key} 必须是非负整数：${String(value)}`);
    }
}

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

/** 从头取行：不超过 `maxLines` 行与 `maxBytes` 字节（含换行）；一行就超预算时按字节截到字符边界（`cut` 为真）。 */
function takeHead(lines: readonly string[], maxLines: number, maxBytes: number): {lines: string[]; cut: boolean} {
    const out: string[] = [];
    let bytes = 0;
    for (const line of lines) {
        if (out.length >= maxLines) break;
        const size = byteLength(line) + (out.length > 0 ? 1 : 0);
        if (bytes + size > maxBytes) {
            if (out.length === 0) {
                out.push(cutBytes(line, maxBytes));
                return {lines: out, cut: true};
            }
            break;
        }
        out.push(line);
        bytes += size;
    }
    return {lines: out, cut: false};
}

/** 截到 `maxBytes` 字节以内，不拆开一个字符：按码点走一遍累加 UTF-8 长度（孤立的代理项按 3 字节，与 TextEncoder 的替换一致）。 */
export function cutBytes(text: string, maxBytes: number): string {
    let bytes = 0;
    let index = 0;
    while (index < text.length) {
        const point = text.codePointAt(index)!;
        const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (bytes + size > maxBytes) break;
        bytes += size;
        index += point >= 0x10000 ? 2 : 1;
    }
    return text.slice(0, index);
}

export type Spilled = {content: string; totalBytes: number; totalLines: number; keptHeadLines: number; keptTailLines: number};

/** 头尾各留一段，中间一行省略说明；头尾加起来还是整段时不省略。 */
export function elideMiddle(text: string, budget: ToolResultBudget): Spilled {
    const lines = text.split("\n");
    const totalBytes = byteLength(text);
    const headTaken = takeHead(lines, budget.tailLines, budget.headBytes);
    const head = headTaken.lines;
    // 头里截了半行就不再从这一行取尾：剩下的行从下一行起
    const remaining = lines.slice(head.length);
    const tailTaken = takeHead([...remaining].reverse(), budget.tailLines, budget.tailBytes);
    const tail = tailTaken.lines.reverse();
    const elidedLines = lines.length - head.length - tail.length;
    if (elidedLines <= 0 && !headTaken.cut && !tailTaken.cut) return {content: text, totalBytes, totalLines: lines.length, keptHeadLines: head.length, keptTailLines: tail.length};
    const elidedBytes = Math.max(0, totalBytes - byteLength(head.join("\n")) - byteLength(tail.join("\n")));
    return {
        content: [...head, `…（中间省略 ${Math.max(0, elidedLines)} 行，${elidedBytes} 字节）`, ...tail].join("\n"),
        totalBytes, totalLines: lines.length, keptHeadLines: head.length, keptTailLines: tail.length,
    };
}

export type SpillHooks = {save(toolName: string, text: string): Promise<string | null>};

/**
 * 文本块合计超过 `spillBytes` 时：全文交给 `artifacts.save`（没有存储或存失败都得到 `null`），内容换成头尾加说明；图片块原样保留。
 * `details.truncated` 记原始大小与 artifact 序号，界面与模型都能据此回读。
 */
export async function spillToolResult(result: AgentToolResult, toolName: string, budget: ToolResultBudget, artifacts: SpillHooks | undefined): Promise<AgentToolResult> {
    assertToolResultBudget(budget);
    const texts = result.content.filter((block): block is TextContent => block.type === "text").map((block) => block.text);
    if (texts.length === 0) return result;
    const full = texts.join("\n");
    const totalBytes = byteLength(full);
    if (totalBytes <= budget.spillBytes) return result;
    let artifactId: string | null = null;
    if (artifacts !== undefined) {
        try {
            artifactId = await artifacts.save(toolName, full);
        } catch {
            // 存储抛出与返回 null 同样处理：照样截断，只是没有回读链接
            artifactId = null;
        }
    }
    const elided = elideMiddle(full, budget);
    const notice = artifactId === null
        ? `（输出 ${elided.totalLines} 行、${totalBytes} 字节，超过预算 ${budget.spillBytes} 字节，只保留头尾；全文未能保存）`
        : `（输出 ${elided.totalLines} 行、${totalBytes} 字节，超过预算 ${budget.spillBytes} 字节，只保留头尾；全文：read artifact://${artifactId}，可带 offset、limit）`;
    const others = result.content.filter((block): block is ImageContent => block.type !== "text");
    const truncated: JsonValue = {bytes: totalBytes, lines: elided.totalLines, head: elided.keptHeadLines, tail: elided.keptTailLines, ...(artifactId === null ? {} : {artifactId})};
    const previous = result.details;
    const details: JsonValue = typeof previous === "object" && previous !== null && !Array.isArray(previous) ? {...(previous as Record<string, JsonValue>), truncated} : previous === undefined ? {truncated} : {details: previous as JsonValue, truncated};
    return {...result, content: [...others, {type: "text", text: `${elided.content}\n${notice}`}], details};
}
