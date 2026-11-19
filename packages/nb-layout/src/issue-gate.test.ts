import {describe, expect, it} from "bun:test";
import {gridIssue} from "./grid-issue";
import {createIssueGate} from "./issue-gate";

/** 同一个节点同一个原因，数不一样：键相同。 */
const minTotal = (id: string, available: number) => gridIssue("over-constrained", `min-total on ${id}`, {cause: "min-total", id, axis: "width", available, required: 600});
const leafMin = (id: string) => gridIssue("over-constrained", `leaf-min on ${id}`, {cause: "leaf-min", id, axis: "width", available: 10, required: 20});

describe("诊断的闸门（Spec ui/nested-grid 输出 140）", () => {
    it("take：同一批里同键只交第一条；交过的键之后不再交，数变了也算同一条", () => {
        const gate = createIssueGate();
        expect(gate.take([minTotal("root", 499), minTotal("root", 498), leafMin("a")]).map((issue) => issue.params?.available)).toEqual([499, 10]);
        expect(gate.take([minTotal("root", 400), leafMin("a")])).toEqual([]);
        expect(gate.take([leafMin("b")]).map((issue) => issue.params?.id)).toEqual(["b"]);
    });

    it("replace：只交上一批没有的；消失之后再出现会再交；replace([]) 就是清空", () => {
        const gate = createIssueGate();
        expect(gate.replace([minTotal("root", 499)])).toHaveLength(1);
        expect(gate.replace([minTotal("root", 480), leafMin("a")]).map((issue) => issue.params?.cause)).toEqual(["leaf-min"]);
        expect(gate.replace([leafMin("a")])).toEqual([]);
        expect(gate.replace([minTotal("root", 470), leafMin("a")]).map((issue) => issue.params?.cause)).toEqual(["min-total"]);
        expect(gate.replace([])).toEqual([]);
        expect(gate.replace([leafMin("a")])).toHaveLength(1);
    });

    it("键分得开：不同的节点、原因、轴、码各是一条", () => {
        const gate = createIssueGate();
        const batch = [
            minTotal("root", 1),
            minTotal("right", 1),
            gridIssue("over-constrained", "m", {cause: "min-total", id: "root", axis: "height", available: 1, required: 2}),
            gridIssue("over-constrained", "m", {cause: "fixed-overflow", id: "root", axis: "width", available: 1, required: 2}),
            gridIssue("unabsorbed-space", "m", {cause: "capped", id: "root", axis: "width", rest: 3}),
        ];
        expect(gate.take(batch)).toHaveLength(5);
    });
});
