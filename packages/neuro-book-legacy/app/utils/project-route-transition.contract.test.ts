import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const indexPagePath = fileURLToPath(new URL("../pages/index.vue", import.meta.url));

describe("Project route transition contract", () => {
    it("所有入口只提交 route intent，并由单一串行队列消费", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("const requestWorkspaceRouteSync = (): void =>");
        expect(page).toContain("while (processedProjectRouteRevision < projectRouteIntentRevision)");
        expect(page).toContain("watch(() => [route.query.project, route.query.openPath] as const, requestWorkspaceRouteSync)");
        expect(page).toContain("const openProjectPicker = async (): Promise<void> => {");
        expect(page).toContain('await router.push("/");');
    });


    it("页面把真实异步边界提交给单调进度模型", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("projectRouteProgressView({");
        expect(page).toContain("reduceProjectRouteProgress(projectRouteProgress.value");
        expect(page).toContain('setProjectRouteProgress(revision, "opening-project")');
        expect(page).toContain('setProjectRouteProgress(projectRouteIntentRevision, "connecting-presence")');
        expect(page).toContain('setProjectRouteProgress(revision, "syncing-project")');
        expect(page).toContain('setProjectRouteProgress(revision, "loading-tree")');
        expect(page).toContain('setProjectRouteProgress(projectRouteIntentRevision, "restoring-content")');
        expect(page).toContain('setProjectRouteProgress(revision, "restoring-content")');
        expect(page).toContain('{flush: "sync"}');
    });

    it("确定阶段公开步骤值，重连不伪造 aria-valuenow", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain('role="progressbar"');
        expect(page).toContain(':aria-valuemax="projectTransitionView.mode === \'determinate\' ? projectTransitionView.total : undefined"');
        expect(page).toContain(':aria-valuenow="projectTransitionView.mode === \'determinate\' ? projectTransitionView.current : undefined"');
        expect(page).toContain('class="project-loading-indeterminate');
        expect(page).toContain('role="status" aria-live="polite" aria-atomic="true"');
        expect(page).not.toContain('role="status" aria-live="polite" aria-busy="true"');
        expect(page).toContain("@media (prefers-reduced-motion: reduce)");
        expect(page).not.toContain("正在打开 Project...");
    });

    it("重连进入 terminal failed 后释放 Project surface 并回到 Picker", async () => {
        const page = await readFile(indexPagePath, "utf8");

        expect(page).toContain("const handleTerminalProjectSessionFailure = (): void =>");
        expect(page).toContain('if (projectSwitching.value || terminalProjectFailurePromise) return;');
        expect(page).toContain("stopWorkspaceEvents();");
        expect(page).toContain("await releaseProjectSurface();");
        expect(page).toContain('await router.replace("/");');
        expect(page).toContain('if (next.status === "failed") {');
        expect(page).toContain("handleTerminalProjectSessionFailure();");
    });
});
