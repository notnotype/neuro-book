/**
 * RecordForm（同名 .md，docs/specs/canon/author-ui.md 输出 17）：精确档两个输入、语义档一个；什么时候能提交；不可用的原因与
 * 上一次的失败。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import RecordForm from "./RecordForm.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function form(props: Record<string, unknown>) {
    const wrapper = mount(RecordForm, {props: {delta: "", text: "", ...props}, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    return wrapper;
}

describe("RecordForm", () => {
    it("精确档要一句话与一个数才能提交；语义档只要一句话", async () => {
        expect(form({}).findAll("input")).toHaveLength(2);
        expect(form({text: "领了工资", delta: "abc"}).get("button").attributes("disabled")).toBeDefined();
        const ready = form({text: "领了工资", delta: "-200"});
        await ready.get("form").trigger("submit");
        expect(ready.emitted("submit")).toHaveLength(1);
        const semantic = form({semantic: true, text: "被白灵救了"});
        expect(semantic.findAll("input")).toHaveLength(1);
        expect(semantic.get("button").attributes("disabled")).toBeUndefined();
    });

    it("不可用时输入禁用、写原因；上一次没记进去的原因写在下面", () => {
        const blocked = form({text: "领了工资", delta: "1", blockedReason: "先选一章"});
        expect(blocked.text()).toContain("先选一章");
        expect(blocked.get("input").attributes("disabled")).toBeDefined();
        expect(blocked.get("button").attributes("disabled")).toBeDefined();
        expect(form({error: "这个值刚刚变了"}).get("[role='alert']").text()).toBe("这个值刚刚变了");
    });
});
