import {createServer, type Server} from "node:http";
import {AddressInfo} from "node:net";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {WebSocketServer, type WebSocket} from "ws";

/**
 * job-manager × mock ComfyUI 端到端集成测试。
 *
 * mock 服务器实现 /system_stats、/prompt、/history、/view、/interrupt 与 WS 进度推送；
 * 配置与图片落盘被 mock（不触真实 workspace），其余（client、ws-listener、job-manager）全部走真实实现。
 * ComfyUI 离线（连接拒绝）是一等测试场景。
 */

// ── mock 依赖 ────────────────────────────────────────────────────

const savedImages: Array<{projectPath: string; jobId: string; bytes: number[]}> = [];

vi.mock("nbook/server/config/config-service", () => ({
    loadGlobalEffectiveConfigSync: vi.fn(() => currentConfig),
}));

vi.mock("nbook/server/comfyui/illustration-store", () => ({
    saveIllustrationImages: vi.fn(async (input: {projectPath: string; jobId: string; images: Array<{bytes: Buffer}>}) => {
        savedImages.push({projectPath: input.projectPath, jobId: input.jobId, bytes: input.images.map((image) => image.bytes.length)});
        return input.images.map((_, index) => `assets/illustrations/test-${input.jobId.slice(0, 8)}-${String(index + 1)}.png`);
    }),
}));

// 供 config-service mock 使用的可变配置（beforeAll 里填入 mock 服务器地址）。
let currentConfig = buildConfig("http://127.0.0.1:1", true);

function buildConfig(baseURL: string, enabled: boolean): {comfyui: {enabled: boolean; baseURL: string; timeoutMs: number; defaults: {checkpoint: string; width: number; height: number; steps: number; cfg: number}; activeWorkflowId: null; promptModelKey: null; positivePrefix: string; negativeDefault: string}} {
    return {
        comfyui: {
            enabled,
            baseURL,
            timeoutMs: 3_000,
            promptModelKey: null,
            positivePrefix: "",
            negativeDefault: "",
            defaults: {checkpoint: "test.safetensors", width: 512, height: 512, steps: 8, cfg: 4},
            activeWorkflowId: null,
        },
    };
}

// ── mock ComfyUI 服务器 ──────────────────────────────────────────

/** PNG 魔数 + 填充，够 imageMimeType 识别（本测试里落盘被 mock，仅走下载路径）。 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

type MockState = {
    /** /prompt 行为："ok" 返回 prompt_id；"reject" 返回节点错误。 */
    promptMode: "ok" | "reject";
    /** /history 的任务状态。 */
    history: "absent" | "completed" | "error" | "completed-no-images";
    interruptCalls: number;
    promptCalls: number;
    lastPromptWorkflow: Record<string, unknown> | null;
    sockets: WebSocket[];
};

const mockState: MockState = {
    promptMode: "ok",
    history: "absent",
    interruptCalls: 0,
    promptCalls: 0,
    lastPromptWorkflow: null,
    sockets: [],
};

const PROMPT_ID = "mock-prompt-1";
let server: Server;
let wss: WebSocketServer;
let baseURL = "";

