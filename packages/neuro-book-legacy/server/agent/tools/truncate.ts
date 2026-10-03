export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export type TruncationResult = {
    content: string;
    truncated: boolean;
    truncatedBy: "lines" | "bytes" | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    lastLinePartial: boolean;
    firstLineExceedsLimit: boolean;
    maxLines: number;
    maxBytes: number;
};

type TruncationOptions = {
    maxLines?: number;
    maxBytes?: number;
};

/**
 * 把字节数格式化为模型可读的短尺寸。
 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 从文件头部截断，保留完整行。
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const totalBytes = Buffer.byteLength(content, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (totalLines <= maxLines && totalBytes <= maxBytes) {
        return createResult(content, false, null, totalLines, totalBytes, totalLines, totalBytes, false, false, maxLines, maxBytes);
    }

    const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8");
    if (firstLineBytes > maxBytes) {
        return createResult("", true, "bytes", totalLines, totalBytes, 0, 0, false, true, maxLines, maxBytes);
    }

    const outputLines: string[] = [];
    let outputBytes = 0;
    let truncatedBy: "lines" | "bytes" = "lines";
    for (let index = 0; index < lines.length && index < maxLines; index++) {
        const line = lines[index] ?? "";
        const lineBytes = Buffer.byteLength(line, "utf-8") + (index > 0 ? 1 : 0);
        if (outputBytes + lineBytes > maxBytes) {
            truncatedBy = "bytes";
            break;
        }
        outputLines.push(line);
        outputBytes += lineBytes;
    }

    const output = outputLines.join("\n");
    return createResult(output, true, truncatedBy, totalLines, totalBytes, outputLines.length, Buffer.byteLength(output, "utf-8"), false, false, maxLines, maxBytes);
}

/**
 * 从输出尾部截断，供 bash 这类长日志使用。
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const totalBytes = Buffer.byteLength(content, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (totalLines <= maxLines && totalBytes <= maxBytes) {
        return createResult(content, false, null, totalLines, totalBytes, totalLines, totalBytes, false, false, maxLines, maxBytes);
    }

    const outputLines: string[] = [];
    let outputBytes = 0;
    let truncatedBy: "lines" | "bytes" = "lines";
    let lastLinePartial = false;

    for (let index = lines.length - 1; index >= 0 && outputLines.length < maxLines; index--) {
        const line = lines[index] ?? "";
        const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLines.length > 0 ? 1 : 0);
        if (outputBytes + lineBytes > maxBytes) {
            truncatedBy = "bytes";
            if (outputLines.length === 0) {
                const truncated = truncateStringToBytesFromEnd(line, maxBytes);
                outputLines.unshift(truncated);
                outputBytes = Buffer.byteLength(truncated, "utf-8");
                lastLinePartial = true;
            }
            break;
        }
        outputLines.unshift(line);
        outputBytes += lineBytes;
    }

    const output = outputLines.join("\n");
    return createResult(output, true, truncatedBy, totalLines, totalBytes, outputLines.length, Buffer.byteLength(output, "utf-8"), lastLinePartial, false, maxLines, maxBytes);
}

function createResult(
    content: string,
    truncated: boolean,
    truncatedBy: "lines" | "bytes" | null,
    totalLines: number,
    totalBytes: number,
    outputLines: number,
    outputBytes: number,
    lastLinePartial: boolean,
    firstLineExceedsLimit: boolean,
    maxLines: number,
    maxBytes: number,
): TruncationResult {
    return {
        content,
        truncated,
        truncatedBy,
        totalLines,
        totalBytes,
        outputLines,
        outputBytes,
        lastLinePartial,
        firstLineExceedsLimit,
        maxLines,
        maxBytes,
    };
}

function truncateStringToBytesFromEnd(text: string, maxBytes: number): string {
    const buffer = Buffer.from(text, "utf-8");
    if (buffer.length <= maxBytes) {
        return text;
    }
    let start = buffer.length - maxBytes;
    while (start < buffer.length && (((buffer[start] ?? 0) & 0xc0) === 0x80)) {
        start++;
    }
    return buffer.subarray(start).toString("utf-8");
}
