/**
 * Lab 组件索引（ui.component-lab 场景 3、4、11）：从组件文档派生条目、可挂载性与检索。真实文档的扫描在
 * `component-index.ts`，这里用合成的逻辑路径与文档。
 */

import {describe, expect, it} from "bun:test";

import {buildLabIndex, matchesLabQuery} from "./component-index-model";
import type {LabComponentEntry} from "./component-index-model";

const doc = (frontmatter: string, body = "") => `---\n${frontmatter}\n---\n${body}`;

/** 每篇文档旁都有同名 `.vue`，`withoutComponent` 里的除外。 */
function index(docs: Record<string, string>, withoutComponent: string[] = []) {
    const warnings: string[] = [];
    const modules = new Set(Object.keys(docs).filter((path) => !withoutComponent.includes(path)).map((path) => path.replace(/\.md$/u, ".vue")));
    const entries = buildLabIndex({docs, modules}, (message) => warnings.push(message));
    const byName = (name: string): LabComponentEntry => entries.find((entry) => entry.name === name) as LabComponentEntry;
    return {entries, warnings, byName};
}

describe("Lab 组件索引", () => {
    it("只收有同名 .vue 的文档；显示名取第一条 H1，分组取目录（跳过 components 桶）", () => {
        const {entries, byName} = buildIndexWithReadme();
        expect(entries.map((entry) => entry.name)).toEqual(["ViewportCanvas", "JsonViewer", "MemberChip"]);
        expect(byName("JsonViewer")).toMatchObject({displayName: "JSON 查看器", group: "ui", groupPath: ["ui"]});
        expect(byName("MemberChip")).toMatchObject({displayName: "MemberChip", group: "chips", groupPath: ["ui", "chips", "components"]});
    });

    it("读写产品数据、直接访问浏览器存储的组件不可挂载并给出原因；共享只读状态要快照", () => {
        const {byName} = index({
            "ui/Saver.md": doc("标签: [io:project-files]"),
            "ui/Persisted.md": doc("标签: [persist:local]"),
            "ui/Reader.md": doc("标签: [state:shared-read]"),
            "ui/Plain.md": doc("标签: []"),
        });
        expect(byName("Saver")).toMatchObject({mountable: false, needsSnapshot: false});
        expect(byName("Saver").blockedReason).toContain("io:project-files");
        expect(byName("Persisted").blockedReason).toContain("persist:local");
        expect(byName("Reader")).toMatchObject({mountable: true, needsSnapshot: true});
        expect(byName("Plain")).toMatchObject({mountable: true, needsSnapshot: false, blockedReason: ""});
    });

    it("声明了验证入口的零件不可独立挂载，被指向的宿主标为集成入口；入口指向不存在的组件时提示并不给跳转", () => {
        const {byName, warnings} = index({
            "workbench/WorkbenchTab.md": doc("标签: [state:inject]\n验证入口: WorkbenchShellLayout"),
            "workbench/WorkbenchShellLayout.md": doc("标签: []"),
            "workbench/WorkbenchBadge.md": doc("标签: []\n验证入口: NoSuchHost"),
        });
        expect(byName("WorkbenchTab")).toMatchObject({mountable: false, verifyEntry: "WorkbenchShellLayout"});
        expect(byName("WorkbenchTab").blockedReason).toContain("WorkbenchShellLayout");
        expect(byName("WorkbenchShellLayout")).toMatchObject({mountable: true, integrationEntry: true});
        expect(byName("WorkbenchBadge")).toMatchObject({mountable: false, verifyEntry: null, integrationEntry: false});
        expect(warnings).toEqual(["WorkbenchBadge 的「验证入口」指向不存在的组件：NoSuchHost"]);
    });

    it("按组件名、显示名与别名检索，不分大小写，全角空格当空格；别名写坏（不是 JSON 或混有非字符串）时提示并当作没有别名", () => {
        const {byName, warnings} = index({
            "lab/ViewportCanvas.md": doc('标签: []\n别名: ["画布", "Viewport"]', "# 画布容器\n"),
            "lab/EventLogPanel.md": doc("标签: []\n别名: [事件日志]"),
            "lab/HighlightBox.md": doc('标签: []\n别名: ["高亮框", 1]'),
        });
        const canvas = byName("ViewportCanvas");
        for (const query of ["viewportcanvas", "画布容器", "VIEWPORT", "　画布　", ""]) expect(matchesLabQuery(canvas, query)).toBe(true);
        expect(matchesLabQuery(canvas, "日志")).toBe(false);
        expect(byName("EventLogPanel").aliases).toEqual([]);
        expect(byName("HighlightBox").aliases).toEqual([]);
        expect(warnings).toHaveLength(2);
        expect(warnings.map((warning) => warning.split(" ")[0])).toEqual(["EventLogPanel", "HighlightBox"]);
    });
});

function buildIndexWithReadme() {
    return index({
        "ui/JsonViewer.md": doc("标签: [state:local]", "# JSON 查看器\n\n正文"),
        "ui/chips/components/MemberChip.md": doc("标签: []"),
        "ui/README.md": "# 说明",
        "lab/ViewportCanvas.md": doc("标签: []"),
    }, ["ui/README.md"]);
}
