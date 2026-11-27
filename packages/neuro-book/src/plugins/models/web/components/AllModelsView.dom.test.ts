/**
 * AllModelsView（同名 .md）的行数上限与读取状态：不搜索时每节各自封顶，搜索时一共封顶；读取中、读取失败、没有命中各有一句。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {generatedRows, SAMPLE_PROVIDERS, SAMPLE_ROWS} from "nbook/plugins/models/web/lab/sample";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {modelsCatalogs} from "../text";
import {checkKey} from "../models-store";
import AllModelsView from "./AllModelsView.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const big = {...SAMPLE_PROVIDERS[0]!, id: "big", name: "大服务商", enabledCount: 600};
const small = SAMPLE_PROVIDERS[0]!;

function render(props: Record<string, unknown>) {
    const wrapper = mount(AllModelsView, {global, props: {providers: [big, small], ...props}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}
const rowsIn = (provider: string): number => document.querySelectorAll(`[data-all-models-provider="${provider}"] [data-all-models-row]`).length;
const open = async (provider: string): Promise<void> => {
    document.querySelector<HTMLButtonElement>(`[data-all-models-provider="${provider}"] button`)!.click();
    await flushPromises();
};
async function search(value: string): Promise<void> {
    const input = document.querySelector<HTMLInputElement>("[data-all-models-search] input, input[data-all-models-search]")!;
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await flushPromises();
}

describe("全部模型", () => {
    it("检测结果三种：通过、失败、结果未知（检测被取消，请求可能已经发出）各有自己的图标与读屏名称", async () => {
        const [flash, pro] = SAMPLE_ROWS.deepseek!;
        render({providers: [small], rows: {deepseek: SAMPLE_ROWS.deepseek}, checks: new Map([
            [checkKey("deepseek", flash!.id), {status: "done", at: 0, result: {ok: true}}],
            [checkKey("deepseek", pro!.id), {status: "unknown", at: 0}],
        ])});
        await open("deepseek");
        const label = (id: string): string | null => document.querySelector(`[data-all-models-row="deepseek/${id}"] :is(.all-models__ok, .all-models__failed, .all-models__unknown)`)?.getAttribute("aria-label") ?? null;
        expect(label(flash!.id)).toBe("检测通过");
        expect(label(pro!.id)).toBe("结果未知：检测被取消，请求可能已经发出");
    });

    it("不搜索时每节各自至多 200 行：展开几百个的一家不挤掉别家；搜索时一共至多 200 行", async () => {
        render({rows: {big: generatedRows(600), deepseek: SAMPLE_ROWS.deepseek}});
        await open("big");
        await open("deepseek");
        expect(rowsIn("big")).toBe(200);
        expect(rowsIn("deepseek")).toBe(SAMPLE_ROWS.deepseek!.filter((row) => row.enabled).length);
        expect(document.querySelector("[data-all-models-more]")?.textContent).toContain("400");
        await search("-");
        expect(rowsIn("big") + rowsIn("deepseek")).toBe(200);
    });

    it("展开时还在读写“读取中”，读失败写原因；搜索没有命中写“没有匹配”，还有在读的先写“读取中”", async () => {
        const wrapper = render({rows: {}, loading: new Set(["big"]), failures: {deepseek: "服务没有回应"}});
        await open("big");
        expect(document.querySelector("[data-all-models-provider='big'] [data-all-models-loading]")).not.toBeNull();
        await open("deepseek");
        expect(document.querySelector("[data-all-models-provider='deepseek'] [data-all-models-failure]")?.textContent).toContain("服务没有回应");
        await search("没有这个模型");
        expect(document.querySelector("[data-all-models-none]")?.textContent).toBe("读取模型中");
        await wrapper.setProps({loading: new Set()});
        expect(document.querySelector("[data-all-models-none]")?.textContent).toBe("没有匹配的模型");
    });
});
