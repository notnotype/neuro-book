/**
 * 远程层的大小规则（docs/specs/agent/sessions.md 输出 9）：分段不切断多字节字符，一页日志按编码后的字节截断。
 */

import {describe, expect, test} from "bun:test";

import type {LogEvent} from "@notnotype/nb-harness/kernel/contracts";

import {CHUNK_BYTES, chunkOf, EVENT_INLINE_BYTES, PAGE_BYTES, pageOfItems} from "./frames";

const event = (seq: number, text: string): LogEvent => ({id: `e${String(seq)}`, seq, at: seq, parent: null, scope: "path", kind: "conv", type: "toolResult", version: 1, source: "kernel", data: {text}}) as LogEvent;

describe("大小", () => {
    test("输出 9：按字节分段，多字节字符不被切断，拼回来与原文相同；超出范围为 null", () => {
        const text = `a${"字".repeat(CHUNK_BYTES)}`;
        const parts: string[] = [];
        for (let index = 0; ; index += 1) {
            const chunk = chunkOf(text, index);
            if (chunk === null) throw new Error("ran past the end");
            expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(CHUNK_BYTES);
            parts.push(chunk.text);
            if (chunk.last) break;
        }
        expect(parts.join("")).toBe(text);
        expect(chunkOf(text, parts.length)).toBeNull();
        expect(chunkOf("", 0)).toEqual({text: "", last: true});
    });

    test("输出 9：一页日志编码后不超过 512 KiB，至少给一条；大事件换成占位", () => {
        const medium = "x".repeat(EVENT_INLINE_BYTES - 1_000);
        const events = [1, 2, 3, 4].map((seq) => event(seq, medium));
        const page = pageOfItems(events);
        expect(page.cut).toBe(true);
        expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(PAGE_BYTES);
        // 每条约 255 KiB，页还要给外层留余量：放下一条，第二条放不下。
        expect(page.items.map((item) => item.kind)).toEqual(["event"]);
        const huge = pageOfItems([event(1, "x".repeat(EVENT_INLINE_BYTES))]);
        expect(huge).toEqual({items: [{kind: "oversized", seq: 1, type: "toolResult", bytes: expect.any(Number)}], cut: false});
    });
});
