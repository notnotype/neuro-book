/**
 * “最后一句话”的摘要规则（docs/specs/bots/bots.md 输出 7）。
 */

import {describe, expect, it} from "bun:test";

import {messageSummary, SUMMARY_MAX} from "./summary";

const text = (value: string) => ({kind: "text" as const, text: value});

describe("最后一句话的摘要", () => {
    it("只取文字块，空白折叠成一个空格；表情写法换成“[表情]”", () => {
        expect(messageSummary([{kind: "thinking", text: "先想想"}, text("你好呀，\n\n  Master。"), text(":lyra/开心:")])).toBe("你好呀， Master。[表情]");
        expect(messageSummary([text(":builtin.lyra/挥手:")])).toBe("[表情]");
    });

    it("按码点截到上限，超了加省略号；表情符号不被劈开", () => {
        const long = "🙂".repeat(SUMMARY_MAX + 5);
        const summary = messageSummary([text(long)]);
        expect(Array.from(summary)).toHaveLength(SUMMARY_MAX + 1);
        expect(summary.endsWith("🙂…")).toBe(true);
        expect(messageSummary([text("短")])).toBe("短");
    });

    it("没有文字：有图片写“[图片]”，否则写“[消息]”", () => {
        expect(messageSummary([{kind: "image", data: "", mime: "image/png"}])).toBe("[图片]");
        expect(messageSummary([text("   ")])).toBe("[消息]");
        expect(messageSummary([])).toBe("[消息]");
    });
});
