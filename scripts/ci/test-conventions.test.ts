// test-lint-allow-file: 本文件的字符串是规则的正反样例
import {describe, expect, it} from "vitest";

import {partitionTestFindings, scanTestSource} from "#scripts/ci/test-conventions";

function rules(source: string, path = "packages/x/src/a.test.ts"): string[] {
    return scanTestSource(path, source).map((finding) => `${String(finding.line)}:${finding.rule}`);
}

describe("测试文件规则", () => {
    it("查出模块 mock、spyOn、固定等待、only/skip/todo 与快照", () => {
        const source = [
            'mock.module("./db", () => ({}));',
            'vi.mock("./db");',
            "spyOn(service, \"save\");",
            "await Bun.sleep(200);",
            "await new Promise((resolve) => setTimeout(resolve, 50));",
            'it.only("x", () => {});',
            'test.skip("x", () => {});',
            'describe.todo("x");',
            "expect(tree).toMatchSnapshot();",
        ].join("\n");
        expect(rules(source)).toEqual([
            "1:module-mock",
            "2:module-mock",
            "3:spy",
            "4:fixed-wait",
            "5:fixed-wait",
            "6:focus-or-skip",
            "7:focus-or-skip",
            "8:focus-or-skip",
            "9:snapshot",
        ]);
    });

    it("让出一轮事件循环、按条件跳过与注释行不算违反", () => {
        const source = [
            "return new Promise((resolve) => setTimeout(resolve, 0));",
            "await Bun.sleep(0);",
            'it.skipIf(process.platform === "win32")("x", () => {});',
            "describe.skipIf(llm === null)(\"真实模型\", () => {});",
            "// 不用 Bun.sleep(100) 等待",
        ].join("\n");
        expect(rules(source)).toEqual([]);
    });

    it("写了理由的例外标记放行同一行或下一行；没有理由不放行", () => {
        const source = [
            "// test-lint-allow fixed-wait: 否定断言，给读取推进的机会",
            "await Bun.sleep(5);",
            "await Bun.sleep(5); // test-lint-allow fixed-wait, spy: 同上",
            "// test-lint-allow fixed-wait:",
            "await Bun.sleep(5);",
        ].join("\n");
        expect(rules(source)).toEqual(["5:fixed-wait"]);
    });

    it("整文件豁免只认文件开头的标记，并且要写理由", () => {
        const marker = "// test-lint-allow-file: 规则样例\nawait Bun.sleep(5);";
        expect(rules(marker)).toEqual([]);
        expect(rules("// test-lint-allow-file:\nawait Bun.sleep(5);")).toEqual(["2:fixed-wait"]);
    });

    it("读模型凭据只允许出现在 *.llm.test.ts", () => {
        const source = "const key = process.env.DEEPSEEK_API_KEY;\nconst llm = llmTestConfig();";
        expect(rules(source)).toEqual(["1:llm-credential", "2:llm-credential"]);
        expect(rules(source, "packages/x/tests/a.llm.test.ts")).toEqual([]);
    });

    it("新应用与内核包的违反是失败，其它包是警告", () => {
        const finding = {line: 3, rule: "fixed-wait", detail: "按固定时长等待"} as const;
        const {failures, warnings} = partitionTestFindings([
            {...finding, path: "packages/neuro-book/src/a.test.ts"},
            {...finding, path: "packages/nb-runtime/src/b.test.ts"},
            {...finding, path: "packages/nb-ui/src/c.test.ts"},
        ]);
        expect(failures).toEqual([
            "测试规则 fixed-wait：packages/neuro-book/src/a.test.ts:3 按固定时长等待",
            "测试规则 fixed-wait：packages/nb-runtime/src/b.test.ts:3 按固定时长等待",
        ]);
        expect(warnings).toEqual([{path: "packages/nb-ui/src/c.test.ts", label: "测试规则 fixed-wait", detail: "packages/nb-ui/src/c.test.ts:3 按固定时长等待"}]);
    });
});
