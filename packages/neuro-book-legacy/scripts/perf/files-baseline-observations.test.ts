import {describe, expect, it} from "vitest";
import {composition, stats, summarize, summarizeCpu, type CpuProfile, type Sample} from "./files-baseline-observations";

function sample(status: "pass" | "fail", durationMs: number): Sample {
    return {
        id: status, environment: "production", scenario: "C", variant: "cold-rich-1-group-tree", iteration: 0,
        status, error: status === "fail" ? "输入失败" : null, operationStartTime: 100, operationEndTime: 100 + durationMs, durationMs,
        readiness: {}, requests: [], userTiming: [], longTasks: [], longAnimationFrames: [], observerSupport: [], loadAverage: [],
    };
}

describe("Files 测量统计", () => {
    it("失败操作不进入分位数，同名 measure 聚合且不混入 mark", () => {
        const first = sample("pass", 100);
        first.userTiming = [
            {name: "files.activation", entryType: "mark", startTime: 110, duration: 0},
            {name: "files.activation", entryType: "measure", startTime: 110, duration: 10},
        ];
        const second = sample("pass", 300);
        second.userTiming = [{name: "files.activation", entryType: "measure", startTime: 110, duration: 30}];
        const result = summarize([first, sample("fail", 60_000), second]);
        expect(result.duration!["production/C/cold-rich-1-group-tree"]).toEqual(stats([100, 300]));
        expect(result.userTiming).toEqual({"production/C/cold-rich-1-group-tree/files.activation": stats([10, 30])});
    });

    it("重叠阶段按时间线切分，总和仍等于正文就绪耗时", () => {
        const item = sample("pass", 200);
        item.userTiming = [
            {name: "files.activation", entryType: "measure", startTime: 180, duration: 60},
            {name: "editor.session.publish", entryType: "measure", startTime: 240, duration: 10},
            {name: "editor.view.publish", entryType: "measure", startTime: 280, duration: 30},
        ];
        const result = composition(item);
        expect(result).toEqual({clickToActivation: 80, activationToReadEnd: 0, readEndToSession: 70, sessionToView: 50, viewToEditable: 0});
        expect(Object.values(result).reduce((sum, duration) => sum + duration, 0)).toBe(200);
    });

    it("非单调采样时间排序后归类，截取窗口不产生负时长或超额时间", () => {
        const profile: CpuProfile = {
            nodes: [
                {id: 1, callFrame: {functionName: "(root)", url: "", lineNumber: -1}, children: [2, 3]},
                {id: 2, callFrame: {functionName: "parseMarkdownDocument", url: "server.js", lineNumber: 10}},
                {id: 3, callFrame: {functionName: "readdir", url: "server.js", lineNumber: 20}},
            ],
            samples: [2, 3, 2], timeDeltas: [2000, -1000, 2000], startTime: 0, endTime: 4000,
        };
        const full = summarizeCpu(profile, "server");
        const cropped = summarizeCpu(profile, "server", {startTime: 1000, endTime: 3000});
        expect(full.negativeDeltaCount).toBe(1);
        expect(full.categories).toEqual({"目录与索引（含路径校验）": 1, "frontmatter 与 YAML": 3});
        expect(cropped.categories).toEqual({"frontmatter 与 YAML": 2});
        expect(Object.values(cropped.categories).reduce((sum, duration) => sum + duration, 0)).toBe(cropped.spanMs);
    });

    it("压缩名字相同但脚本或函数范围不同，不混入 Vue 遍历 CPU", () => {
        const url = "http://127.0.0.1:42017/_nuxt/vue.js";
        const profile: CpuProfile = {
            nodes: [
                {id: 1, callFrame: {functionName: "go", url, lineNumber: 1, columnNumber: 10}},
                {id: 2, callFrame: {functionName: "go", url: "http://127.0.0.1:42017/_nuxt/other.js", lineNumber: 1, columnNumber: 10}},
                {id: 3, callFrame: {functionName: "go", url, lineNumber: 1, columnNumber: 100}},
            ],
            samples: [1, 2, 3], timeDeltas: [1000, 1000, 1000], startTime: 0, endTime: 3000,
        };
        const result = summarizeCpu(profile, "browser", undefined, [{sourceSymbol: "Vue traverse", compiledName: "go", url,
            lineNumber: 1, columnNumber: 0, endLineNumber: 1, endColumnNumber: 50, category: "Vue 深度遍历", matchedBy: []}]);
        expect(result.categories).toEqual({"Vue 深度遍历": 1, "未归类 CPU": 2});
    });
});
