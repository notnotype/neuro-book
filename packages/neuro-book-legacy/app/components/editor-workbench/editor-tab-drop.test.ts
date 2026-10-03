import {describe, expect, it} from "vitest";
import {editorDragStructure, resolveEditorTabDrop, sameEditorDrop, type EditorDragGroup, type EditorTabDropTarget} from "./editor-tab-drop";
import type {EditorTabPresentation} from "./editor-view.types";

const tab = (path: string, pinned = false): EditorTabPresentation => ({path, title: path, pinned, dirty: false, preview: false, iconClass: "i-lucide-file-text"});
const groups: EditorDragGroup[] = [{id: "main", tabs: [tab("A"), tab("B"), tab("C")]}, {id: "side", tabs: [tab("P", true), tab("D")]}];
const rect = {left: 0, top: 0, right: 400, bottom: 40};
const tabsTarget: EditorTabDropTarget = {kind: "tabs", groupId: "main", pinned: false, rect,
    members: ["A", "B", "C"].map((id, index) => ({id, rect: {left: index * 104, right: index * 104 + 100, top: 4, bottom: 36}}))};
const resolve = (x: number, target = tabsTarget, source = {groupId: "main", path: "A"}) => resolveEditorTabDrop({groups, source, target, point: {x, y: 20}, allowSplit: true});

