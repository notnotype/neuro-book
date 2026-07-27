import type {ComfyUiCheckResponseDto} from "nbook/shared/dto/comfyui.dto";

/**
 * ComfyUI 原生 HTTP API 的无状态封装。
 *
 * 只负责单次请求：连接检查、提交工作流、查询历史、下载输出图片、中断执行。
 * WS 进度监听在 ws-listener.ts，任务编排在 job-manager.ts。
 * ComfyUI 是本机服务，不走 provider proxy。
 */

const DEFAULT_TIMEOUT_MS = 30_000;

/** ComfyUI /history 输出中的单张图片定位符（/view 的查询参数）。 */
export type ComfyUiOutputImage = {
    filename: string;
    subfolder: string;
    /** 输出目录类型，一般为 "output"；预览图为 "temp"。 */
    type: string;
};

/** 出站请求失败时抛出，message 面向用户可读。 */
export class ComfyUiRequestError extends Error {
    constructor(message: string, readonly statusCode = 502) {
        super(message);
        this.name = "ComfyUiRequestError";
    }
}

/**
 * 规范化 baseURL：去尾部斜杠，校验协议。
 */
export function normalizeComfyUiBaseUrl(input: string): string {
    const trimmed = input.trim().replace(/\/+$/u, "");
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new ComfyUiRequestError(`ComfyUI 地址无效：${trimmed || "(空)"}`, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ComfyUiRequestError(`ComfyUI 地址必须是 http/https：${trimmed}`, 400);
    }
    return trimmed;
}

/**
 * 带超时的 fetch。错误统一转成用户可读的 ComfyUiRequestError。
 */
async function comfyFetch(baseURL: string, path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(`${baseURL}${path}`, {...init, redirect: "error", signal: controller.signal});
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new ComfyUiRequestError(`ComfyUI 请求超时（${String(timeoutMs)}ms）：${path}`);
        }
        const cause = error instanceof Error ? error.message : String(error);
        throw new ComfyUiRequestError(`无法连接 ComfyUI（${baseURL}）：${cause}`);
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

async function readJsonBody(response: Response, path: string): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        throw new ComfyUiRequestError(`ComfyUI 返回了非 JSON 响应：${path}`);
    }
}

/**
 * 连接检查：GET /system_stats。任何失败都归一为 success:false，不向上抛。
 */
