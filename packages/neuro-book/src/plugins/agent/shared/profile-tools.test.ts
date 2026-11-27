/** 工具集与绑定的换算（docs/specs/agent/contributions.md 输出 4，profile-settings.md 输出 13、15、16）。 */

import {describe, expect, test} from "bun:test";

import {changeToolBinding, profileToolIds, sameNameTool, visibleToolIds, withToolBinding} from "./profile-tools";

const requirements = {required: ["read"], optional: ["edit"]};
const defaults = ["ask"];

describe("工具集", () => {
    test("顺序是必需、可选、装到所有的、绑定加的；绑定去掉的减掉，必需的减不掉", () => {
        expect(profileToolIds(requirements, defaults, {added: ["plot"], removed: ["edit", "read"]})).toEqual(["read", "ask", "plot"]);
    });

    test("defaultTools: false 不加装到所有的，绑定加的照样生效", () => {
        expect(profileToolIds({...requirements, defaultTools: false}, defaults, {added: ["ask"], removed: []})).toEqual(["read", "edit", "ask"]);
        expect(profileToolIds({...requirements, defaultTools: false}, defaults, undefined)).toEqual(["read", "edit"]);
    });

    test("模型看到的：同名先出现的胜出，不存在的不算", () => {
        const names: Readonly<Record<string, string>> = {read: "read", edit: "edit", "edit-replace": "edit"};
        expect(visibleToolIds(["read", "edit-replace", "edit", "gone"], (id) => names[id])).toEqual(["read", "edit-replace"]);
    });
});

describe("改绑定", () => {
    test("去掉本来就有的写进 removed，开回来从 removed 删掉、不写进 added", () => {
        const removed = changeToolBinding(undefined, requirements, defaults, {remove: ["edit"]});
        expect(removed).toEqual({added: [], removed: ["edit"]});
        expect(changeToolBinding(removed, requirements, defaults, {add: ["edit"]})).toEqual({added: [], removed: []});
    });

    test("加本来没有的写进 added，去掉后两边都没有", () => {
        const added = changeToolBinding(undefined, requirements, defaults, {add: ["plot"]});
        expect(added).toEqual({added: ["plot"], removed: []});
        expect(changeToolBinding(added, requirements, defaults, {remove: ["plot"]})).toEqual({added: [], removed: []});
    });

    test("必需的不进 removed", () => {
        expect(changeToolBinding(undefined, requirements, defaults, {remove: ["read"]})).toEqual({added: [], removed: []});
    });

    test("换同名：一次改动里加新的、去掉旧的；旧的是装到所有的也算", () => {
        expect(changeToolBinding(undefined, requirements, defaults, {add: ["ask-form"], remove: ["ask"]})).toEqual({added: ["ask-form"], removed: ["ask"]});
    });

    test("结果照 profileToolIds 算就是想要的", () => {
        const binding = changeToolBinding({added: ["plot"], removed: []}, requirements, defaults, {add: ["edit-replace"], remove: ["edit", "plot"]});
        expect(profileToolIds(requirements, defaults, binding)).toEqual(["read", "ask", "edit-replace"]);
    });

    test("两个数组都空时不留 key，别的 Profile 原样留着", () => {
        const other = {added: ["x"], removed: []};
        expect(withToolBinding({a: {added: ["y"], removed: []}, b: other}, "a", {added: [], removed: []})).toEqual({b: other});
        expect(withToolBinding({b: other}, "a", {added: ["y"], removed: []})).toEqual({a: {added: ["y"], removed: []}, b: other});
    });
});

describe("同名工具", () => {
    const names: Readonly<Record<string, string>> = {read: "read", edit: "edit", "edit-replace": "edit", ask: "ask"};
    const nameOf = (id: string) => names[id];

    test("已开的同名工具能去掉时换掉它，必需的换不掉", () => {
        expect(sameNameTool("edit", ["read", "edit-replace"], nameOf, ["read"])).toEqual({replaces: "edit-replace"});
        expect(sameNameTool("edit", ["read", "edit-replace"], nameOf, ["edit-replace"])).toEqual({blockedBy: "edit-replace"});
    });

    test("没有同名的、或它自己已经开着时什么都不碰", () => {
        expect(sameNameTool("ask", ["read"], nameOf, [])).toEqual({});
        expect(sameNameTool("edit", ["edit"], nameOf, [])).toEqual({});
    });
});

