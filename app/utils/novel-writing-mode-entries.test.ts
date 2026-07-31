import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";
import enUS from "nbook/app/i18n/locales/en-US";
import zhCN from "nbook/app/i18n/locales/zh-CN";

const headerPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeHeader.vue", import.meta.url));
const sidebarPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeSidebar.vue", import.meta.url));
const toolPanelPath = fileURLToPath(new URL("../components/novel-ide/NovelIdeToolPanel.vue", import.meta.url));
const welcomePath = fileURLToPath(new URL("../components/markdown-studio/MarkdownStudioWelcome.vue", import.meta.url));
const agentSurfacePath = fileURLToPath(new URL("../components/novel-ide/agent/AgentChatSurface.vue", import.meta.url));
const rpSurfacePath = fileURLToPath(new URL("../components/novel-ide/rp/RpModeSurface.vue", import.meta.url));
const plotPanelPath = fileURLToPath(new URL("../components/novel-ide/plot/NovelPlotPanel.vue", import.meta.url));
const plotSceneCardPath = fileURLToPath(new URL("../components/novel-ide/plot/workbench/PlotWorkbenchSortableSceneCard.vue", import.meta.url));
const plotInspectorPath = fileURLToPath(new URL("../components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue", import.meta.url));
const worldContextPanelPath = fileURLToPath(new URL("../components/novel-ide/plot/workbench/WorldEngineContextPanel.vue", import.meta.url));

describe("Novel writing mode entries", () => {
    it("写作模式主路径保留文件、角色与 Plot 侧栏入口", async () => {
        expect(NOVEL_IDE_TABS).toEqual(["files", "characters", "plot"]);
        expect(isNovelIdeTab("outline")).toBe(false);
        expect(isNovelIdeTab("rag")).toBe(false);
        expect(isNovelIdeTab("plot")).toBe(true);

        const sidebar = await readFile(sidebarPath, "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");

        expect(sidebar).not.toContain("value: \"outline\"");
        expect(sidebar).not.toContain("value: \"rag\"");
        expect(sidebar).toContain("value: \"plot\"");
        expect(sidebar).toContain("sessionItems");
        expect(toolPanel).toContain("NovelPlotPanel");
        expect(toolPanel).toContain("activeTab === 'plot' && !props.userAssetsMode");
        expect(toolPanel).not.toContain("NovelRagPanel");
    });

    it("顶栏和 Plot 面板提供 Plot Workbench 入口，但欢迎页和 RAG / simulation 快捷入口仍隐藏", async () => {
        const header = await readFile(headerPath, "utf-8");
        const plotPanel = await readFile(plotPanelPath, "utf-8");
        const welcome = await readFile(welcomePath, "utf-8");

        expect(header).toContain("open-plot-workbench");
        expect(header).toContain("plot-workbench-entry");
        expect(header).not.toContain("data-testid=\"plot-workbench-entry\" class=\"hidden");
        expect(plotPanel).toContain("plot-panel-workbench-entry");
        expect(plotPanel).toContain("plotWorkbenchOpen = true");
        expect(header).not.toContain("open-rag-inspector");
        expect(header).toContain("ide.header.plotWorkbench");
        expect(header).not.toContain("ide.header.ragInspector");
        expect(welcome).not.toContain("open-plot-workbench");
        expect(welcome).not.toContain("open-rag-inspector");
        expect(welcome).not.toContain("id: \"simulation\"");
        expect(welcome).not.toContain("open-path\", \"simulation/");
    });

    it("Plot World Context 可以转到真实 World Engine Workbench", async () => {
        const indexPage = await readFile(fileURLToPath(new URL("../pages/index.vue", import.meta.url)), "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");
        const plotPanel = await readFile(plotPanelPath, "utf-8");
        const plotInspector = await readFile(plotInspectorPath, "utf-8");
        const worldContextPanel = await readFile(worldContextPanelPath, "utf-8");

        expect(worldContextPanel).toContain("plot-world-context-open-workbench");
        expect(worldContextPanel).toContain("openWorldEngine");
        expect(plotInspector).toContain("@open-world-engine=\"emit('openWorldEngine')\"");
        expect(plotPanel).toContain("openWorldEngineFromPlot");
        expect(toolPanel).toContain("@open-world-engine=\"emit('openWorldEngine')\"");
        expect(indexPage).toContain("@open-world-engine=\"openWorldEngineWorkbench\"");
    });

    it("Plot Scene Card 和 Context Panel 展示 subject 解析状态", async () => {
        const sceneCard = await readFile(plotSceneCardPath, "utf-8");
        const plotInspector = await readFile(plotInspectorPath, "utf-8");
        const worldContextPanel = await readFile(worldContextPanelPath, "utf-8");

        expect(sceneCard).toContain("locationSubject?.name");
        expect(sceneCard).toContain("unresolvedSubjectIds.length");
        expect(plotInspector).toContain("World Engine subject 尚未接入");
        expect(worldContextPanel).toContain("未接入 subject 不参与本次查询");
    });

    it("Agent 新建菜单隐藏 RP 与 simulator profile，但保留历史显示映射", async () => {
        const agentSurface = await readFile(agentSurfacePath, "utf-8");

        expect(agentSurface).toContain("hiddenWritingModeProfileKeys");
        expect(agentSurface).not.toContain("{profileKey: \"rp.leader\"");
        expect(agentSurface).not.toContain("{profileKey: \"simulator.leader\"");
        expect(agentSurface).toContain("case \"rp.leader\": return t(\"agent.profiles.rpLeader\")");
        expect(agentSurface).toContain("case \"simulator.leader\": return t(\"agent.profiles.simulatorLeader\")");
    });

    it("RP 对话面在 active 初始挂载时恢复已有 session", async () => {
        const indexPage = await readFile(fileURLToPath(new URL("../pages/index.vue", import.meta.url)), "utf-8");
        const rpSurface = await readFile(rpSurfacePath, "utf-8");
        const agentSurface = await readFile(agentSurfacePath, "utf-8");

        expect(indexPage).toContain("v-if=\"rpModeOpen && !isUserAssetsWorkspace\"");
        expect(rpSurface).toContain("profile-key-override=\"rp.leader\"");
        expect(agentSurface).toMatch(/onMounted\(\(\) => \{[\s\S]*if \(props\.active\) \{\s*await ensureSessionReady\(\);\s*\}[\s\S]*?\}\);/u);
    });

    it("Project 下载确认提示完整 History 隐私风险，user-assets 不显示该提示", async () => {
        const toolPanel = await readFile(toolPanelPath, "utf-8");

        expect(toolPanel).toContain("v-if=\"!props.userAssetsMode\"");
        expect(toolPanel).toContain("ide.toolPanel.downloadProjectHistoryWarning");
        expect(zhCN.ide.toolPanel.downloadProjectHistoryWarning).toContain("完整文件历史");
        expect(zhCN.ide.toolPanel.downloadProjectHistoryWarning).toContain("已删除正文和敏感历史");
        expect(enUS.ide.toolPanel.downloadProjectHistoryWarning).toContain("complete file history");
        expect(enUS.ide.toolPanel.downloadProjectHistoryWarning).toContain("deleted manuscript text and sensitive history");
    });
});
