import {describe, expect, it} from "vitest";
import type {GlobalConfigDto} from "nbook/shared/dto/config.dto";
import {buildObservabilityPayload, clampObservabilityMaxRecords, createObservabilityDraft} from "./observability-settings-draft";

/** 只放被测字段，其余从略。 */
function globalWith(observability: unknown): GlobalConfigDto {
    return {observability} as GlobalConfigDto;
}

describe("observability-settings-draft", () => {
    it("global 里没写过 piTrace 时落默认值", () => {
        expect(createObservabilityDraft(undefined)).toEqual({enabled: true, maxRecords: 100});
        expect(createObservabilityDraft(globalWith({}))).toEqual({enabled: true, maxRecords: 100});
    });

    it("读已配置的 piTrace 值", () => {
        expect(createObservabilityDraft(globalWith({piTrace: {enabled: false, maxRecords: 20, capturePayload: true}})))
            .toEqual({enabled: false, maxRecords: 20});
    });

    it("写回体保留 capturePayload 等手写字段", () => {
        const payload = buildObservabilityPayload(globalWith({piTrace: {capturePayload: true}}), {enabled: false, maxRecords: 500});

        expect(payload.observability).toEqual({piTrace: {capturePayload: true, enabled: false, maxRecords: 500}});
    });

    it("没有 observability 段时也能构造写回体", () => {
        expect(buildObservabilityPayload(undefined, {enabled: true, maxRecords: 100}))
            .toEqual({observability: {piTrace: {enabled: true, maxRecords: 100}}});
    });

    it("保留条数夹到 0..10000 的整数", () => {
        expect(clampObservabilityMaxRecords(-5)).toBe(0);
        expect(clampObservabilityMaxRecords(20000)).toBe(10000);
    });
});
