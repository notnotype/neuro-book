/**
 * e2e 的范围闸（docs/testing/README.md 的“验证门禁”）：什么样的命令放行、什么样的拒绝。真实命令行的路径在 w00001 的 Task 记录里核过。
 */
import {describe, expect, it} from "bun:test";

import {selectedFiles, WIDE_RUN_ENV, wideRunProblem} from "./wide-run-guard";

const ROOT = "/repo/.worktree/feature-lab/packages/neuro-book/e2e";
const FILES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo"].map((name) => `${ROOT}/${name}.e2e.ts`);
const COMMAND = ["node", "playwright", "test", "-c", "e2e/playwright.config.ts"];
const problem = (args: ReadonlyArray<string>, reason?: string) => wideRunProblem({argv: [...COMMAND, ...args], files: FILES, reason});
const first = (count: number) => FILES.slice(0, count).map((file) => file.slice(file.indexOf("e2e/")).replace(".ts", ""));

describe("放行", () => {
    it.each<[string, ReadonlyArray<string>]>([
        ["一个文件", first(1)],
        ["正好 8 个文件", first(8)],
        ["带行号", [`${first(1)[0] as string}:12`]],
        ["只重跑上次失败的", ["--last-failed"]],
        ["只列出", ["--list"]],
        ["按用例名挑", ["-g", "某条用例"]],
        ["按用例名挑（等号写法）", ["--grep=某条用例"]],
    ])("%s", (_name, args) => {
        expect(problem(args)).toBeNull();
    });

    it("带上理由：超过上限也放行", () => {
        expect(problem([], "发布前的全量验收")).toBeNull();
        expect(problem(first(11), "发布前的全量验收")).toBeNull();
    });

    it("工作进程：参数里没有 test，不查", () => {
        expect(wideRunProblem({argv: ["node", "processEntry"], files: FILES, reason: undefined})).toBeNull();
    });
});

describe("拒绝", () => {
    it("超过 8 个文件：说出选中了几个、规则、怎么放行", () => {
        const message = problem(first(9));
        expect(message).toContain("9 个");
        expect(message).toContain("docs/testing/README.md");
        expect(message).toContain(WIDE_RUN_ENV);
    });

    it("没给过滤词是整包", () => {
        expect(problem([])).toContain("11 个");
    });

    it("理由是空白不算", () => {
        expect(problem([], "   ")).toContain("11 个");
    });

    it("选项的值不算过滤词：`--reporter line` 不把 line 当文件", () => {
        expect(problem([...first(1), "--reporter", "line", "--workers", "1"])).toBeNull();
        expect(problem(first(1).concat("--reporter=line"))).toBeNull();
    });

    it("过滤词按绝对路径匹配：worktree 目录名里含这个词时选中的是全部，也要拦", () => {
        expect(selectedFiles(FILES, ["lab"])).toHaveLength(FILES.length);
        expect(problem(["lab"])).toContain("11 个");
    });
});