function startMockServer(): Promise<void> {
    server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const json = (body: unknown, status = 200): void => {
            response.writeHead(status, {"content-type": "application/json"});
            response.end(JSON.stringify(body));
        };
        if (request.method === "GET" && url.pathname === "/system_stats") {
            json({system: {comfyui_version: "0.3.0-mock"}});
            return;
        }
        if (request.method === "POST" && url.pathname === "/prompt") {
            mockState.promptCalls += 1;
            let raw = "";
            request.on("data", (chunk) => { raw += String(chunk); });
            request.on("end", () => {
                mockState.lastPromptWorkflow = (JSON.parse(raw) as {prompt: Record<string, unknown>}).prompt;
                if (mockState.promptMode === "reject") {
                    json({error: {message: "invalid prompt"}, node_errors: {"4": {errors: [{message: "ckpt not found"}]}}}, 400);
                    return;
                }
                json({prompt_id: PROMPT_ID});
            });
            return;
        }
        if (request.method === "GET" && url.pathname.startsWith("/history/")) {
            if (mockState.history === "absent") {
                json({});
                return;
            }
            if (mockState.history === "error") {
                json({[PROMPT_ID]: {status: {completed: false, status_str: "error", messages: [["execution_error", {exception_message: "CUDA out of memory"}]]}, outputs: {}}});
                return;
            }
            json({[PROMPT_ID]: {
                status: {completed: true, status_str: "success", messages: []},
                outputs: mockState.history === "completed"
                    ? {"9": {images: [{filename: "mock_00001_.png", subfolder: "", type: "output"}, {filename: "preview.png", subfolder: "", type: "temp"}]}}
                    : {},
            }});
            return;
        }
        if (request.method === "GET" && url.pathname === "/view") {
            response.writeHead(200, {"content-type": "image/png"});
            response.end(PNG_BYTES);
            return;
        }
        if (request.method === "POST" && url.pathname === "/interrupt") {
            mockState.interruptCalls += 1;
            json({});
            return;
        }
        json({message: "not found"}, 404);
    });
    wss = new WebSocketServer({server, path: "/ws"});
    wss.on("connection", (socket) => {
        mockState.sockets.push(socket);
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address() as AddressInfo;
            baseURL = `http://127.0.0.1:${String(address.port)}`;
            resolve();
        });
    });
}

/** 向所有 WS 客户端广播 ComfyUI 风格事件。 */
function broadcast(type: string, data: Record<string, unknown>): void {
    for (const socket of mockState.sockets) {
        socket.send(JSON.stringify({type, data: {...data, prompt_id: PROMPT_ID}}));
    }
}

