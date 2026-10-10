/**
 * 元素页签的结构检查（ui.component-lab 验收 23 的元素部分）：可访问名称、id 唯一、describedby 引用、combobox 展开关系、
 * 画布边界，以及 ARIA 读数。
 */

import {afterEach, describe, expect, it} from "vitest";

import {inspectElement} from "./inspect-checks";

afterEach(() => {
    document.body.innerHTML = "";
});

const checksOf = (element: HTMLElement, canvas: HTMLElement | null = null) =>
    Object.fromEntries(inspectElement(element, canvas).checks.map((check) => [check.label, check.pass]));

describe("结构检查", () => {
    it("按钮：名称来自 aria-label，读数给出 role 与名称", () => {
        document.body.innerHTML = '<button id="save" role="button" aria-label="保存章节">保存</button>';
        const button = document.getElementById("save")!;
        const result = inspectElement(button, null);
        expect(checksOf(button)).toMatchObject({"可访问名称": true, "id 唯一": true, "aria-describedby 引用": true});
        const aria = result.groups.find((group) => group.id === "aria")!.items;
        expect(aria).toContainEqual({label: "role", value: "button"});
        expect(aria).toContainEqual({label: "可访问名称", value: "保存章节"});
    });

    it("原生元素没写 role 时给出隐式角色", () => {
        document.body.innerHTML = '<button aria-label="保存">保存</button><input type="checkbox" aria-label="同步"><div>块</div>';
        const role = (element: Element) => inspectElement(element as HTMLElement, null).groups.find((group) => group.id === "aria")!.items.find((item) => item.label === "role")!.value;
        expect(role(document.querySelector("button")!)).toBe("button（隐式）");
        expect(role(document.querySelector("input")!)).toBe("checkbox（隐式）");
        expect(role(document.querySelector("div")!)).toBe("—");
    });

    it("没有名称、id 重复、describedby 指向不存在的元素都判为不通过", () => {
        document.body.innerHTML = '<div id="dup" aria-describedby="gone"></div><span id="dup"></span>';
        const element = document.querySelector("div")!;
        expect(checksOf(element)).toMatchObject({"可访问名称": false, "id 唯一": false, "aria-describedby 引用": false});
    });

    it("隐藏的文字、空白的 aria-label、普通块的文字都不算名称；按钮的可见文字算", () => {
        document.body.innerHTML = [
            '<button id="icon"><span aria-hidden="true">✕</span></button>',
            '<button id="blank" aria-label="  "></button>',
            '<div id="plain">普通文字</div>',
            '<button id="text"><span aria-hidden="true">✕</span> 关闭</button>',
        ].join("");
        expect(checksOf(document.getElementById("icon")!)).toMatchObject({"可访问名称": false});
        expect(checksOf(document.getElementById("blank")!)).toMatchObject({"可访问名称": false});
        expect(checksOf(document.getElementById("plain")!)).toMatchObject({"可访问名称": false});
        expect(checksOf(document.getElementById("text")!)).toMatchObject({"可访问名称": true});
    });

    it("名称可以来自关联的 label", () => {
        document.body.innerHTML = '<label for="title">书名</label><input id="title">';
        expect(checksOf(document.getElementById("title")!)).toMatchObject({"可访问名称": true});
    });

    it("展开的 combobox 要能找到它控制的弹出列表", () => {
        document.body.innerHTML = '<input role="combobox" aria-label="语言" aria-expanded="true" aria-controls="list">';
        const input = document.querySelector("input")!;
        expect(checksOf(input)).toMatchObject({"combobox 展开关系": false});
        document.body.insertAdjacentHTML("beforeend", '<ul id="list" role="listbox"></ul>');
        expect(checksOf(input)).toMatchObject({"combobox 展开关系": true});
    });

    it("没有关联的展开 combobox 不因页面上别的列表框而通过", () => {
        document.body.innerHTML = '<input role="combobox" aria-label="语言" aria-expanded="true"><ul role="listbox"></ul>';
        expect(checksOf(document.querySelector("input")!)).toMatchObject({"combobox 展开关系": false});
    });

    it("画布外的元素不判画布边界", () => {
        document.body.innerHTML = '<div id="canvas"></div><button aria-label="外面">外面</button>';
        const canvas = document.getElementById("canvas")!;
        const outside = document.querySelector("button")!;
        const check = inspectElement(outside, canvas).checks.find((item) => item.label === "画布边界")!;
        expect(check).toEqual({label: "画布边界", pass: true, detail: "不在画布里，不判"});
    });
});