describe("编辑器标签落点", () => {
    it("B后半、B/C间隙、C前半统一插到C前，反馈不跳坐标", () => {
        const decisions = [190, 206, 220].map(x => resolve(x));
        expect(decisions.map(d => d?.action)).toEqual(Array(3).fill({kind: "move", request: {
            path: "A", sourceGroupId: "main", targetGroupId: "main", targetPath: "C", targetPinned: false, position: "before",
        }}));
        expect(decisions[0]?.preview.indicator).toEqual(decisions[1]?.preview.indicator);
        expect(decisions[1]?.preview.indicator).toEqual(decisions[2]?.preview.indicator);
        expect(sameEditorDrop(decisions[0]!, decisions[2]!)).toBe(true);
    });
    it("最后标签后半和列表尾空白共用末尾位置，不在flex中插节点", () => {
        const end = resolve(390)!;
        expect(end.action).toMatchObject({kind: "move", request: {targetPath: null, position: "after"}});
        expect(end.preview.indicator).toEqual(resolve(300)?.preview.indicator);
        expect(end.preview.indicator!.right - end.preview.indicator!.left).toBe(2);
    });
    it("原位前后均显示对应插入线，但不产生移动动作", () => {
        for (const [path, beforeX, afterX] of [["A", 10, 102], ["B", 102, 206], ["C", 206, 390]] as const) {
            const source = {groupId: "main", path};
            const before = resolve(beforeX, tabsTarget, source)!;
            const after = resolve(afterX, tabsTarget, source)!;
            expect(before).not.toBeNull();
            expect(after).not.toBeNull();
            expect(before.action).toBeNull();
            expect(after.action).toBeNull();
            expect(before.preview.indicator!.right).toBeLessThan(after.preview.indicator!.left);
            expect(after.preview.indicator!.right - after.preview.indicator!.left).toBe(2);
        }
        expect(resolve(102)!.preview.indicator).toEqual({left: 101, right: 103, top: 4, bottom: 36});
    });
    it("单行拒绝固定区拖入，多行固定区接受", () => {
        expect(resolve(10, {...tabsTarget, pinned: true, members: []})).toBeNull();
        const pin = resolve(10, {...tabsTarget, pinned: true, wrap: true, members: []})!;
        expect(pin.action).toMatchObject({kind: "move", request: {targetPinned: true, targetPath: null}});
    });
    it("跨组插到目标前保留来源身份，不等价于组内换序", () => {
        expect(resolve(110, tabsTarget, {groupId: "side", path: "D"})?.action).toEqual({kind: "transfer", request: {
            path: "D", sourceGroupId: "side", targetGroupId: "main", targetPath: "B", targetPinned: false, position: "before",
        }});
    });
    it("可见尾项后仍有被滚动裁掉的标签，不误追加到整个分区末尾", () => {
        const clipped = {...tabsTarget, rect: {...rect, right: 205}, members: tabsTarget.members.slice(0, 2)};
        expect(resolve(200, clipped)?.action).toMatchObject({kind: "move", request: {targetPath: "C", position: "before"}});
    });
    it("多行标签按指针所在行插入，上一行尾部不是整个列表末尾", () => {
        const target: EditorTabDropTarget = {kind: "tabs", groupId: "main", pinned: false, wrap: true,
            rect: {left: 0, top: 0, right: 400, bottom: 80}, members: [
                {id: "A", rect: {left: 4, top: 4, right: 104, bottom: 32}},
                {id: "B", rect: {left: 112, top: 4, right: 212, bottom: 32}},
                {id: "C", rect: {left: 4, top: 40, right: 104, bottom: 68}},
            ]};
        const base = {groups, source: {groupId: "side", path: "D"}, target, allowSplit: true};
        const rowEnd = resolveEditorTabDrop({...base, point: {x: 300, y: 18}})!;
        expect(rowEnd.action).toMatchObject({kind: "transfer", request: {targetPath: "C", position: "before"}});
        expect(rowEnd.preview.indicator).toMatchObject({left: 0, top: 40, bottom: 68});
        const rowStart = resolveEditorTabDrop({...base, point: {x: 10, y: 54}})!;
        expect(rowStart.action).toMatchObject({kind: "transfer", request: {targetPath: "C", position: "before"}});
        expect(rowStart.preview.indicator).toMatchObject({left: 0, top: 40, bottom: 68});
        expect(rowStart.preview.indicator).toEqual(rowEnd.preview.indicator);
        expect(resolveEditorTabDrop({...base, point: {x: 300, y: 54}})?.action).toMatchObject({kind: "transfer", request: {targetPath: null, position: "after"}});
    });
    it("多行固定区与普通区独立命中，分区间隙不产生第二个锚点", () => {
        const pinned: EditorTabDropTarget = {kind: "tabs", groupId: "side", pinned: true, wrap: true,
            rect: {left: 0, top: 0, right: 400, bottom: 36}, members: [
                {id: "P", rect: {left: 6, top: 4, right: 106, bottom: 30}},
            ]};
        const regular: EditorTabDropTarget = {kind: "tabs", groupId: "side", pinned: false, wrap: true,
            rect: {left: 0, top: 40, right: 400, bottom: 76}, members: [
                {id: "D", rect: {left: 6, top: 44, right: 106, bottom: 72}},
            ]};
        const base = {groups, source: {groupId: "main", path: "A"}, allowSplit: true};
        expect(resolveEditorTabDrop({...base, target: pinned, point: {x: 10, y: 18}})?.action).toMatchObject({kind: "transfer", request: {targetPath: "P", targetPinned: true}});
        expect(resolveEditorTabDrop({...base, target: regular, point: {x: 10, y: 54}})?.action).toMatchObject({kind: "transfer", request: {targetPath: "D", targetPinned: false}});
        expect(resolveEditorTabDrop({...base, target: pinned, point: {x: 10, y: 38}})).toBeNull();
        expect(resolveEditorTabDrop({...base, target: regular, point: {x: 10, y: 38}})).toBeNull();
    });
    it("正文中央给整区反馈但动作可空：跨组与同组都可见，同组唯一标签也照画", () => {
        const target: EditorTabDropTarget = {kind: "content", groupId: "main", rect: {left: 0, top: 0, right: 500, bottom: 500}};
        const base = {target, allowSplit: true};
        for (const source of [{groupId: "side", path: "D"}, {groupId: "main", path: "A"}]) {
            const keep = resolveEditorTabDrop({...base, groups, source, point: {x: 300, y: 200}})!;
            expect(keep.action).toBeNull();
            expect(keep.preview).toEqual({areaRect: {left: 0, top: 0, right: 500, bottom: 500}, entryRect: null, indicator: null, orientation: "horizontal"});
            expect(sameEditorDrop(keep, resolveEditorTabDrop({...base, groups, source, point: {x: 250, y: 250}}))).toBe(true);
            // 空动作预览永远不会与真实的插入位意图等价：释放不能借它提交旧动作。
            expect(sameEditorDrop(keep, resolve(206, tabsTarget, source))).toBe(false);
        }
        const solo: EditorDragGroup[] = [{id: "main", tabs: [tab("A")]}];
        const soloKeep = resolveEditorTabDrop({...base, groups: solo, source: {groupId: "main", path: "A"}, point: {x: 250, y: 250}})!;
        expect(soloKeep.action).toBeNull();
        expect(soloKeep.preview.areaRect).toEqual({left: 0, top: 0, right: 500, bottom: 500});
    });
    it("正文四边分屏给相应半区；关闭分屏能力与唯一标签自边缘仍拒绝", () => {
        const target: EditorTabDropTarget = {kind: "content", groupId: "main", rect: {left: 0, top: 0, right: 500, bottom: 500}};
        const base = {groups, source: {groupId: "side", path: "D"}, target, allowSplit: true};
        for (const [direction, point, area] of [
            ["left", {x: 10, y: 250}, {left: 0, top: 0, right: 250, bottom: 500}],
            ["right", {x: 490, y: 250}, {left: 250, top: 0, right: 500, bottom: 500}],
            ["top", {x: 250, y: 10}, {left: 0, top: 0, right: 500, bottom: 250}],
            ["bottom", {x: 250, y: 490}, {left: 0, top: 250, right: 500, bottom: 500}],
        ] as const) {
            const decision = resolveEditorTabDrop({...base, point})!;
            expect(decision.action).toMatchObject({kind: "split", request: {direction, mode: "move", sourceGroupId: "side", targetGroupId: "main", path: "D"}});
            expect(decision.preview.areaRect).toEqual(area);
            expect(decision.preview.indicator).toBeNull();
        }
        // 宿主不开放分屏：正文任何位置都不接收，中央的整区反馈也不出现。
        for (const point of [{x: 250, y: 250}, {x: 10, y: 250}]) {
            expect(resolveEditorTabDrop({...base, allowSplit: false, point})).toBeNull();
        }
        const solo: EditorDragGroup[] = [{id: "main", tabs: [tab("A")]}];
        const source = {groupId: "main", path: "A"};
        expect(resolveEditorTabDrop({...base, groups: solo, source, point: {x: 10, y: 250}})).toBeNull();
        expect(resolveEditorTabDrop({...base, groups: solo, source, point: {x: 250, y: 250}})!.action).toBeNull();
    });
    it("结构失效口径忽略文案和dirty，包含顺序固定状态与宿主代际", () => {
        const baseline = editorDragStructure(groups, "one", 1, true);
        expect(editorDragStructure(groups.map(group => ({...group, tabs: group.tabs.map(tab => ({...tab, title: "新标题", dirty: true}))})), "one", 1, true)).toBe(baseline);
        expect(editorDragStructure(groups, "two", 1, true)).not.toBe(baseline);
        expect(editorDragStructure(groups, "one", 2, true)).not.toBe(baseline);
        expect(editorDragStructure([{id: "main", tabs: [tab("B"), tab("A"), tab("C")]}], "one", 1, true)).not.toBe(baseline);
    });
});
