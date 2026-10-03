import {PUBLIC_EVENT_MAX_BYTES} from "nbook/shared/agent/public-event-limits";

/**
 * SSE 事件处理器。
 */
export type SseEventHandler<TEvent> = (event: TEvent) => void | Promise<void>;

export type SseReadOptions = {
    onOpen?: () => void;
};

export class SseHttpError extends Error {
    constructor(readonly status: number) {
        super(`请求失败：${status}`);
        this.name = "SseHttpError";
    }
}

export class SseContentTypeError extends Error {
    constructor(readonly contentType: string | null) {
        super(contentType
            ? `响应不是 SSE：Content-Type 为 ${contentType}`
            : "响应不是 SSE：缺少 Content-Type");
        this.name = "SseContentTypeError";
    }
}

export class SseFrameTooLargeError extends Error {
    constructor(readonly bytes: number) {
        super(`SSE frame 超过最大字节数：${String(bytes)} > ${String(PUBLIC_EVENT_MAX_BYTES)}`);
        this.name = "SseFrameTooLargeError";
    }
}

const textEncoder = new TextEncoder();

/** reader 创建前的 fail-fast 路径也必须释放底层 HTTP body。 */
async function cancelResponseBody(response: Response): Promise<void> {
    if (!response.body) return;
    try {
        await response.body.cancel();
    } catch {
        // 保留原始 HTTP/协议错误；取消失败不应覆盖真正诊断。
    }
}

/** 在解析 JSON 前执行传输硬上限，避免完整 frame 制造大对象。 */
function assertSseFrameBytes(frame: string, knownBytes?: number): void {
    const bytes = knownBytes ?? textEncoder.encode(frame).byteLength;
    if (bytes > PUBLIC_EVENT_MAX_BYTES) {
        throw new SseFrameTooLargeError(bytes);
    }
}

type SseFrameSlice = {
    frame: string;
    wireBytes: number;
};

/** 切出完整 frame，并保留实际 LF/CRLF 空行 delimiter 的 wire bytes。 */
function extractSseFrames(value: string): {frames: SseFrameSlice[]; remainder: string} {
    const frames: SseFrameSlice[] = [];
    let start = 0;
    for (const match of value.matchAll(/\r?\n\r?\n/gu)) {
        const index = match.index;
        const delimiter = match[0];
        const frame = value.slice(start, index);
        frames.push({
            frame,
            wireBytes: textEncoder.encode(frame).byteLength + delimiter.length,
        });
        start = index + delimiter.length;
    }
    return {frames, remainder: value.slice(start)};
}

/**
 * 解析单个 SSE 数据帧。
 */
const parseSseFrame = <TEvent>(frame: string, wireBytes?: number): TEvent | null => {
    assertSseFrameBytes(frame, wireBytes);
    const lines = frame.split(/\r?\n/u);
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).replace(/^ /, ""));
        }
    }

    const dataText = dataLines.join("\n");
    if (!dataText) {
        return null;
    }

    return JSON.parse(dataText) as TEvent;
};

/**
 * 读取一个 SSE 响应流。
 * 仅负责协议解析，不负责具体业务事件语义。
 */
export const readSseStream = async <TEvent>(
    response: Response,
    onEvent: SseEventHandler<TEvent>,
    options: SseReadOptions = {},
): Promise<void> => {
    if (!response.ok) {
        await cancelResponseBody(response);
        throw new SseHttpError(response.status);
    }
    if (!response.body) {
        throw new Error("服务端未返回流式数据");
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "text/event-stream") {
        await cancelResponseBody(response);
        throw new SseContentTypeError(contentType);
    }
    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bufferedBytes = 0;

    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }

            bufferedBytes += value.byteLength;
            buffer += decoder.decode(value, {stream: true});
            const extracted = extractSseFrames(buffer);
            buffer = extracted.remainder;

            if (extracted.frames.length > 0) {
                // streaming TextDecoder 最多暂存 3 个未完成 UTF-8 bytes；保守计入，避免 hard limit 漏口。
                bufferedBytes = textEncoder.encode(buffer).byteLength + (buffer ? 3 : 0);
            }
            assertSseFrameBytes(buffer, bufferedBytes);

            for (const frame of extracted.frames) {
                const event = parseSseFrame<TEvent>(frame.frame, frame.wireBytes);
                if (event) {
                    await onEvent(event);
                }
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            assertSseFrameBytes(buffer);
            const event = parseSseFrame<TEvent>(buffer);
            if (event) {
                await onEvent(event);
            }
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // reader 已因网络断开而关闭时，取消本身可能再次失败；释放 lock 仍然必要。
        }
        reader.releaseLock();
    }
};
