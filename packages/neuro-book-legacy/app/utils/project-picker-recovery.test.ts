import {describe, expect, it} from "vitest";
import {
    beginProjectPickerRecovery,
    emptyProjectPickerRecovery,
    failProjectPickerRecovery,
    settleProjectPickerRecoverySnapshot,
} from "nbook/app/utils/project-picker-recovery";

describe("Project Picker mutation recovery", () => {
    it("一次 snapshot 结算 create 和多 Project delete", () => {
        let state = beginProjectPickerRecovery(
            emptyProjectPickerRecovery(),
            {kind: "create"},
            {attempt: 1, commitState: "unknown"},
        );
        state = beginProjectPickerRecovery(
            state,
            {kind: "delete", projectRoot: "deleted"},
            {attempt: 2, commitState: true},
        );
        state = beginProjectPickerRecovery(
            state,
            {kind: "delete", projectRoot: "present"},
            {attempt: 3, commitState: "unknown"},
        );

        const settlement = settleProjectPickerRecoverySnapshot({
            state,
            capturedState: state,
            projects: [project("present")],
        });

        expect(settlement.state).toEqual(emptyProjectPickerRecovery());
        expect(settlement.create).toBe("unknown");
        expect(settlement.deletes).toEqual([
            {projectRoot: "deleted", outcome: "missing"},
            {projectRoot: "present", outcome: "present"},
        ]);
    });

    it("旧 snapshot 和旧失败不能覆盖同目标的新 attempt", () => {
        const captured = beginProjectPickerRecovery(
            emptyProjectPickerRecovery(),
            {kind: "delete", projectRoot: "book"},
            {attempt: 1, commitState: "unknown"},
        );
        let current = beginProjectPickerRecovery(
            captured,
            {kind: "delete", projectRoot: "book"},
            {attempt: 2, commitState: true},
        );
        current = failProjectPickerRecovery(
            current,
            {kind: "delete", projectRoot: "book"},
            1,
            "late error",
        );

        const settlement = settleProjectPickerRecoverySnapshot({
            state: current,
            capturedState: captured,
            projects: [],
        });

        expect(settlement.state).toEqual(current);
        expect(settlement.deletes).toEqual([]);
    });

    it("只给匹配 attempt 写刷新错误", () => {
        const state = beginProjectPickerRecovery(
            emptyProjectPickerRecovery(),
            {kind: "create"},
            {attempt: 4, commitState: true},
        );

        expect(failProjectPickerRecovery(state, {kind: "create"}, 3, "old")).toBe(state);
        expect(failProjectPickerRecovery(state, {kind: "create"}, 4, "offline").create)
            .toMatchObject({attempt: 4, error: "offline"});
    });
});

/** 创建恢复结算所需的最小 Project metadata。 */
function project(projectRoot: string) {
    return {projectRoot, kind: "novel" as const, title: projectRoot, summary: ""};
}
