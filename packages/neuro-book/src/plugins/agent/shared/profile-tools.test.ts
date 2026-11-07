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
