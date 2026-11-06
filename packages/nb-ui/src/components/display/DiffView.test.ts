import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {h, nextTick} from "vue";

import DiffView from "./DiffView.vue";

const LONG_HEAD = "前".repeat(300);

describe("DiffView", () => {
    it("改动用 ins、del 和前缀标出，不只靠颜色；标题行写增删行数", () => {
        const view = mount(DiffView, {props: {before: "甲\n他没有回头。", after: "甲\n他回头了。\n新的一行", label: "正文/第三章.md"}});
        expect(view.get(".nb-diff__label").text()).toBe("正文/第三章.md");
        expect(view.get(".nb-diff__stat").text()).toBe("+2−1");
        expect(view.findAll("del").map((node) => node.text())).toEqual(["没有"]);
        expect(view.findAll("ins").map((node) => node.text())).toEqual(["了", "新的一行"]);
        expect(view.findAll(".nb-diff__cell[data-side='left'] .nb-diff__prefix").map((node) => node.text())).toContain("−");
        expect(view.findAll(".nb-diff__cell[data-side='right'] .nb-diff__prefix").map((node) => node.text())).toContain("+");
    });

    it("没变的连续行收起，点开才显示", async () => {
        const before = Array.from({length: 20}, (_, index) => `第${index}行`);
        const after = [...before];
        after[10] = "改了";
        const view = mount(DiffView, {props: {before: before.join("\n"), after: after.join("\n")}});
        expect(view.text()).not.toContain("第0行");
        const folds = view.findAll(".nb-diff__fold");
        expect(folds.map((fold) => fold.text())).toEqual(["展开 8 行没变的内容", "展开 7 行没变的内容"]);
        await folds[0]!.trigger("click");
        expect(view.text()).toContain("第0行");
        expect(view.findAll(".nb-diff__fold")).toHaveLength(1);
    });

    it("一行之内的长文字收起，点开这一行；内容变了又收回去", async () => {
        const view = mount(DiffView, {props: {before: `${LONG_HEAD}旧`, after: `${LONG_HEAD}新`}});
        expect(view.get(".nb-diff__chars").text()).toBe("…（260 字）…");
        expect(view.text()).not.toContain(LONG_HEAD);
        await view.get(".nb-diff__chars").trigger("click");
        expect(view.find(".nb-diff__chars").exists()).toBe(false);
        expect(view.text()).toContain(LONG_HEAD);
        await view.setProps({after: `${LONG_HEAD}另一个`});
        await nextTick();
        expect(view.find(".nb-diff__chars").exists()).toBe(true);
    });

    it("每块改动一个 actions 插槽，拿到这块的范围和文字", () => {
        const scopes: unknown[] = [];
        mount(DiffView, {
            props: {before: "甲\n乙\n丙\n丁", after: "甲\n乙乙\n丙\n丁\n戊"},
            slots: {
                actions: (scope: unknown) => {
                    scopes.push(scope);
                    return h("button", "采纳");
                },
            },
        });
        expect(scopes).toEqual([
            {hunk: {index: 0, beforeRange: [1, 2], afterRange: [1, 2]}, beforeText: "乙", afterText: "乙乙"},
            {hunk: {index: 1, beforeRange: [4, 4], afterRange: [4, 5]}, beforeText: "", afterText: "戊"},
        ]);
    });

    it("没有 actions 插槽时不占位置", () => {
        const view = mount(DiffView, {props: {before: "甲", after: "乙"}});
        expect(view.find(".nb-diff__actions").exists()).toBe(false);
    });

    it("没有改动时写明，不收起", () => {
        const text = Array.from({length: 20}, (_, index) => `第${index}行`).join("\n");
        const view = mount(DiffView, {props: {before: text, after: text}});
        expect(view.get(".nb-diff__note").text()).toBe("没有改动");
        expect(view.find(".nb-diff__fold").exists()).toBe(false);
        expect(view.find(".nb-diff__stat").exists()).toBe(false);
    });

    it("mode 是 v-model：切换发 update:mode，根元素跟着变", async () => {
        const view = mount(DiffView, {props: {before: "甲", after: "乙"}});
        expect(view.attributes("data-mode")).toBe("inline");
        await view.findAll("[role='radio']")[1]!.trigger("click");
        expect(view.emitted("update:mode")).toEqual([["split"]]);
        expect(view.attributes("data-mode")).toBe("split");
    });
});