/** 轮询等待条件成立。 */
async function waitFor(predicate: () => boolean, timeoutMs = 8_000, label = "condition"): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`等待超时：${label}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// ── 测试 ────────────────────────────────────────────────────────

import {checkComfyUi} from "nbook/server/comfyui/client";
import {closeComfyUiSocket} from "nbook/server/comfyui/ws-listener";
import {
    cancelJob,
    ComfyUiJobInputError,
    createIllustrationJob,
    listJobs,
    subscribeJobEvents,
} from "nbook/server/comfyui/job-manager";
import type {ComfyUiCreateJobRequestDto, ComfyUiJobDto} from "nbook/shared/dto/comfyui.dto";

const REQUEST: ComfyUiCreateJobRequestDto = {
    positive: "1girl, snow",
    negative: "lowres",
    width: 512,
    height: 512,
    steps: 8,
    cfg: 4,
    seed: 42,
    workflowId: null,
};

describe("comfyui job-manager × mock ComfyUI", () => {
    beforeAll(async () => {
        await startMockServer();
        currentConfig = buildConfig(baseURL, true);
    });

    afterAll(async () => {
        closeComfyUiSocket();
        wss.close();
        await new Promise((resolve) => server.close(resolve));
    });

    it("连接检查：在线返回 success + latency；离线返回友好错误不抛异常", async () => {
        const online = await checkComfyUi(baseURL, 2_000);
        expect(online.success).toBe(true);
        expect(online.latencyMs).toBeGreaterThanOrEqual(0);
        expect(online.message).toContain("0.3.0-mock");

        const offline = await checkComfyUi("http://127.0.0.1:1", 2_000);
        expect(offline.success).toBe(false);
        expect(offline.latencyMs).toBeNull();
        expect(offline.message).toContain("无法连接");

        const invalid = await checkComfyUi("not-a-url", 2_000);
        expect(invalid.success).toBe(false);
        expect(invalid.message).toContain("地址无效");
    });

    it("功能未启用时拒绝创建任务", async () => {
        currentConfig = buildConfig(baseURL, false);
        await expect(createIllustrationJob({projectPath: "workspace/demo", request: REQUEST}))
            .rejects.toBeInstanceOf(ComfyUiJobInputError);
        currentConfig = buildConfig(baseURL, true);
    });

    it("完整生命周期：提交 → WS 进度 → completed + 图片落盘（mock）+ SSE 事件", async () => {
        mockState.promptMode = "ok";
        mockState.history = "absent";
        const events: ComfyUiJobDto[] = [];
        const unsubscribe = subscribeJobEvents((event) => {
            if (event.type === "job_update") {
                events.push(event.job);
            }
        });
        try {
            const job = await createIllustrationJob({projectPath: "workspace/demo", request: REQUEST});
            expect(job.status).toBe("pending");
            expect(job.resolvedSeed).toBe(42);
            // 内置模板确实带上了参数与 checkpoint
            await waitFor(() => mockState.promptCalls > 0, 5_000, "prompt 提交");
            const submitted = mockState.lastPromptWorkflow as Record<string, {inputs: Record<string, unknown>}>;
            expect(submitted["6"]!.inputs.text).toBe("1girl, snow");
            expect(submitted["4"]!.inputs.ckpt_name).toBe("test.safetensors");

            await waitFor(() => events.some((item) => item.jobId === job.jobId && item.status === "running"), 5_000, "running 状态");
            // WS 进度推送
            await waitFor(() => mockState.sockets.length > 0, 5_000, "WS 连接建立");
            broadcast("progress", {value: 4, max: 8});
            await waitFor(() => events.some((item) => item.jobId === job.jobId && item.progress === 0.5), 5_000, "50% 进度");

            // 完成：history 可查 + executed 事件
            mockState.history = "completed";
            broadcast("executed", {});
            await waitFor(() => events.some((item) => item.jobId === job.jobId && item.status === "completed"), 10_000, "completed 状态");

            const completed = events.findLast((item) => item.jobId === job.jobId)!;
            expect(completed.images).toHaveLength(1);
            expect(completed.images[0]!.path).toContain("assets/illustrations/");
            expect(savedImages.some((saved) => saved.jobId === job.jobId)).toBe(true);
            expect(listJobs().some((item) => item.jobId === job.jobId && item.status === "completed")).toBe(true);
        } finally {
            unsubscribe();
        }
    });

    it("ComfyUI 拒绝工作流（400 node_errors）→ 任务 failed 且错误可读", async () => {
        mockState.promptMode = "reject";
        const job = await createIllustrationJob({projectPath: "workspace/demo", request: REQUEST});
        await waitFor(() => listJobs().some((item) => item.jobId === job.jobId && item.status === "failed"), 5_000, "failed 状态");
        const failed = listJobs().find((item) => item.jobId === job.jobId)!;
        expect(failed.error).toContain("ckpt not found");
        mockState.promptMode = "ok";
    });

    it("离线（连接拒绝）→ 任务 failed，错误信息友好", async () => {
        currentConfig = buildConfig("http://127.0.0.1:1", true);
        const job = await createIllustrationJob({projectPath: "workspace/demo", request: REQUEST});
        await waitFor(() => listJobs().some((item) => item.jobId === job.jobId && item.status === "failed"), 8_000, "离线 failed");
        const failed = listJobs().find((item) => item.jobId === job.jobId)!;
        expect(failed.error).toContain("无法连接");
        currentConfig = buildConfig(baseURL, true);
    });

    it("取消 running 任务：调用 /interrupt 并标记 cancelled", async () => {
        mockState.history = "absent";
        const interruptsBefore = mockState.interruptCalls;
        const job = await createIllustrationJob({projectPath: "workspace/demo", request: REQUEST});
        await waitFor(() => listJobs().some((item) => item.jobId === job.jobId && item.status === "running"), 5_000, "running 状态");
        const cancelled = await cancelJob(job.jobId);
        expect(cancelled.status).toBe("cancelled");
        expect(mockState.interruptCalls).toBe(interruptsBefore + 1);
        // 幂等：再取消一次原样返回
        expect((await cancelJob(job.jobId)).status).toBe("cancelled");
    });

    it("执行失败（history error）→ failed 并透出 ComfyUI 异常", async () => {
        mockState.history = "absent";
        const job = await createIllustrationJob({projectPath: "workspace/demo", request: REQUEST});
        await waitFor(() => listJobs().some((item) => item.jobId === job.jobId && item.status === "running"), 5_000, "running 状态");
        mockState.history = "error";
        broadcast("execution_error", {exception_message: "CUDA out of memory"});
        await waitFor(() => listJobs().some((item) => item.jobId === job.jobId && item.status === "failed"), 5_000, "failed 状态");
        expect(listJobs().find((item) => item.jobId === job.jobId)!.error).toContain("CUDA out of memory");
    });
});
