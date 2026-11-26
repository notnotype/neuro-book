import {describe, expect, test} from "bun:test";

import {EVENT_SCHEMA, EXECUTOR_FORMAT, buildSteps, clipMiddle, parseEventLine} from "./adapter";
import type {ExecutorOutput} from "./adapter";

function output(steps: ExecutorOutput["steps"]): ExecutorOutput {
    return {format: EXECUTOR_FORMAT, status: "completed", success: true, finalAnswer: "答案：x", error: null, partial: null, usage: {input: 10}, steps, thinking: [], deliverables: [], versions: {}};
}

describe("browser-use 的适配", () => {
    test("标准输出里只认带 schema 的事件行，browser-use 自己打的行与坏 JSON 都跳过", () => {
        expect(parseEventLine(JSON.stringify({schema: EVENT_SCHEMA, event: "step", line: "goto(x)", at: 1}))).toMatchObject({event: "step", line: "goto(x)"});
        expect(parseEventLine("INFO [browser_use] step 1: goto(x)")).toBeNull();
        expect(parseEventLine("{not json")).toBeNull();
        expect(parseEventLine(JSON.stringify({schema: "other", event: "step"}))).toBeNull();
        expect(parseEventLine(JSON.stringify({schema: EVENT_SCHEMA, event: "unknown"}))).toBeNull();
    });

    test("代码段与步骤事件按内容配：事件行是代码第一个非空行，一个回复里两段代码就是两个步骤，各带到达时刻与页面目标", () => {
        const steps = buildSteps(output([{code: "\na()\nmore()", output: "1", error: null}, {code: "b()", output: "2", error: "boom"}]), [
            {line: "a()", at: 100, targets: [{targetId: "T1", url: "http://x/"}]},
            {line: "b() -> boom", at: 200, targets: []},
        ]);
        expect(steps.map((s) => [s.ordinal, s.code, s.output, s.error, s.endedAt, s.targets.length, s.executed])).toEqual([[1, "\na()\nmore()", "1", null, 100, 1, true], [2, "b()", "2", "boom", 200, 0, true]]);
    });

    test("中间有一段没执行（参数没过校验、时间用完被跳过）：它记为没执行、沿用前一步的时刻，后面的步骤不错位", () => {
        const steps = buildSteps(output([{code: "a()", output: "", error: null}, {code: "b()", output: "", error: null}, {code: "c()", output: "", error: null}]), [
            {line: "a()", at: 10, targets: [{targetId: "A", url: "http://a/"}]},
            {line: "c()", at: 30, targets: [{targetId: "C", url: "http://c/"}]},
        ]);
        expect(steps.map((s) => [s.code, s.executed, s.event, s.endedAt, s.targets[0]?.targetId])).toEqual([["a()", true, 1, 10, "A"], ["b()", false, null, 10, "A"], ["c()", true, 2, 30, "C"]]);
    });

    test("被兜底结束、没有 executor.json：步骤只有事件里那一行代码，输出为空", () => {
        const steps = buildSteps(null, [{line: "goto(x)", at: 5, targets: []}]);
        expect(steps).toEqual([{ordinal: 1, code: "goto(x)", output: "", error: null, event: 1, endedAt: 5, targets: [], executed: true}]);
    });

    test("最后一段没赶上发事件：它记为没执行，用最后一个已知时刻", () => {
        const steps = buildSteps(output([{code: "a()", output: "", error: null}, {code: "b()", output: "", error: null}]), [{line: "a()", at: 7, targets: []}]);
        expect(steps.map((s) => [s.endedAt, s.executed])).toEqual([[7, true], [7, false]]);
    });

    test("长输出掐中间，留开头与结尾", () => {
        const clipped = clipMiddle("a".repeat(30) + "b".repeat(30), 20);
        expect(clipped.startsWith("a".repeat(10))).toBe(true);
        expect(clipped.endsWith("b".repeat(10))).toBe(true);
        expect(clipped).toContain("[40 characters omitted]");
        expect(clipMiddle("short", 20)).toBe("short");
    });
});
