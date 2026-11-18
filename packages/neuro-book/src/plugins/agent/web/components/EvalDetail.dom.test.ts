/**
 * EvalDetail（同名 .md）与 eval 卡片的副标题（`evalSummary`，docs/specs/agent/eval.md）：代码在上、默认收起，输出在下；
 * 还没开始执行时不写“正在运行”；只重置内核时没有代码那一行；图片只写张数。
 */
import type {ToolCallView} from "@notnotype/nb-agent-ui";
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {AGENT_TEXT_NAMESPACE} from "../../shared/text";
import {evalSummary} from "../eval-renderer";
import {agentCatalogs} from "../text";
import EvalDetail from "./EvalDetail.vue";

const port = testTextPort("zh-CN", {[AGENT_TEXT_NAMESPACE]: agentCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const CODE = "\n// 统计字数\nconst text = await tool.read({path: 'project://正文/第三章.md'});\ntext.length";
const call = (patch: Partial<ToolCallView> = {}): ToolCallView => ({id: "e1", name: "eval", status: "success", args: {title: "数第三章的字", code: CODE}, ...patch});

function detail(value: ToolCallView) {
    const wrapper = mount(EvalDetail, {global: {provide: provideText(port)}, props: {call: value}});
    mounted.push(wrapper);
    return wrapper;
}

describe("EvalDetail", () => {
    it("代码默认收起，行尾是第一行非空的代码；点开是带行号的代码块；输出在下面", async () => {
        const view = detail(call({startedAt: 1, result: {text: "11820", truncated: false, details: {cell: 1, bytes: 5, images: 0}}}));
        const code = view.get("[data-eval-code]");
        expect(code.text()).toContain("// 统计字数");
        expect(code.text()).not.toContain("text.length");
        await code.get("button").trigger("click");
        expect(view.get("[data-eval-code]").text()).toContain("text.length");
        expect(view.get("[data-eval-output]").text()).toContain("11820");
        expect(view.find("[data-eval-images]").exists()).toBe(false);
        expect(view.text()).not.toContain("正在运行");
    });

    it("开始执行、还没有结果时写正在运行；参数在生成、在等批准（没有开始时刻）时不写", () => {
        expect(detail(call({status: "running", startedAt: 1})).text()).toContain("正在运行");
        expect(detail(call({status: "running"})).text()).not.toContain("正在运行");
        expect(detail(call({status: "streaming", args: {title: "数第三章的字", partialChars: 30}})).text()).not.toContain("正在运行");
    });

    it("只重置内核（没有代码）时没有代码那一行；交了图片时写张数", () => {
        const reset = detail(call({args: {reset: true, code: ""}, startedAt: 1, result: {text: "内核已重置。", truncated: false}}));
        expect(reset.find("[data-eval-code]").exists()).toBe(false);
        const images = detail(call({startedAt: 1, result: {text: "画好了", truncated: false, details: {cell: 2, bytes: 6, images: 2}}}));
        expect(images.get("[data-eval-images]").text()).toContain("2");
    });
});

describe("eval 卡片的副标题", () => {
    it("模型写的标题优先；没写时取第一行非空的代码；都没有是空的", () => {
        expect(evalSummary(call())).toBe("数第三章的字");
        expect(evalSummary(call({args: {code: CODE}}))).toBe("// 统计字数");
        expect(evalSummary(call({args: {reset: true, code: ""}}))).toBe("");
    });
});
