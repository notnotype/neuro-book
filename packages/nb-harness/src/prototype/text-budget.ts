export interface TextBudgetOptions {
    readonly maxLines: number;
    readonly maxBytes: number;
}

export interface TextBudgetResult {
    readonly text: string;
    readonly truncated: boolean;
    /** 真正把内容砍掉的那个约束；未截断为 null。 */
    readonly reason: "lines" | "bytes" | null;
}

/**
 * 按行累加、先到先停地截断文本：超 `maxLines` 或 `maxBytes` 即停止并报告原因。
 * 结尾换行按一个空段处理（与 `split("\n")` 语义一致），不额外追加省略提示。
 */
export function truncateText(content: string, options: TextBudgetOptions): TextBudgetResult {
    const out: string[] = [];
    let bytes = 0;
    let reason: "lines" | "bytes" | null = null;

    for (const line of content.split("\n")) {
        if (out.length >= options.maxLines) {
            reason = "lines";
            break;
        }
        const lineBytes = Buffer.byteLength(line, "utf-8") + (out.length > 0 ? 1 : 0);
        if (bytes + lineBytes > options.maxBytes) {
            reason = "bytes";
            break;
        }
        out.push(line);
        bytes += lineBytes;
    }

    return {text: out.join("\n"), truncated: reason !== null, reason};
}
