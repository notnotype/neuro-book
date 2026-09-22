import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {isNovelIdeTab, NOVEL_IDE_TABS} from "nbook/app/components/novel-ide/mock-data";

const ragInspectorSidebarPath = fileURLToPath(new URL("./NovelRagInspectorSidebar.vue", import.meta.url));
const ragInspectorMainPath = fileURLToPath(new URL("./NovelRagInspectorMain.vue", import.meta.url));
const ragInspectorDetailPath = fileURLToPath(new URL("./NovelRagInspectorDetail.vue", import.meta.url));
const activityBarPath = fileURLToPath(new URL("../NovelIdeActivityBar.vue", import.meta.url));
const toolPanelPath = fileURLToPath(new URL("../NovelIdeToolPanel.vue", import.meta.url));

describe("RAG 入口合同", () => {
    it("写作模式主路径隐藏 RAG tab", async () => {
        expect(NOVEL_IDE_TABS).not.toContain("rag");
        expect(isNovelIdeTab("rag")).toBe(false);

        const activityBar = await readFile(activityBarPath, "utf-8");
        const toolPanel = await readFile(toolPanelPath, "utf-8");
        expect(activityBar).not.toContain("\"rag\"");
        expect(activityBar).not.toContain("label: \"RAG\"");
        expect(activityBar).toContain("createWorkbenchActivityItems");
        expect(toolPanel).not.toContain("activeTab === 'rag' && !props.userAssetsMode");
    });

    it("隐藏 Activity Bar RAG Inspector 入口，底层 inspector 组件仍在仓库中", async () => {
        const activityBar = await readFile(activityBarPath, "utf-8");
        const inspectorSidebar = await readFile(ragInspectorSidebarPath, "utf-8");
        const inspectorMain = await readFile(ragInspectorMainPath, "utf-8");
        const inspectorDetail = await readFile(ragInspectorDetailPath, "utf-8");

        expect(activityBar).not.toContain("open-rag-inspector");
        expect(activityBar).not.toContain("title=\"RAG Inspector\"");
        expect(inspectorSidebar).toContain("Subject 列表");
        expect(inspectorMain).toContain("索引条目");
        expect(inspectorMain).toContain("召回测试");
        expect(inspectorDetail).toContain("向量预览");
        expect(inspectorDetail).toContain("chunkSourceCounts");
        expect(inspectorDetail).toContain("清空缓存");
        expect(inspectorDetail).toContain("标记待索引");
    });
});
