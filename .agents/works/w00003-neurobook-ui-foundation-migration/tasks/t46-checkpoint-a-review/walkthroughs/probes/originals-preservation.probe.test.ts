/**
 * 对抗性探针 A（原件合成 / 未知部分丢失）：
 * 未知顶层字段、节点级未知字段、未知嵌套分支子树、未知引用叶在保存后是否逐项保留；
 * 以及"过滤后的 serialize()"是否被当作保存内容。
 */
import {describe, expect, it} from "vitest";
import {StorageAdapterError} from "nbook/app/utils/storage/value-transport";
import {
    composeGridLayoutRecord,
    type GridLayoutRecord,
} from "nbook/app/utils/workbench/storage-grid-host";
import {credential, openProbeHost, scriptedTransport} from "./probe-harness";

/** 未知结构：顶层未知字段 + 分支节点未知字段 + 未知嵌套分支（内含未知引用叶）+ 已知叶的未知字段。 */
function richRecord(): GridLayoutRecord {
    return {
        version: 2,
        note: "top-unknown",
        meta: {nested: true, list: [1, 2, 3]},
        root: {
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            teamNote: "branch-unknown",
            children: [
                {kind: "leaf", id: "outline", ref: "outline", size: {width: 240, height: 0}, flavor: "alpha"},
                {
                    kind: "branch",
                    id: "dock",
                    orientation: "vertical",
                    size: {width: 300, height: 0},
                    extra: 7,
                    children: [
                        {kind: "leaf", id: "console", ref: "console", size: {width: 300, height: 500}},
                        {kind: "leaf", id: "plugin", ref: "plugin", size: {width: 300, height: 300}},
                    ],
                },
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 660, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

/** 外来窗口写入的记录：结构不同（多出未知叶 inbox）且带外来标记。 */
function foreignRecord(): GridLayoutRecord {
    const base = richRecord();
    const root = base.root as unknown as {children: Array<Record<string, unknown>>};
    return {
        ...base,
        note: "foreign-note",
        foreignMark: "written-by-other-window",
        root: {
            ...base.root,
            children: [
                ...root.children,
                {kind: "leaf", id: "inbox", ref: "inbox", size: {width: 120, height: 0}},
            ],
        },
    } as unknown as GridLayoutRecord;
}

describe("探针 A：原件合成不丢未知部分", () => {
    it("纯合成保留未知顶层/节点级字段、未知嵌套分支子树与顺序，且不改动原件", () => {
        const base = richRecord();
        const composed = composeGridLayoutRecord(base, [
            {id: "outline", axis: "width", value: 360},
            {id: "console", axis: "height", value: 520},
        ]);

        expect(composed.applied).toEqual([
            {id: "outline", axis: "width", value: 360},
            {id: "console", axis: "height", value: 520},
        ]);
        expect(composed.skipped).toEqual([]);
        expect(composed.value.note).toBe("top-unknown");
        expect(composed.value.meta).toEqual({nested: true, list: [1, 2, 3]});

        const kids = (composed.value.root as unknown as {children: Array<Record<string, unknown>>}).children;
        expect(kids.map((kid) => kid.id)).toEqual(["outline", "dock", "editor"]);
        expect(kids[0]).toEqual({kind: "leaf", id: "outline", ref: "outline", size: {width: 360, height: 0}, flavor: "alpha"});
        const dock = kids[1] as {extra: unknown; children: Array<Record<string, unknown>>};
        expect(dock.extra).toBe(7);
        expect(dock.children.map((child) => child.id)).toEqual(["console", "plugin"]);
        expect(dock.children[0]!.size).toEqual({width: 300, height: 520});
        expect(dock.children[1]).toEqual({kind: "leaf", id: "plugin", ref: "plugin", size: {width: 300, height: 300}});
        expect(kids[2]).toEqual({kind: "leaf", id: "editor", ref: "editor", size: {width: 660, height: 0}});

        // 原件不被就地改动（合成必须无副作用）。
        const original = richRecord();
        const originalKids = (original.root as unknown as {children: Array<Record<string, unknown>>}).children;
        expect(original.note).toBe(base.note as string);
        expect(originalKids[0]!.size).toEqual({width: 240, height: 0});
    });

    it("真实保存路径：写盘内容保留未知部分，且不等于过滤后的 serialize()", async () => {
        const probe = scriptedTransport({
            onRead: () => ({kind: "value", value: richRecord(), schemaVersion: 2, credential: credential("rev-1")}),
            onSave: async () => credential("rev-2"),
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        // 呈现过滤掉了未知引用叶 plugin（resolveRef 缺席）。
        const presented = JSON.stringify(host.grid.serialize());
        expect(presented).not.toContain("plugin");
        expect(presented).not.toContain("top-unknown");
        expect(presented).not.toContain("flavor");

        expect(host.gestureStart({branchId: "root", sizes: [30, 25, 45]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 25, 45]});
        expect(outcome).toMatchObject({status: "saved", fields: [{id: "outline", axis: "width", value: 360}]});

        expect(probe.attempts).toHaveLength(1);
        const stored = probe.attempts[0]!.value;
        const storedJson = JSON.stringify(stored);
        expect(stored.note).toBe("top-unknown");
        expect(stored.meta).toEqual({nested: true, list: [1, 2, 3]});
        expect(storedJson).toContain("flavor");
        expect(storedJson).toContain("plugin");
        expect(storedJson).toContain("branch-unknown");
        expect(storedJson).toContain("extra");

        const kids = (stored.root as unknown as {children: Array<{id: string; size: {width: number}}>}).children;
        expect(kids.map((kid) => kid.id)).toEqual(["outline", "dock", "editor"]);
        expect(kids[0]!.size.width).toBe(360);
        expect(kids[1]!.size.width).toBe(300);
        expect(kids[2]!.size.width).toBe(660);
        const dockChildren = (kids[1] as unknown as {children: Array<{id: string; size: {width: number; height: number}}>}).children;
        expect(dockChildren.map((child) => child.id)).toEqual(["console", "plugin"]);
        expect(dockChildren[1]!.size).toEqual({width: 300, height: 300});

        await workbench.release();
    });

    it("冲突重放以重读后的新基线合成：外来窗口新增的未知结构与字段不被覆盖", async () => {
        const foreign = foreignRecord();
        const probe = scriptedTransport({
            // 读取 1：本窗口读取；读取 2：订阅初始快照；读取 3：冲突后的重读（外来记录）。
            onRead: (index) => index === 3
                ? {kind: "value", value: foreign, schemaVersion: 2, credential: credential("rev-9")}
                : {kind: "value", value: richRecord(), schemaVersion: 2, credential: credential("rev-1")},
            onSave: async (_value, index) => {
                if (index === 1) {
                    throw new StorageAdapterError({code: "STORAGE_REVISION_CONFLICT", status: 409, message: "冲突", committed: false});
                }
                return credential("rev-10");
            },
        });
        const {host, workbench} = await openProbeHost({transport: probe.transport, pluginLoaded: true});
        await host.open();
        host.setContainer({width: 1200, height: 800});

        expect(host.gestureStart({branchId: "root", sizes: [30, 25, 45]})).toEqual({ok: true});
        const outcome = await host.gestureEnd({branchId: "root", active: ["outline"], sizes: [30, 25, 45]});
        expect(outcome.status).toBe("saved");
        expect(probe.attempts).toHaveLength(2);

        const stored = probe.attempts[1]!.value;
        expect((stored as {foreignMark?: string}).foreignMark).toBe("written-by-other-window");
        expect(stored.note).toBe("foreign-note");
        const storedJson = JSON.stringify(stored);
        expect(storedJson).toContain("plugin");
        expect(storedJson).toContain("inbox");
        const kids = (stored.root as unknown as {children: Array<{id: string; size: {width: number}}>}).children;
        expect(kids.map((kid) => kid.id)).toEqual(["outline", "dock", "editor", "inbox"]);
        expect(kids[0]!.size.width).toBe(360);

        await workbench.release();
    });
});
