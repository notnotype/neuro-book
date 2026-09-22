import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const dialogPath = fileURLToPath(new URL("../components/novel-ide/jobs/AgentJobsDialog.vue", import.meta.url));
const activityBarPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeActivityBar.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../pages/index.vue", import.meta.url));
const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
const observerPath = fileURLToPath(new URL("./useAgentJob.ts", import.meta.url));
const workflowBubblePath = fileURLToPath(new URL("../components/novel-ide/agent/bubbles/tools/AgentWorkflowBubble.vue", import.meta.url));

describe("Jobs feed 页面接线合同", () => {
    it("Desktop Activity Bar 暂不挂载 Jobs，任务中心组件仍保留独立 feed 接口", async () => {
        const [dialog, activityBar, indexPage] = await Promise.all([
            readFile(dialogPath, "utf8"),
            readFile(activityBarPath, "utf8"),
            readFile(indexPagePath, "utf8"),
        ]);

        expect(indexPage).not.toContain("const chromeJobsFeed = useAgentJobsFeed(projectSurfaceActive);");
        expect(activityBar).not.toContain("agentJobsActiveCount");
        expect(indexPage).not.toContain("<AgentJobsDialog");
        expect(dialog).toContain("const feed = useAgentJobsFeed();");
    });

    it("工作面失活会关闭任务中心", async () => {
        const indexPage = await readFile(indexPagePath, "utf8");

        expect(indexPage).toContain("watch(projectSurfaceActive, (active) => {");
        expect(indexPage).toContain("if (!active) agentPanelOpen.value = false;");
    });

    it("开发命令固定经过Source Dev launcher，并由内部入口最终启动 Nuxt", async () => {
        const [packageJson, runtimeSource] = await Promise.all([
            readFile(packagePath, "utf8"),
            readFile(fileURLToPath(new URL("../../scripts/cli/source-runtime.ts", import.meta.url)), "utf8"),
        ]);
        const parsed = JSON.parse(packageJson) as {scripts: {dev: string; "dev:runtime": string}};
        expect(parsed.scripts.dev).toBe("bun scripts/cli/source-dev.ts");
        expect(parsed.scripts["dev:runtime"]).toBe("bun scripts/cli/source-runtime.ts");
        expect(runtimeSource).toContain('["--no-install", "x", "nuxt", "dev", "--no-fork"]');
        expect(runtimeSource.lastIndexOf('"nuxt", "dev", "--no-fork"')).toBeGreaterThan(
            runtimeSource.indexOf("await seedSystemAssets"),
        );
    });

    it("单 Job 观察器不暴露全局刷新，正式 Workflow 动作只重启 Run 轮询", async () => {
        const [observer, workflowBubble] = await Promise.all([
            readFile(observerPath, "utf8"),
            readFile(workflowBubblePath, "utf8"),
        ]);

        expect(observer).toContain("feed: AgentJobsFeedView");
        expect(observer).not.toContain("refresh(): void");
        expect(observer).not.toContain("refresh: feed.refresh");
        expect(workflowBubble).not.toContain("refreshJob");
    });

});
