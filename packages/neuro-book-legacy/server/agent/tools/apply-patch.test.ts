import {describe, expect, it} from "vitest";
import {extractPatchTargetPaths} from "nbook/server/agent/tools/apply-patch";

/**
 * extractPatchTargetPaths 是只读模式写豁免/审批的路径真相源（Task 90 修复）。
 * 重点验证 Move to 目标被计入、解析失败 fail-closed。
 */
describe("extractPatchTargetPaths", () => {
    it("Add File 返回新增路径", () => {
        const patch = ["*** Begin Patch", "*** Add File: notes/new.md", "+hello", "*** End Patch"].join("\n");
        expect(extractPatchTargetPaths(patch)).toEqual(["notes/new.md"]);
    });

    it("Delete File 返回删除路径", () => {
        const patch = ["*** Begin Patch", "*** Delete File: notes/old.md", "*** End Patch"].join("\n");
        expect(extractPatchTargetPaths(patch)).toEqual(["notes/old.md"]);
    });

    it("Update File 返回更新路径", () => {
        const patch = ["*** Begin Patch", "*** Update File: notes/keep.md", "@@", "-a", "+b", "*** End Patch"].join("\n");
        expect(extractPatchTargetPaths(patch)).toEqual(["notes/keep.md"]);
    });

    it("Update + Move to 同时返回源路径与移动目标", () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: .agent/plan/draft.md",
            "*** Move to: manuscript/chapter.md",
            "@@",
            "-a",
            "+b",
            "*** End Patch",
        ].join("\n");
        // Move to 目标不能被漏掉，否则只读模式写豁免会被移动操作绕过
        expect(extractPatchTargetPaths(patch)).toEqual([".agent/plan/draft.md", "manuscript/chapter.md"]);
    });

    it("多个操作返回全部目标", () => {
        const patch = [
            "*** Begin Patch",
            "*** Add File: a.md",
            "+x",
            "*** Delete File: b.md",
            "*** End Patch",
        ].join("\n");
        expect(extractPatchTargetPaths(patch)).toEqual(["a.md", "b.md"]);
    });

    it("解析失败返回空数组（fail-closed）", () => {
        expect(extractPatchTargetPaths("not a patch")).toEqual([]);
        expect(extractPatchTargetPaths("")).toEqual([]);
        expect(extractPatchTargetPaths("*** Begin Patch\n*** End Patch")).toEqual([]);
    });
});
