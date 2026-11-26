import {describe, expect, it} from "bun:test";

import {createGrid} from "@notnotype/nb-layout";
import {createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";

import {recordGridIssues} from "./grid-diagnostics";
import type {WorkbenchGridIssue} from "./grid-diagnostics";

/**
 * 网格的诊断进窗口的诊断（docs/specs/ui/workbench-layout.md 的“失败与恢复”）：真实的网格算出、真实的结构操作返回的诊断，
 * 交进真实的诊断存储，按查询读回来的记录断言级别、消息与数据。
 */

const PLUGIN = "nbook.workbench";

function record(issues: readonly WorkbenchGridIssue[]) {
    const store = createDiagnosticsStore({identity: {location: "browser", instanceId: "grid-diagnostics"}});
    recordGridIssues(store, issues, PLUGIN);
    return store.query({}).records;
}

function twoColumns() {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, minimumSize: {width: 200, height: 0}},
            {kind: "leaf", id: "right", ref: "right", size: {width: 500, height: 0}, minimumSize: {width: 200, height: 0}},
        ],
    }, {sashSize: 4});
}

describe("网格的诊断记进窗口的诊断", () => {
    it("放不下（over-constrained）是可以预期的降级：记 debug，消息以码开头，data 带码与参数", () => {
        const issues = twoColumns().layout({width: 120, height: 400}).issues;
        expect(issues.some((issue) => issue.code === "over-constrained")).toBe(true);
        const records = record(issues);
        const overConstrained = records.filter((entry) => (entry.data as {code: string}).code === "over-constrained");
        expect(overConstrained.length).toBeGreaterThan(0);
        for (const entry of overConstrained) {
            expect(entry).toMatchObject({level: "debug", event: "workbench.grid", origin: {plugin: PLUGIN}, data: {code: "over-constrained", rejected: false}});
            expect(entry.message.startsWith("over-constrained: ")).toBe(true);
        }
    });

    it("被拒的提交（结构操作真实返回的失败）记 warn，消息以 rejected 开头", () => {
        const failure = twoColumns().resizeBranches([{branchId: "missing", axis: "width", baseline: {}, target: {}}]);
        if (failure.ok) throw new Error("不存在的分支应当被拒");
        const [entry] = record([failure]);
        expect(entry).toMatchObject({level: "warn", event: "workbench.grid", data: {code: failure.code, rejected: true}});
        expect(entry!.message).toBe(`rejected ${failure.code}: ${failure.message}`);
    });

    it("落账之后通知抛出（notify-failed）记 error；接线或时序的码与不认识的码记 warn", () => {
        const records = record([
            {code: "notify-failed", message: "onApplied threw"},
            {code: "not-published", message: "the layout was not published"},
            // 以后的版本新加的码：今天的类型里没有它，只能强转。
            {code: "some-future-code", message: "unknown"} as unknown as WorkbenchGridIssue,
        ]);
        expect(records.map((entry) => [(entry.data as {code: string}).code, entry.level])).toEqual([["notify-failed", "error"], ["not-published", "warn"], ["some-future-code", "warn"]]);
    });
});
