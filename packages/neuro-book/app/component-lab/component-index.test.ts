import {describe, expect, it} from "vitest";
import {deriveDisplayMode, labComponentLabel, labComponents, matchesLabQuery, type LabComponentEntry} from "nbook/app/component-lab/component-index";

/**
 * Lab 目录的检索语义：按组件名、文档显示名与部件别名都能找到真实组件。
 * 不钉组件清单本身——清单是派生产物，钉它会变成每加一个组件就要改一次测试。
 */
function entry(overrides: Partial<LabComponentEntry>): LabComponentEntry {
    return {
        name: "WorkbenchExample",
        displayName: "WorkbenchExample",
        aliases: [],
        group: "workbench",
        groupPath: ["workbench"],
        tags: [],
        doc: "# WorkbenchExample\n",
        mountable: true,
        blockedReason: "",
        needsSnapshot: false,
        kind: "part",
        displayMode: "tight",
        verifyEntry: null,
        integrationEntry: false,
        ...overrides,
    };
}

describe("Lab 目录检索", () => {
    it("按组件名、显示名与中英文别名都能命中", () => {
        const target = entry({
            name: "WorkbenchActivityBar",
            displayName: "工作台通用活动栏",
            aliases: ["活动栏", "Activity Bar"],
        });
        expect(matchesLabQuery(target, "workbenchactivitybar")).toBe(true);
        expect(matchesLabQuery(target, "工作台通用")).toBe(true);
        expect(matchesLabQuery(target, "活动栏")).toBe(true);
        expect(matchesLabQuery(target, "activity bar")).toBe(true);
        expect(matchesLabQuery(target, "  Activity BAR  ")).toBe(true);
        expect(matchesLabQuery(target, "　活动栏")).toBe(true);
        expect(matchesLabQuery(target, "编辑器")).toBe(false);
    });

    it("空检索匹配全部；没有别名的组件只按名字与显示名匹配", () => {
        const plain = entry({name: "WorkbenchPanelSurface", displayName: "WorkbenchPanelSurface"});
        expect(matchesLabQuery(plain, "")).toBe(true);
        expect(matchesLabQuery(plain, "   ")).toBe(true);
        expect(matchesLabQuery(plain, "面板")).toBe(false);
    });

    it("导航文字：显示名与组件名相同不重复，不同时并列", () => {
        expect(labComponentLabel(entry({}))).toBe("WorkbenchExample");
        expect(labComponentLabel(entry({displayName: "工作台示例"}))).toBe("WorkbenchExample · 工作台示例");
    });

    it("真实索引：每个条目都有显示名，别名都是非空字符串，且显示名来自文档第一条 H1", () => {
        expect(labComponents.length).toBeGreaterThan(0);
        for (const item of labComponents) {
            expect(item.displayName.length).toBeGreaterThan(0);
            for (const alias of item.aliases) {
                expect(alias.trim()).toBe(alias);
                expect(alias.length).toBeGreaterThan(0);
            }
            const heading = /^#[ \t]+(.+?)[ \t]*$/mu.exec(item.doc)?.[1]?.trim();
            expect(item.displayName).toBe(heading !== undefined && heading !== "" ? heading : item.name);
        }
    });

    /**
     * 受控零件的文档声明 `验证入口`：props 来自宿主链，脱离它没有可验证状态。
     * 索引据此判为不可独立挂载并把入口名带给界面——Lab 不造假宿主，也不假装它们能单独打开。
     */
    it("声明验证入口的零件不可独立挂载，并带着宿主入口名", () => {
        const controlled = ["WorkbenchPartHost", "WorkbenchContainerInstances", "WorkbenchContainerTab", "WorkbenchViewSection", "WorkbenchViewHost"];
        for (const name of controlled) {
            const item = labComponents.find((candidate) => candidate.name === name);
            expect(item, `${name} 应在真实索引里`).toBeDefined();
            expect(item?.mountable, `${name} 不应可独立挂载`).toBe(false);
            expect(item?.verifyEntry).toBe("WorkbenchShellLayout");
            expect(item?.blockedReason).toContain("WorkbenchShellLayout");
        }
    });

    /**
     * 被指向的那个组件是整条宿主链的集成入口，导航据此给它单独的图形。
     * 它自己必须仍然可挂载——否则中栏那条「打开入口」跳过去也是一堵墙。
     */
    it("集成入口由指向关系派生，且自己必须可挂载", () => {
        const integration = labComponents.filter((entry) => entry.integrationEntry);
        expect(integration.length, "至少应有一个集成入口").toBeGreaterThan(0);
        expect(integration.map((entry) => entry.name)).toContain("WorkbenchShellLayout");
        for (const entry of integration) {
            expect(entry.mountable, `${entry.name} 被当作验证入口，但它自己不可挂载`).toBe(true);
            expect(entry.verifyEntry, `${entry.name} 是别人的入口，不该自己再指向别处`).toBeNull();
        }
    });

    it("推导视口形态：全屏大视图为 fill，局部小部件为 tight", () => {
        expect(deriveDisplayMode("WorkbenchShellLayout")).toBe("fill");
        expect(deriveDisplayMode("AgentSidebarView")).toBe("fill");
        expect(deriveDisplayMode("ProjectPickerView")).toBe("fill");
        expect(deriveDisplayMode("AgentComposerInput")).toBe("tight");
        expect(deriveDisplayMode("AgentWriteFileBubble")).toBe("tight");
        expect(deriveDisplayMode("AgentStatusNode", "part")).toBe("tight");
        expect(deriveDisplayMode("EditorSettingsView", "view")).toBe("fill");

        for (const item of labComponents) {
            expect(["tight", "fill"]).toContain(item.displayMode);
        }
    });
});
