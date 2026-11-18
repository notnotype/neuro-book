/**
 * 单元改写的拒绝（docs/specs/agent/eval.md 输出 3）：这几种代码不执行，交回能让模型改对的原因。执行的效果（变量保留、严格模式、
 * import）经真实内核在 `kernel.test.ts` 里测。
 */

import {describe, expect, test} from "bun:test";

import {rewriteCell} from "./rewrite";

const reserved = new Set(["tool", "display", "console", "require", "browser"]);
const kindOf = (code: string): string => {
    const result = rewriteCell(code, reserved);
    return result.ok ? "ok" : result.failure.kind;
};

describe("改写拒绝的代码", () => {
    test("语法错误：给出行与列，并指出出错的位置", () => {
        const result = rewriteCell("const a = 1\nconst b = ;", reserved);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failure.kind).toBe("syntax");
            expect(result.failure.message).toContain("第 2 行");
            expect(result.failure.message).toContain("const b = ;");
        }
    });

    test("TypeScript 的类型标注是语法错误，原因里提示只接受 JavaScript", () => {
        const result = rewriteCell("const x: number = 1", reserved);
        expect(!result.ok && result.failure.kind === "syntax" && result.failure.message.includes("JavaScript")).toBe(true);
    });

    test("export 不执行", () => {
        expect(kindOf("export const z = 1")).toBe("export");
    });

    test("顶层声明了内核提供的名字或全局对象名：不执行；只是读或在函数里用同名局部变量照常", () => {
        expect(kindOf("const tool = 1")).toBe("reserved-name");
        expect(kindOf("function display() {}")).toBe("reserved-name");
        expect(kindOf("import browser from \"x\"")).toBe("reserved-name");
        expect(kindOf("if (true) { var console = 1 }")).toBe("reserved-name");
        expect(kindOf("tool.read({}); function f() { const tool = 1; return tool }")).toBe("ok");
    });
});
