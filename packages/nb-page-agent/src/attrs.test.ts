/** 稳定名的属性（docs/specs/agent/page-agent.md 输出 6）。 */

import {describe, expect, it} from "bun:test";

import {nbTarget} from "./attrs";

describe("nbTarget", () => {
    it("交回 data-nb-target，给了 key 时另有 data-nb-key", () => {
        expect(nbTarget("workbench.view")).toEqual({"data-nb-target": "workbench.view"});
        expect(nbTarget("settings.row", "nbook.workbench/theme")).toEqual({"data-nb-target": "settings.row", "data-nb-key": "nbook.workbench/theme"});
        expect(nbTarget("command", "nbook.files.new")).toEqual({"data-nb-target": "command", "data-nb-key": "nbook.files.new"});
    });

    it("名字不是点分的小写段、key 是空串时抛出", () => {
        for (const name of ["", "Workbench.view", "workbench..view", "workbench.view.", ".view", "workbench view", "工作台"]) {
            expect(() => nbTarget(name), name).toThrow(TypeError);
        }
        expect(() => nbTarget("workbench.view", "")).toThrow(TypeError);
    });
});