export async function checkComfyUi(baseURLInput: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComfyUiCheckResponseDto> {
    const startedAt = Date.now();
    try {
        const baseURL = normalizeComfyUiBaseUrl(baseURLInput);
        const response = await comfyFetch(baseURL, "/system_stats", {method: "GET"}, timeoutMs);
        if (!response.ok) {
            return {success: false, latencyMs: null, message: `ComfyUI 响应异常：HTTP ${String(response.status)}`};
        }
        const stats = await readJsonBody(response, "/system_stats") as {system?: {comfyui_version?: string}};
        const latencyMs = Date.now() - startedAt;
        const version = typeof stats.system?.comfyui_version === "string" ? stats.system.comfyui_version : null;
        return {
            success: true,
            latencyMs,
            message: version ? `连接成功（ComfyUI ${version}，${String(latencyMs)}ms）` : `连接成功（${String(latencyMs)}ms）`,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {success: false, latencyMs: null, message};
    }
}

/**
 * 提交 API 格式工作流：POST /prompt，返回 prompt_id。
 * ComfyUI 校验失败（如节点缺失、模型文件不存在）时返回 400 + error/node_errors，转成可读错误。
 */
export async function submitPrompt(
    baseURL: string,
    workflow: Record<string, unknown>,
    clientId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
    const response = await comfyFetch(baseURL, "/prompt", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({prompt: workflow, client_id: clientId}),
    }, timeoutMs);
    const body = await readJsonBody(response, "/prompt") as {
        prompt_id?: string;
        error?: {type?: string; message?: string};
        node_errors?: Record<string, {errors?: Array<{message?: string; details?: string}>}>;
    };
    if (!response.ok || typeof body.prompt_id !== "string") {
        throw new ComfyUiRequestError(`ComfyUI 拒绝了工作流：${formatPromptError(body)}`, 502);
    }
    return body.prompt_id;
}

/** 把 /prompt 的错误响应压成一行可读文本。 */
function formatPromptError(body: {
    error?: {type?: string; message?: string};
    node_errors?: Record<string, {errors?: Array<{message?: string; details?: string}>}>;
}): string {
    const parts: string[] = [];
    if (body.error?.message) {
        parts.push(body.error.message);
    }
    for (const [nodeId, nodeError] of Object.entries(body.node_errors ?? {})) {
        for (const item of nodeError.errors ?? []) {
            const detail = [item.message, item.details].filter(Boolean).join(" ");
            if (detail) {
                parts.push(`节点 ${nodeId}: ${detail}`);
            }
        }
    }
    return parts.length > 0 ? parts.join("；") : "未知错误";
}

/** /history/{promptId} 单条记录中本次任务关心的部分。 */
export type ComfyUiHistoryEntry = {
    /** 任务是否已执行完成（status.completed）。 */
    completed: boolean;
    /** 执行失败时的错误消息；正常为 null。 */
    error: string | null;
    /** 所有输出节点产出的图片（type=output）。 */
    images: ComfyUiOutputImage[];
};

/**
 * 查询任务历史：GET /history/{promptId}。任务尚未进入历史时返回 null。
 */
export async function fetchHistory(baseURL: string, promptId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ComfyUiHistoryEntry | null> {
    const response = await comfyFetch(baseURL, `/history/${encodeURIComponent(promptId)}`, {method: "GET"}, timeoutMs);
    if (!response.ok) {
        throw new ComfyUiRequestError(`查询 ComfyUI 历史失败：HTTP ${String(response.status)}`);
    }
    const body = await readJsonBody(response, "/history") as Record<string, {
        status?: {completed?: boolean; status_str?: string; messages?: Array<[string, {exception_message?: string}]>};
        outputs?: Record<string, {images?: Array<Partial<ComfyUiOutputImage>>}>;
    }>;
    const entry = body[promptId];
    if (!entry) {
        return null;
    }
    const images: ComfyUiOutputImage[] = [];
    for (const output of Object.values(entry.outputs ?? {})) {
        for (const image of output.images ?? []) {
            // 只收集正式输出（SaveImage），跳过 PreviewImage 的 temp 产物。
            if (typeof image.filename === "string" && image.type === "output") {
                images.push({filename: image.filename, subfolder: image.subfolder ?? "", type: image.type});
            }
        }
    }
    let error: string | null = null;
    if (entry.status?.status_str === "error") {
        const exception = (entry.status.messages ?? [])
            .map(([, payload]) => payload?.exception_message)
            .find((message): message is string => typeof message === "string");
        error = exception ?? "ComfyUI 执行失败";
    }
    return {
        completed: entry.status?.completed === true,
        error,
        images,
    };
}

/**
 * 下载输出图片：GET /view。返回原始字节。
 */
export async function fetchViewImage(baseURL: string, image: ComfyUiOutputImage, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
    const query = new URLSearchParams({filename: image.filename, subfolder: image.subfolder, type: image.type});
    const response = await comfyFetch(baseURL, `/view?${query.toString()}`, {method: "GET"}, timeoutMs);
    if (!response.ok) {
        throw new ComfyUiRequestError(`下载 ComfyUI 图片失败：HTTP ${String(response.status)}（${image.filename}）`);
    }
    return Buffer.from(await response.arrayBuffer());
}

/**
 * 中断当前执行：POST /interrupt。失败不抛（取消是尽力而为，本地状态照常标记）。
 */
export async function interruptExecution(baseURL: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    try {
        await comfyFetch(baseURL, "/interrupt", {method: "POST"}, timeoutMs);
    } catch {
        // 连接不上时无事可做；job-manager 会按本地状态处理取消。
    }
}
