import {describe, expect, it} from "vitest";
import type {ViewText} from "./agent-view.types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";
import {describeChain, describeTurn} from "./process-summary";

const chain = (overrides: Partial<ChainSummary>): ChainSummary => ({
    steps: 0, filesRead: 0, filesChanged: 0, others: 0, failed: 0, thinking: false, messages: 1, ...overrides,
});

function keys(parts: ViewText[]): string[] {
    return parts.map((part) => typeof part === "string" ? part : part.key.replace("agentView.process.", ""));
}

describe("describeChain", () => {
    it("读和改写成同一句，其余操作另起一段", () => {
        const result = describeChain(chain({thinking: true, steps: 4, filesRead: 2, filesChanged: 1, others: 1}));
        expect(keys(result.parts)).toEqual(["thinking", "files.readChanged", "others"]);
        expect(result.alert).toBeNull();
    });

    it("没有读改文件时，其余操作直接写次数", () => {
        expect(keys(describeChain(chain({steps: 2, others: 2})).parts)).toEqual(["actions"]);
    });

    it("什么都没有时退回“过程”，失败次数单独作为提醒", () => {
        const result = describeChain(chain({steps: 1, failed: 1}));
        expect(keys(result.parts)).toEqual(["fallback"]);
        expect(result.alert).toEqual({key: "agentView.process.failed", params: {count: 1}});
    });
});

describe("describeTurn", () => {
    it("以“过程”开头，写总操作次数与读改文件数", () => {
        const metrics = {steps: 14, filesRead: 7, filesChanged: 2, failed: 0} as TurnMetrics;
        expect(keys(describeTurn(metrics).parts)).toEqual(["fallback", "actions", "files.readChanged"]);
    });
});
