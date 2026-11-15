import {describe, expect, it} from "bun:test";

import {baselineProblems, dataBaseline, lineCount, logEntries, orderlyStopProblems, updateChecks} from "./facts";

// 形状照适配层 `log` 写的行（desktop/src/bun/index.ts）：时间、事件、细节；失败时细节是错误栈，可能多行。
const LOG = [
    "2026-11-15T08:00:00.000Z start version=0.12.2 bun=1.4.4 programRoot=C:\\x root={}",
    "2026-11-15T08:00:02.000Z desktop.server.ready pid=4242",
    "2026-11-15T08:00:03.000Z desktop.update.checked remote=0.12.1 local=0.12.2 result=older",
    "2026-11-15T08:00:09.000Z desktop.server.stopped forced=false exitCode=0",
    "2026-11-15T08:00:09.100Z exit 0",
    "",
].join("\n");

describe("读壳的日志", () => {
    it("按行读出事件与 key=value；从某一行之后读", () => {
        const entries = logEntries(LOG);
        expect(entries.map((entry) => entry.event)).toEqual(["start", "desktop.server.ready", "desktop.update.checked", "desktop.server.stopped", "exit"]);
        expect(entries[1]?.fields).toEqual({pid: "4242"});
        expect(logEntries(LOG, 3).map((entry) => entry.event)).toEqual(["desktop.server.stopped", "exit"]);
        expect(lineCount(LOG)).toBe(5);
        expect(lineCount("")).toBe(0);
    });

    it("错误栈的续行不是条目", () => {
        expect(logEntries("2026-11-15T08:00:00.000Z fatal Error: x\n    at y (z.ts:1)\n")).toHaveLength(1);
    });

    it("更新检查的结论", () => {
        expect(updateChecks(logEntries(LOG))).toEqual([{remote: "0.12.1", local: "0.12.2", result: "older"}]);
    });
});

describe("服务端有序以 0 停止", () => {
    it("就绪之后经停止路径以 0 停完：通过；给了 PID 时要是这一个", () => {
        expect(orderlyStopProblems(logEntries(LOG))).toEqual([]);
        expect(orderlyStopProblems(logEntries(LOG), 4242)).toEqual([]);
        expect(orderlyStopProblems(logEntries(LOG), 1)[0]).toContain("不是这次壳拉起的 1");
    });

    it("意外退出过、被强制结束、没有经停止路径、没有就绪过：都报出（壳以 0 退出也不算数）", () => {
        const exited = logEntries(LOG.replace("desktop.update.checked", "desktop.server.exited exitCode=1 x"));
        expect(orderlyStopProblems(exited).join("\n")).toContain("意外退出");
        expect(orderlyStopProblems(logEntries(LOG.replace("forced=false", "forced=true")))[0]).toContain("forced=true");
        expect(orderlyStopProblems(logEntries(LOG.replace(/.*desktop\.server\.stopped.*\n/u, "")))[0]).toContain("不是经停止路径");
        expect(orderlyStopProblems(logEntries(LOG.replace(/.*desktop\.server\.ready.*\n/u, "")))[0]).toContain("没有就绪过");
    });
});

describe("数据基线", () => {
    const projects = JSON.stringify({schema: 1, projects: [{id: "a", name: "一", path: "C:\\books\\一"}, {id: "b", name: "二", path: "C:\\books\\二"}]});
    const settings = JSON.stringify({"nbook.models/providers": [{id: "local"}], "nbook.models/roles": {items: []}, "nbook.workbench/theme": "light"});

    it("作品登记与模型设置不变、那一章不变：没有问题；别的设置项变了、多了作品不算问题", () => {
        const before = dataBaseline(projects, settings, "雨越下越大。");
        const grown = JSON.stringify({schema: 1, projects: [...JSON.parse(projects).projects, {id: "c", path: "C:\\books\\三"}]});
        expect(baselineProblems(before, dataBaseline(grown, settings.replace("light", "dark"), "雨越下越大。"))).toEqual([]);
    });

    it("少了作品、模型设置变了或被清空、章节变了：逐条报出", () => {
        const before = dataBaseline(projects, settings, "雨越下越大。");
        const after = dataBaseline(JSON.stringify({schema: 1, projects: [{id: "a", path: "C:\\books\\一"}]}), "{}", "");
        expect(baselineProblems(before, after)).toHaveLength(3);
    });
});
