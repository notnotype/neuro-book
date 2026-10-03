import {describe, expect, it} from "vitest";
import {
    reduceProjectCoverRecovery,
    settleProjectCoverRecoverySnapshot,
    type ProjectCoverRecoveryState,
} from "nbook/app/utils/project-cover-recovery";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

describe("Project cover recovery state", () => {
    it("按 Project 和 attempt 隔离刷新错误", () => {
        let state: ProjectCoverRecoveryState = new Map();
        state = reduceProjectCoverRecovery(state, {
            type: "begin",
            projectRoot: "book-a",
            attempt: 1,
            commitState: "unknown",
        });
        state = reduceProjectCoverRecovery(state, {
            type: "failure",
            projectRoot: "book-a",
            attempt: 1,
            error: "network down",
        });
        state = reduceProjectCoverRecovery(state, {
            type: "begin",
            projectRoot: "book-a",
            attempt: 2,
            commitState: true,
        });
        state = reduceProjectCoverRecovery(state, {
            type: "failure",
            projectRoot: "book-a",
            attempt: 1,
            error: "late failure",
        });

        expect(state.get("book-a")).toEqual({attempt: 2, commitState: true, error: ""});
    });

    it("完整 snapshot 结算请求开始时捕获的多 Project 记录", () => {
        let captured: ProjectCoverRecoveryState = new Map();
        captured = reduceProjectCoverRecovery(captured, {
            type: "begin",
            projectRoot: "book-a",
            attempt: 1,
            commitState: true,
        });
        captured = reduceProjectCoverRecovery(captured, {
            type: "begin",
            projectRoot: "book-b",
            attempt: 2,
            commitState: "unknown",
        });

        const settlement = settleProjectCoverRecoverySnapshot({
            state: captured,
            capturedState: captured,
            projects: [project("book-a"), project("book-b")],
            requestedProjectRoot: "book-b",
            activeProjectRoot: "book-b",
        });

        expect(settlement.state.size).toBe(0);
        expect(settlement.cacheBustRoots).toEqual(["book-a", "book-b"]);
        expect(settlement.focused).toEqual({kind: "unknown", project: project("book-b")});
    });

    it("旧 snapshot 不能清除同一 Project 的新 attempt", () => {
        const captured = reduceProjectCoverRecovery(new Map(), {
            type: "begin",
            projectRoot: "book-a",
            attempt: 1,
            commitState: "unknown",
        });
        const current = reduceProjectCoverRecovery(captured, {
            type: "begin",
            projectRoot: "book-a",
            attempt: 2,
            commitState: true,
        });

        const settlement = settleProjectCoverRecoverySnapshot({
            state: current,
            capturedState: captured,
            projects: [project("book-a")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        });

        expect(settlement.state).toEqual(current);
        expect(settlement.cacheBustRoots).toEqual([]);
        expect(settlement.focused).toEqual({kind: "none"});
    });

    it("区分 committed、Project missing 与 Dialog 已切换", () => {
        const captured = reduceProjectCoverRecovery(new Map(), {
            type: "begin",
            projectRoot: "book-a",
            attempt: 3,
            commitState: true,
        });

        expect(settleProjectCoverRecoverySnapshot({
            state: captured,
            capturedState: captured,
            projects: [project("book-a")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        }).focused).toEqual({kind: "committed", project: project("book-a")});

        expect(settleProjectCoverRecoverySnapshot({
            state: captured,
            capturedState: captured,
            projects: [],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        }).focused).toEqual({kind: "missing", projectRoot: "book-a"});

        expect(settleProjectCoverRecoverySnapshot({
            state: captured,
            capturedState: captured,
            projects: [project("book-a"), project("book-b")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-b",
        }).focused).toEqual({kind: "none"});
    });
});

/** 建立只包含恢复状态机所需字段的 Project snapshot 项。 */
function project(projectRoot: string): ProjectMetadataDto {
    return {projectRoot, kind: "novel", title: projectRoot, summary: ""};
}
