import {describe, expect, it} from "vitest";
import {emptyContextFacts, resolveModelCacheRetention, timelineDto} from "nbook/server/agent/observability/context-inspection";
import {resolveCompactionTriggerTokens, type CompactionOptions} from "nbook/server/agent/harness/compaction";
import type {Model} from "nbook/server/agent/messages/types";
import type {PiTraceIndexEntry} from "nbook/server/agent/observability/pi-request-recorder";

function model(api: string): Model<any> {
    return {api, id: "m1", provider: "p"} as unknown as Model<any>;
}

function options(partial: Partial<CompactionOptions> = {}): CompactionOptions {
    return {
        enabled: true,
        reserveTokens: 20_000,
        keepRecentTokens: 10_000,
        prompt: "",
        summaryPrefix: "",
        promptSource: "default",
        summaryPrefixSource: "default",
        ...partial,
    };
}

describe("resolveModelCacheRetention", () => {
    it("Anthropic 家族有显式断点，默认 5 分钟", () => {
        expect(resolveModelCacheRetention(model("anthropic-messages"), {})).toEqual({kind: "short", seconds: 300});
        expect(resolveModelCacheRetention(model("bedrock-converse-stream"), {})).toEqual({kind: "short", seconds: 300});
    });

    it("显式 long 档换成 1 小时", () => {
        expect(resolveModelCacheRetention(model("anthropic-messages"), {cacheRetention: "long"})).toEqual({kind: "long", seconds: 3600});
    });

    it("PI_CACHE_RETENTION=long 与 pi 的解析顺序一致", () => {
        expect(resolveModelCacheRetention(model("anthropic-messages"), {env: {PI_CACHE_RETENTION: "long"}})).toEqual({kind: "long", seconds: 3600});
    });

    it("显式 cacheRetention 优先于 env", () => {
        expect(resolveModelCacheRetention(model("anthropic-messages"), {
            cacheRetention: "short",
            env: {PI_CACHE_RETENTION: "long"},
        })).toEqual({kind: "short", seconds: 300});
    });

    it("none 档保留期为 0，仍算显式控制", () => {
        expect(resolveModelCacheRetention(model("anthropic-messages"), {cacheRetention: "none"})).toEqual({kind: "none", seconds: 0});
    });

    it("OpenAI Completions 走自动前缀缓存，不编一个保留期出来", () => {
        expect(resolveModelCacheRetention(model("openai-completions"), {})).toBeNull();
        expect(resolveModelCacheRetention(model("openai-completions"), {cacheRetention: "long"})).toBeNull();
    });

    it("OpenAI Responses 只有 long 档才传 24h 保留期，其余档位仍是自动缓存", () => {
        expect(resolveModelCacheRetention(model("openai-responses"), {})).toBeNull();
        expect(resolveModelCacheRetention(model("openai-responses"), {cacheRetention: "long"})).toEqual({kind: "long", seconds: 86_400});
    });
});

describe("resolveCompactionTriggerTokens", () => {
    it("关闭压缩时没有触发线", () => {
        expect(resolveCompactionTriggerTokens(options({enabled: false}), 100_000)).toBeNull();
    });

    it("triggerTokens 优先，与 shouldCompactWithOptions 的判定顺序一致", () => {
        expect(resolveCompactionTriggerTokens(options({triggerTokens: 50_000, triggerPercent: 0.5}), 200_000)).toBe(50_000);
    });

    it("其次按 triggerPercent 折算窗口", () => {
        expect(resolveCompactionTriggerTokens(options({triggerPercent: 0.8}), 200_000)).toBe(160_000);
    });

    it("最后退回 window - reserveTokens", () => {
        expect(resolveCompactionTriggerTokens(options({reserveTokens: 20_000}), 200_000)).toBe(180_000);
    });

    it("按窗口推算却拿不到窗口时返回 null，不编数字", () => {
        expect(resolveCompactionTriggerTokens(options({triggerPercent: 0.8}), null)).toBeNull();
        expect(resolveCompactionTriggerTokens(options(), null)).toBeNull();
    });

    it("绝对 token 触发线不依赖窗口", () => {
        expect(resolveCompactionTriggerTokens(options({triggerTokens: 50_000}), null)).toBe(50_000);
    });
});

describe("timelineDto / emptyContextFacts", () => {
    it("只保留面板用得到的列，不透传 bytes / ttft", () => {
        const entries: PiTraceIndexEntry[] = [{
            id: "1",
            ts: "2026-07-27T00:00:00Z",
            status: "ok",
            kind: "turn",
            provider: "p",
            model: "m1",
            bytes: 1234,
            ttftMs: 55,
            durationMs: 900,
            toolsHash: "abcd1234",
            usage: {input: 1, output: 2, cacheRead: 3, cacheWrite: 4},
        }];

        expect(timelineDto(entries)).toEqual([{
            id: "1",
            ts: "2026-07-27T00:00:00Z",
            kind: "turn",
            model: "m1",
            toolsHash: "abcd1234",
            usage: {input: 1, output: 2, cacheRead: 3, cacheWrite: 4},
        }]);
    });

    it("缺 usage / toolsHash 的旧记录不产出 undefined 字段", () => {
        const dto = timelineDto([{
            id: "1",
            ts: "2026-07-27T00:00:00Z",
            status: "ok",
            kind: "turn",
            provider: "p",
            model: "m1",
            bytes: 10,
        }]);
        expect(Object.keys(dto[0]!)).toEqual(["id", "ts", "kind", "model"]);
    });

    it("事实兜底全为 null，面板据此仍能打开", () => {
        expect(emptyContextFacts()).toEqual({contextWindowTokens: null, compactionTriggerTokens: null, cacheRetention: null});
    });
});
