/**
 * 诊断 code ↔ i18n 文案的完备性门（Task 126 批次 D）。
 *
 * 增删诊断却忘了配文案，会在这里直接红——比等到面板上出现裸 key 才发现要早得多。
 */
import {describe, expect, it} from "vitest";
import {CONTEXT_DIAGNOSTIC_CODES} from "nbook/server/agent/observability/context-diagnostics";
import zhCN from "nbook/app/i18n/locales/zh-CN";
import enUS from "nbook/app/i18n/locales/en-US";

/** `nearCompaction` 在剩余轮次估不出来时走独立文案，不属于 code 集合但同样必须两个语言都有。 */
const EXTRA_MESSAGE_KEYS = ["nearCompactionUnknown"] as const;

const LOCALES = {"zh-CN": zhCN, "en-US": enUS} as const;

describe("上下文诊断文案完备性", () => {
    for (const [name, locale] of Object.entries(LOCALES)) {
        it(`${name} 覆盖全部诊断 code`, () => {
            const messages = locale.agent.contextInspector.diagnostics as Record<string, string | undefined>;
            const missing = CONTEXT_DIAGNOSTIC_CODES.filter((code) => !messages[code]?.trim());
            expect(missing).toEqual([]);
        });

        it(`${name} 覆盖派生文案`, () => {
            const messages = locale.agent.contextInspector.diagnostics as Record<string, string | undefined>;
            expect(EXTRA_MESSAGE_KEYS.filter((key) => !messages[key]?.trim())).toEqual([]);
        });

        it(`${name} 覆盖全部分区名`, () => {
            const segments = locale.agent.contextInspector.segment as Record<string, string | undefined>;
            const kinds = ["system", "tools", "historySet", "conversation", "modelContext", "appending", "currentInput"];
            expect(kinds.filter((kind) => !segments[kind]?.trim())).toEqual([]);
        });
    }

    it("两个语言的诊断文案 key 集合完全一致", () => {
        const zhKeys = Object.keys(zhCN.agent.contextInspector.diagnostics).sort();
        const enKeys = Object.keys(enUS.agent.contextInspector.diagnostics).sort();
        expect(zhKeys).toEqual(enKeys);
    });
});
