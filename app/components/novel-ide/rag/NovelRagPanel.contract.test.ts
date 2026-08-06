import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";

const ragPanelPath = fileURLToPath(new URL("./NovelRagPanel.vue", import.meta.url));
const ragInspectorPath = fileURLToPath(new URL("./NovelRagInspectorDialog.vue", import.meta.url));
const ragInspectorSidebarPath = fileURLToPath(new URL("./NovelRagInspectorSidebar.vue", import.meta.url));
const ragInspectorMainPath = fileURLToPath(new URL("./NovelRagInspectorMain.vue", import.meta.url));
const ragInspectorDetailPath = fileURLToPath(new URL("./NovelRagInspectorDetail.vue", import.meta.url));
const activityBarPath = fileURLToPath(new URL("../NovelIdeActivityBar.vue", import.meta.url));
const toolPanelPath = fileURLToPath(new URL("../NovelIdeToolPanel.vue", import.meta.url));
const indexPagePath = fileURLToPath(new URL("../../../pages/index.vue", import.meta.url));

describe("NovelRagPanel contract", () => {
    it("写作模式主路径隐藏 RAG tab，但保留底层组件文件", async () => {
        expect(NOVEL_IDE_TABS).not.toContain("rag");
        expect(isNovelIdeTab("rag")).toBe(false);

        const activityBar = await readFile(activityBarPath, "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");
        expect(activityBar).not.toContain("\"rag\"");
        expect(activityBar).not.toContain("label: \"RAG\"");
        expect(activityBar).toContain("createWorkbenchActivityItems");
        expect(toolPanel).not.toContain("NovelRagPanel");
        expect(toolPanel).not.toContain("activeTab === 'rag' && !props.userAssetsMode");
    });

    it("保留基础空状态和真实 RAG API 入口", async () => {
        const panel = await readFile(ragPanelPath, "utf-8");
        expect(panel).toContain("当前没有 Project Workspace。");
        expect(panel).toContain("当前 Project 暂无 subject RAG 数据。");
        expect(panel).toContain("/api/projects/rag/overview");
        expect(panel).toContain("/api/projects/rag/subject");
        expect(panel).toContain("/api/projects/rag/search");
        expect(panel).toContain("/api/projects/rag/rebuild");
        expect(panel).toContain("/api/projects/rag/events");
        expect(panel).toContain("/api/projects/rag/memories");
        expect(panel).not.toContain("打开源文件");
        expect(panel).not.toContain("Embedding 设置");
    });

    it("加载失败时清空旧数据，并在重建跳过时展示失败原因", async () => {
        const panel = await readFile(ragPanelPath, "utf-8");
        expect(panel).toContain("overview.value = null;");
        expect(panel).toContain("selectedSubjectPath.value = \"\";");
        expect(panel).toContain("subjectDetail.value = null;");
        expect(panel).toContain("searchResult.value = null;");
        expect(panel).toContain("formatRebuildWarning(result)");
        expect(panel).toContain("const failures = result.results.filter((item) => !item.ok);");
        expect(panel).toContain("失败原因：");
    });

    it("隐藏 Activity Bar RAG Inspector 入口，但保留独立 dialog 实现", async () => {
        const activityBar = await readFile(activityBarPath, "utf-8");
        const indexPage = await readFile(indexPagePath, "utf-8");
        const inspector = await readFile(ragInspectorPath, "utf-8");
        const inspectorSidebar = await readFile(ragInspectorSidebarPath, "utf-8");
        const inspectorMain = await readFile(ragInspectorMainPath, "utf-8");
        const inspectorDetail = await readFile(ragInspectorDetailPath, "utf-8");

        expect(activityBar).not.toContain("open-rag-inspector");
        expect(activityBar).not.toContain("title=\"RAG Inspector\"");
        expect(indexPage).not.toContain("NovelRagInspectorDialog");
        expect(indexPage).not.toContain("ragInspectorOpen");
        expect(inspector).toContain("/api/projects/rag/inspector");
        expect(inspector).toContain("/api/projects/rag/debug");
        expect(inspector).toContain("size=\"full\"");
        expect(inspector).toContain("overlay-type=\"blur\"");
        expect(inspector).toContain("NovelRagInspectorSidebar");
        expect(inspector).toContain("NovelRagInspectorMain");
        expect(inspector).toContain("NovelRagInspectorDetail");
        expect(inspectorSidebar).toContain("Subject 列表");
        expect(inspectorMain).toContain("索引条目");
        expect(inspectorMain).toContain("召回测试");
        expect(inspectorDetail).toContain("向量预览");
        expect(inspectorDetail).toContain("chunkSourceCounts");
        expect(inspectorDetail).toContain("清空缓存");
        expect(inspectorDetail).toContain("标记待索引");
    });
});
