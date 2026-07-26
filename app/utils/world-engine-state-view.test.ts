import {describe, expect, it} from "vitest";
import type {WorldPreviewSchemaAttr} from "nbook/app/utils/world-engine-preview";
import {
    parseStateViewConfig,
    resolveAttrView,
    resolveCardLayout,
    resolveTypeIcon,
    resolveTypeLabel,
    stagedEditKey,
    formatStateValue,
} from "nbook/app/utils/world-engine-state-view";

const attrs: WorldPreviewSchemaAttr[] = [
    {name: "hp", kind: "scalar", type: "number"},
    {name: "名字", kind: "scalar", type: "string"},
    {name: "位置", kind: "scalar", type: "string", desc: "ref:location"},
    {name: "装备", kind: "list", itemType: "string"},
    {name: "物品", kind: "collection", itemType: "object"},
    {name: "心情", kind: "scalar", type: "string", enum: ["开心", "沮丧"]},
    {name: "档案", kind: "object", fields: {}},
];

describe("world-engine-state-view", () => {
    it("解析合法配置并保留有效字段", () => {
        const {config, issues} = parseStateViewConfig(JSON.stringify({
            types: {
                character: {
                    label: "角色",
                    titleAttr: "名字",
                    pinned: ["hp", "位置"],
                    sections: [{title: "战斗", attrs: ["hp"]}],
                    display: {hp: {widget: "progress", max: 100, color: "danger"}},
                },
            },
        }));
        expect(issues).toEqual([]);
        expect(config.types.character?.pinned).toEqual(["hp", "位置"]);
        expect(config.types.character?.display?.hp).toEqual({widget: "progress", max: 100, color: "danger"});
    });

    it("非法 JSON / 非法字段回退且报告 issue,不抛异常", () => {
        expect(parseStateViewConfig("not json").config.types).toEqual({});
        expect(parseStateViewConfig("not json").issues.length).toBe(1);

        const {config, issues} = parseStateViewConfig(JSON.stringify({
            types: {
                character: {
                    pinned: "hp",
                    display: {hp: {widget: "3d-hologram", max: -5, color: "rainbow"}},
                    sections: [{title: "缺 attrs"}],
                },
                broken: 42,
            },
        }));
        expect(issues.length).toBeGreaterThanOrEqual(4);
        // 非法 widget 回退自动推断,非法 max/color 丢弃,类型仍存在
        expect(config.types.character?.display?.hp).toEqual({});
        expect(config.types.broken).toBeUndefined();
    });

    it("widget 自动推断:数值/ref/enum/数组/对象", () => {
        expect(resolveAttrView(attrs[0]!, undefined).widget).toBe("number");
        expect(resolveAttrView(attrs[0]!, {max: 100}).widget).toBe("progress");
        expect(resolveAttrView(attrs[2]!, undefined).widget).toBe("ref");
        expect(resolveAttrView(attrs[2]!, undefined).refType).toBe("location");
        expect(resolveAttrView(attrs[3]!, undefined).widget).toBe("chips");
        expect(resolveAttrView(attrs[4]!, undefined).widget).toBe("item-list");
        expect(resolveAttrView(attrs[5]!, undefined).widget).toBe("badge");
        expect(resolveAttrView(attrs[6]!, undefined).widget).toBe("json");
    });

    it("卡片布局:pinned + sections + 未覆盖属性自动归入其他", () => {
        const layout = resolveCardLayout(attrs, {
            pinned: ["hp", "不存在的属性"],
            sections: [{title: "战斗", attrs: ["装备"]}],
        });
        expect(layout.pinned.map((view) => view.attr.name)).toEqual(["hp"]);
        expect(layout.sections[0]?.title).toBe("战斗");
        // schema 中配置未覆盖的属性全部进入「其他」,不会丢失
        const restNames = layout.sections.at(-1)!.views.map((view) => view.attr.name);
        expect(restNames).toContain("名字");
        expect(restNames).toContain("物品");
        expect(restNames).toContain("档案");
    });

    it("无配置时全部属性按默认布局展示", () => {
        const layout = resolveCardLayout(attrs, undefined);
        expect(layout.pinned).toEqual([]);
        expect(layout.sections).toHaveLength(1);
        expect(layout.sections[0]?.views).toHaveLength(attrs.length);
    });

    it("hidden 属性不进布局", () => {
        const layout = resolveCardLayout(attrs, {display: {hp: {hidden: true}}});
        const names = layout.sections.flatMap((section) => section.views.map((view) => view.attr.name));
        expect(names).not.toContain("hp");
    });

    it("类型显示名/图标解析与暂存 key", () => {
        expect(resolveTypeLabel("character", {label: "角色"}, undefined)).toBe("角色");
        expect(resolveTypeLabel("character", undefined, "角色类型")).toBe("角色类型");
        expect(resolveTypeIcon("character", undefined)).toBe("user");
        expect(resolveTypeIcon("custom-type", {icon: "sword"})).toBe("sword");
        expect(stagedEditKey({subjectId: "erina", path: "/hp"})).toBe("erina\u0000/hp");
    });

    it("值格式化", () => {
        expect(formatStateValue(undefined)).toBe("—");
        expect(formatStateValue([1, 2, 3])).toBe("3 项");
        expect(formatStateValue({a: 1})).toBe("1 字段");
        expect(formatStateValue("金谷城")).toBe("金谷城");
    });
});
