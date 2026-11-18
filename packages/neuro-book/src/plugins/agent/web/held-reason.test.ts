/**
 * 留着的原因文案（docs/specs/agent/conversation.md 输出 48）：逐个收口方式与停的人一例，带码与不认识的码。
 */
import {describe, expect, test} from "bun:test";

import zhCN from "../locales/zh-CN.json";
import {heldReason} from "./held-reason";

/** 照中文目录翻：按键取文字、代入参数。 */
const t = (ref: {key: string; params?: Readonly<Record<string, string | number>>}): string => {
    const text = ref.key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], zhCN) as string;
    return text.replace(/\{\{(\w+)\}\}/gu, (_, name: string) => String(ref.params?.[name]));
};

describe("留着的原因", () => {
    test("按收口方式与停的人", () => {
        expect(heldReason({cause: {end: "completed"}}, t)).toBe("上一轮已结束");
        expect(heldReason({cause: {end: "finished"}}, t)).toBe("交出结果之后");
        expect(heldReason({cause: {end: "error"}}, t)).toBe("上一轮出错");
        expect(heldReason({cause: {end: "interrupted"}}, t)).toBe("上次运行被中断");
        expect(heldReason({cause: {end: "aborted"}, heldBy: {kind: "user"}}, t)).toBe("你停止了这一轮");
        expect(heldReason({cause: {end: "aborted"}, heldBy: {kind: "session", id: "p"}}, t)).toBe("派它的 Agent 停止了");
        expect(heldReason({cause: {end: "aborted"}, heldBy: {kind: "host", source: {plugin: "x", label: "日程"}}}, t)).toBe("日程停止了");
        expect(heldReason({cause: {queued: "idle"}}, t)).toBe("空闲时排的");
        expect(heldReason({cause: {end: "something-new"}}, t)).toBe("上一轮没有正常结束");
        expect(heldReason({}, t)).toBe("上一轮没有正常结束");
    });

    test("带码时写运行没开起来；认得的码写说明，不认得的照写码", () => {
        expect(heldReason({cause: {queued: "idle", code: "no-model"}}, t)).toBe("运行没开起来：没有可用的模型");
        expect(heldReason({cause: {end: "completed", code: "reassembly-pending"}}, t)).toBe("运行没开起来：扩展正在更新");
        expect(heldReason({cause: {queued: "idle", code: "brand-new-code"}}, t)).toBe("运行没开起来：brand-new-code");
    });
});
