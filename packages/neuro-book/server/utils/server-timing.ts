import {getResponseHeader, setResponseHeader, type H3Event} from "h3";
import type {ServerTimingSink} from "nbook/server/utils/server-timing-sink";

type ServerTimingMark = {
    name: string;
    durationMs: number;
};

type ServerTimingContext = {
    __nbookServerTimingMarks?: ServerTimingMark[];
    __nbookServerTimingCommitted?: boolean;
};

type NitroResponseLike = {
    headers?: Headers | Record<string, string | number | string[] | undefined>;
    body?: unknown;
};

type ServerTimingResponsePatch = {
    __nbookServerTimingFinalValue?: string;
    __nbookServerTimingSetHeaderPatched?: boolean;
    setHeader(name: string, value: number | string | readonly string[]): unknown;
};

/**
 * 收集 Server-Timing mark。mark 挂在 H3 event.context 上，最终由 Nitro beforeResponse 统一写出。
 */
export function createServerTiming(event: H3Event) {
    const marks = serverTimingMarks(event);

    const mark = (name: string, durationMs: number): void => {
        marks.push({name, durationMs});
    };

    const measure = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
        const startedAt = performance.now();
        try {
            return await task();
        } finally {
            mark(name, performance.now() - startedAt);
        }
    };

    const commit = (): void => {
        flushServerTiming(event);
    };

    return {
        mark,
        measure,
        commit,
    };
}

/**
 * 在响应发送前写出 Server-Timing。多次调用只会提交一次。
 * Nitro dev runtime 可能以 beforeResponse 的 response.headers 作为最终输出，所以这里同时写 H3 event 和 response。
 */
export function flushServerTiming(event: H3Event, response?: NitroResponseLike): void {
    const context = event.context as ServerTimingContext;
    const marks = context.__nbookServerTimingMarks ?? [];
    if (context.__nbookServerTimingCommitted || marks.length === 0) {
        return;
    }
    context.__nbookServerTimingCommitted = true;
    const current = readResponseServerTiming(response) ?? getResponseHeader(event, "Server-Timing");
    const next = formatServerTiming(marks);
    const value = current ? `${current}, ${next}` : next;
    setResponseHeader(event, "Server-Timing", value);
    writeResponseServerTiming(response, value);
    patchLateServerTimingHeader(event, value);
}

/**
 * 读取当前请求上的 Server-Timing mark 列表，测试和插件共用。
 */
export function readServerTimingMarks(event: H3Event): readonly ServerTimingMark[] {
    return serverTimingMarks(event);
}

function serverTimingMarks(event: H3Event): ServerTimingMark[] {
    const context = event.context as ServerTimingContext;
    if (!context.__nbookServerTimingMarks) {
        context.__nbookServerTimingMarks = [];
    }
    return context.__nbookServerTimingMarks;
}

function formatServerTiming(marks: readonly ServerTimingMark[]): string {
    return marks
        .map((mark) => `${mark.name};dur=${mark.durationMs.toFixed(1)}`)
        .join(", ");
}

function readResponseServerTiming(response: NitroResponseLike | undefined): string | undefined {
    if (!response?.headers) {
        return undefined;
    }
    if (response.headers instanceof Headers) {
        return response.headers.get("Server-Timing") ?? undefined;
    }
    const value = response.headers["Server-Timing"] ?? response.headers["server-timing"];
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    return value === undefined ? undefined : String(value);
}

function writeResponseServerTiming(response: NitroResponseLike | undefined, value: string): void {
    if (!response?.headers) {
        return;
    }
    if (response.headers instanceof Headers) {
        response.headers.set("Server-Timing", value);
        return;
    }
    response.headers["Server-Timing"] = value;
}

function patchLateServerTimingHeader(event: H3Event, value: string): void {
    const response = event.node.res as unknown as ServerTimingResponsePatch;
    response.__nbookServerTimingFinalValue = value;
    if (response.__nbookServerTimingSetHeaderPatched) {
        return;
    }
    response.__nbookServerTimingSetHeaderPatched = true;
    const originalSetHeader = response.setHeader.bind(response);
    response.setHeader = (name, nextValue) => {
        if (name.toLowerCase() !== "server-timing") {
            return originalSetHeader(name, nextValue);
        }
        const customValue = response.__nbookServerTimingFinalValue;
        if (!customValue) {
            return originalSetHeader(name, nextValue);
        }
        const incomingValue = Array.isArray(nextValue) ? nextValue.join(", ") : String(nextValue);
        if (incomingValue.includes(customValue)) {
            return originalSetHeader(name, nextValue);
        }
        return originalSetHeader(name, incomingValue ? `${incomingValue}, ${customValue}` : customValue);
    };
}
