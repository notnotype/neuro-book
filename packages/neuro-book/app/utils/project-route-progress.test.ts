import {describe, expect, it} from "vitest";
import {
    PROJECT_ROUTE_PROGRESS_PHASES,
    projectRouteProgressStep,
    projectRouteProgressView,
    reduceProjectRouteProgress,
    type ProjectRouteProgressPhase,
    type ProjectRouteProgress,
} from "nbook/app/utils/project-route-progress";
import type {ProjectSessionState} from "nbook/app/composables/useProjectSession";

const readyState: ProjectSessionState = {
    status: "ready",
    ready: {projectRoot: "project-a", publicId: "test-ready:1", revision: 1},
};

const reconnectingState = (phase: "waiting-reconnect" | "opening-project" | "connecting-presence"): ProjectSessionState => ({
    status: "reconnecting",
    phase,
    projectRoot: "project-a",
    ready: null,
});

function projectProgress(revision: number, phase: ProjectRouteProgressPhase): ProjectRouteProgress {
    return {kind: "project", revision, phase};
}

describe("Project route progress model", () => {
    it("按六个阶段映射 1 到 6 步", () => {
        expect(PROJECT_ROUTE_PROGRESS_PHASES.map(projectRouteProgressStep)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(PROJECT_ROUTE_PROGRESS_PHASES.map((phase) => projectRouteProgressView({
            sessionState: readyState,
            progress: projectProgress(1, phase),
            currentRevision: 1,
        }))).toEqual([
            {mode: "determinate", titleKey: "openingTitle", labelKey: "preparing", current: 1, total: 6},
            {mode: "determinate", titleKey: "openingTitle", labelKey: "openingProject", current: 2, total: 6},
            {mode: "determinate", titleKey: "openingTitle", labelKey: "connectingPresence", current: 3, total: 6},
            {mode: "determinate", titleKey: "openingTitle", labelKey: "syncingProject", current: 4, total: 6},
            {mode: "determinate", titleKey: "openingTitle", labelKey: "loadingTree", current: 5, total: 6},
            {mode: "determinate", titleKey: "openingTitle", labelKey: "restoringContent", current: 6, total: 6},
        ]);
    });

    it("ready 间隙保持连接阶段，不回到准备阶段", () => {
        let state = reduceProjectRouteProgress(null, {type: "start", revision: 1, kind: "project"});
        state = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "opening-project"});
        state = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "connecting-presence"});

        expect(projectRouteProgressView({sessionState: readyState, progress: state, currentRevision: 1})).toMatchObject({
            mode: "determinate",
            current: 3,
            labelKey: "connectingPresence",
        });

        state = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "syncing-project"});
        expect(state).toEqual({kind: "project", revision: 1, phase: "syncing-project"});
    });

    it("恢复标记结束后仍保持第六步", () => {
        let state: ProjectRouteProgress | null = projectProgress(1, "loading-tree");
        state = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "restoring-content"});
        expect(projectRouteProgressView({sessionState: readyState, progress: state, currentRevision: 1})).toMatchObject({
            mode: "determinate",
            current: 6,
            labelKey: "restoringContent",
        });
        expect(reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "loading-tree"})).toEqual(state);
    });

    it("旧 revision 的推进和清理不能触碰新 revision", () => {
        let state = reduceProjectRouteProgress(null, {type: "start", revision: 1, kind: "project"});
        state = reduceProjectRouteProgress(state, {type: "start", revision: 2, kind: "project"});
        expect(reduceProjectRouteProgress(state, {type: "start", revision: 1, kind: "other"})).toEqual(state);
        expect(reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "restoring-content"})).toEqual(state);
        expect(reduceProjectRouteProgress(state, {type: "clear", revision: 1})).toEqual(state);
        expect(reduceProjectRouteProgress(state, {type: "clear-through", revision: 1})).toEqual(state);
    });

    it("当前 revision 可精确清理，worker 可清理已经处理的旧进度", () => {
        const first = projectProgress(1, "syncing-project");
        expect(reduceProjectRouteProgress(first, {type: "clear", revision: 1})).toBeNull();
        expect(reduceProjectRouteProgress(first, {type: "clear-through", revision: 2})).toBeNull();
    });

    it("重复推进幂等，旧阶段不能覆盖已到达阶段", () => {
        let state: ProjectRouteProgress | null = projectProgress(1, "opening-project");
        state = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "connecting-presence"});
        const repeated = reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "connecting-presence"});
        expect(repeated).toBe(state);
        expect(reduceProjectRouteProgress(state, {type: "advance", revision: 1, phase: "opening-project"})).toBe(state);
    });

    it("重连三个阶段始终使用不定进度", () => {
        for (const phase of ["waiting-reconnect", "opening-project", "connecting-presence"] as const) {
            expect(projectRouteProgressView({
                sessionState: reconnectingState(phase),
                progress: projectProgress(1, "loading-tree"),
                currentRevision: 1,
            })).toEqual({mode: "indeterminate", titleKey: "openingTitle", labelKey: phase === "waiting-reconnect" ? "reconnectWaiting" : phase === "opening-project" ? "reconnectOpening" : "reconnectConnecting"});
        }
    });
});