describe("全局对象（profile-settings.md 输出 28、29）", () => {
    const METHODS: Readonly<Record<string, readonly string[]>> = {ui: ["ui.snapshot", "ui.find", "ui.highlight"]};
    const methodsOf = (object: string): readonly string[] => METHODS[object] ?? [];
    const withUi = ["ask", ...METHODS.ui!];

    test("去掉的对象去掉它此刻的全部方法（必需的除外），加上的对象加上全部方法；方法级的增减在对象之后套用", () => {
        expect(profileToolIds(requirements, withUi, {added: [], removed: [], objects: {added: [], removed: ["ui"]}}, methodsOf)).toEqual(["read", "edit", "ask"]);
        expect(profileToolIds({...requirements, required: ["read", "ui.find"]}, withUi, {added: [], removed: [], objects: {added: [], removed: ["ui"]}}, methodsOf)).toEqual(["read", "ui.find", "edit", "ask"]);
        expect(profileToolIds({...requirements, defaultTools: false}, withUi, {added: ["ui.snapshot"], removed: ["ui.find"], objects: {added: ["ui"], removed: []}}, methodsOf)).toEqual(["read", "edit", "ui.snapshot", "ui.highlight"]);
    });

    test("Profile 本来有这个对象：去掉写进 objects.removed，加回删掉；本来没有：加回写进 objects.added，再去掉两边都没有", () => {
        const removed = changeToolBinding(undefined, requirements, withUi, {removeObjects: ["ui"]}, methodsOf);
        expect(removed).toEqual({added: [], removed: [], objects: {added: [], removed: ["ui"]}});
        expect(changeToolBinding(removed, requirements, withUi, {addObjects: ["ui"]}, methodsOf)).toEqual({added: [], removed: []});

        const bare = {...requirements, defaultTools: false as const};
        const added = changeToolBinding(undefined, bare, withUi, {addObjects: ["ui"]}, methodsOf);
        expect(added).toEqual({added: [], removed: [], objects: {added: ["ui"], removed: []}});
        expect(profileToolIds(bare, withUi, added, methodsOf)).toEqual(["read", "edit", ...METHODS.ui!]);
        expect(changeToolBinding(added, bare, withUi, {removeObjects: ["ui"]}, methodsOf)).toEqual({added: [], removed: []});
    });

    test("本来只有一部分方法：去掉再加回恢复原来那几个，不扩大成全部", () => {
        const partial = {required: ["read"], optional: ["ui.snapshot"], defaultTools: false as const};
        const off = changeToolBinding(undefined, partial, withUi, {removeObjects: ["ui"]}, methodsOf);
        expect(profileToolIds(partial, withUi, off, methodsOf)).toEqual(["read"]);
        const back = changeToolBinding(off, partial, withUi, {addObjects: ["ui"]}, methodsOf);
        expect(profileToolIds(partial, withUi, back, methodsOf)).toEqual(["read", "ui.snapshot"]);
    });

    test("动对象行时删掉它的方法在 added、removed 里的旧条目，别的工具的条目不动", () => {
        const before = {added: ["ui.find", "plot"], removed: ["ui.snapshot", "edit"]};
        expect(changeToolBinding(before, requirements, withUi, {removeObjects: ["ui"]}, methodsOf)).toEqual({added: ["plot"], removed: ["edit"], objects: {added: [], removed: ["ui"]}});
    });

    test("只剩对象的增减时照样留 key；几张表都空才删", () => {
        const objects = {added: [], removed: [], objects: {added: [], removed: ["ui"]}};
        expect(withToolBinding({}, "a", objects)).toEqual({a: objects});
        expect(withToolBinding({a: objects}, "a", {added: [], removed: [], objects: {added: [], removed: []}})).toEqual({});
    });
});
