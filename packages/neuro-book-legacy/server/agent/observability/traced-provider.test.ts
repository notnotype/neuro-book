import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText} from "@earendil-works/pi-ai";
import type {AssistantMessageEvent, Context} from "@earendil-works/pi-ai";
import {createFauxModels, type FauxModelsFixture} from "nbook/server/agent/test-utils/faux-models";
import {PiRequestRecorder} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceRecord} from "nbook/server/agent/observability/pi-request-recorder";
import {tracedStreamSimple, sanitizeResponseHeaders} from "nbook/server/agent/observability/traced-provider";
import type {PiTraceBinding} from "nbook/server/agent/observability/traced-provider";

const context: Context = {systemPrompt: "sp", messages: [], tools: []};

async function drainTypes(stream: {[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>}): Promise<string[]> {
    const types: string[] = [];
    for await (const event of stream) {
        types.push(event.type);
    }
    return types;
}

async function readBucket(root: string, sessionId: number): Promise<PiTraceRecord[]> {
    const dir = join(root, ".nbook", "agent", "traces", String(sessionId));
    const files = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as PiTraceRecord));
}

describe("tracedStreamSimple", () => {
    let root: string;
    let recorder: PiRequestRecorder;
    let faux: FauxModelsFixture;

    beforeEach(async () => {
        root = await mkdtemp(testHostPath("traced-provider-"));
        recorder = new PiRequestRecorder({tracesRoot: join(root, ".nbook", "agent", "traces")});
        faux = createFauxModels({models: [{id: `faux-${Date.now()}`, contextWindow: 128_000, maxTokens: 8_000}]});
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    function binding(overrides: Partial<PiTraceBinding["settings"]> = {}): PiTraceBinding {
        return {
            recorder,
            settings: {enabled: true, capturePayload: true, maxRecords: 100, ...overrides},
            correlation: {kind: "turn", sessionId: 42, invocationId: "inv-1", profileKey: "leader.default", turnIndex: 0},
        };
    }

    it("透传事件与 result 与原始流一致，并落一条记录", async () => {
        // 原始流的事件序列（消费一次响应）。
        faux.setResponses([() => fauxAssistantMessage(fauxText("HELLO"))]);
        const rawTypes = await drainTypes(faux.runtime.streamSimple(faux.getModel(), context, {}));

        // 相同响应经 traced 包裹后的事件序列，应完全一致。
        faux.setResponses([() => fauxAssistantMessage(fauxText("HELLO"))]);
        const stream = tracedStreamSimple(faux.runtime, faux.getModel(), context, {}, binding());
        const wrappedTypes = await drainTypes(stream);
        const result = await stream.result();

        expect(wrappedTypes).toEqual(rawTypes);
        expect(wrappedTypes).toContain("done");
        expect(result.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toBe("HELLO");

        await recorder.flush();
        const records = await readBucket(root, 42);
        expect(records).toHaveLength(1);
        expect(records[0]!.status).toBe("ok");
        expect(records[0]!.request.model).toBe(faux.getModel().id);
        expect(records[0]!.request.context).toBeDefined();
        expect(records[0]!.response.usage).toBeDefined();
        expect(typeof records[0]!.timing.durationMs).toBe("number");
        expect(records[0]!.correlation).toMatchObject({kind: "turn", sessionId: 42, invocationId: "inv-1"});
    });

    it("关闭时不落记录，流仍可正常消费", async () => {
        faux.setResponses([() => fauxAssistantMessage(fauxText("X"))]);
        const stream = tracedStreamSimple(faux.runtime, faux.getModel(), context, {}, binding({enabled: false}));
        const types = await drainTypes(stream);
        expect(types).toContain("done");
        await recorder.flush();
        const dir = join(root, ".nbook", "agent", "traces");
        const exists = await readdir(dir).then(() => true).catch(() => false);
        expect(exists).toBe(false);
    });

    it("即使 caller 不迭代，只 await result() 也落记录（finalize 挂 result）", async () => {
        faux.setResponses([() => fauxAssistantMessage(fauxText("NOITER"))]);
        const stream = tracedStreamSimple(faux.runtime, faux.getModel(), context, {}, binding());
        await stream.result(); // 不迭代
        await recorder.flush();
        const records = await readBucket(root, 42);
        expect(records).toHaveLength(1);
        expect(records[0]!.timing.ttftMs).toBeUndefined(); // 未迭代 → 无 TTFT
    });

    it("binding 缺省时透传原始流、不落记录", async () => {
        faux.setResponses([() => fauxAssistantMessage(fauxText("NOBINDING"))]);
        const stream = tracedStreamSimple(faux.runtime, faux.getModel(), context, {});
        const types = await drainTypes(stream);
        expect(types).toContain("done");
        const dir = join(root, ".nbook", "agent", "traces");
        const exists = await readdir(dir).then(() => true).catch(() => false);
        expect(exists).toBe(false);
    });

    it("attachment 请求只记录独立 safe context，并省略 provider payload", async () => {
        const data = "A".repeat(200_000);
        const providerContext: Context = {
            systemPrompt: "sp",
            messages: [{role: "user", content: [{type: "image", mimeType: "image/png", data}], timestamp: 1}],
            tools: [],
        };
        const safeContext: Context = {
            systemPrompt: "sp",
            messages: [{role: "user", content: "[attachment omitted: image/png, 150000 bytes]", timestamp: 1}],
            tools: [],
        };
        faux.setResponses([() => fauxAssistantMessage(fauxText("SAFE"))]);
        const stream = tracedStreamSimple(faux.runtime, faux.getModel(), providerContext, {}, binding(), {
            context: safeContext,
            payloadOmittedReason: "attachment",
        });
        await stream.result();
        await recorder.flush();

        const [record] = await readBucket(root, 42);
        expect(record?.request.context).toEqual(safeContext);
        expect(record?.request.payload).toBeUndefined();
        expect(record?.request.payloadOmittedReason).toBe("attachment");
        expect(JSON.stringify(record)).not.toContain(data);
    });
});

describe("sanitizeResponseHeaders", () => {
    it("凭据/会话头被删，ratelimit 与常规调试头保留，token/secret/api-key 子串命中被删", () => {
        const kept = sanitizeResponseHeaders({
            "request-id": "req_1",
            "retry-after": "3",
            "anthropic-ratelimit-input-tokens-remaining": "1000",
            "Set-Cookie": "sid=abc",
            "authorization": "Bearer x",
            "x-api-key": "k",
            "X-Auth-Token": "t",
            "x-gateway-secret": "s",
            "content-type": "application/json",
        });
        expect(kept).toEqual({
            "request-id": "req_1",
            "retry-after": "3",
            "anthropic-ratelimit-input-tokens-remaining": "1000",
            "content-type": "application/json",
        });
    });

    it("undefined 透传 undefined，全敏感时落空对象", () => {
        expect(sanitizeResponseHeaders(undefined)).toBeUndefined();
        expect(sanitizeResponseHeaders({"set-cookie": "a"})).toEqual({});
    });
});
