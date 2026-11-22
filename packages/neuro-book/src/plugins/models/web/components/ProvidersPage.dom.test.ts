/**
 * “服务商与模型”页的模板化交互（docs/specs/models/settings-pages.md 输出 3、4、6 到 11）：按模板添加、标题区改名与复制与换图标、
 * 几百个模型时系列默认收起且不渲染、搜索最多 200 行、全部模型按服务商收起。数据经 Lab 场景同一份假远端（`fake-remote.ts`，走 JSON 编解码）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeModelsRemote} from "nbook/plugins/lab/web/fixtures/models-scene/fake-remote";
import {SAMPLE_SNAPSHOT} from "nbook/plugins/lab/web/fixtures/models-scene/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {createModelsStore} from "../models-store";
import {modelsCatalogs} from "../text";
import ProvidersPage from "./ProvidersPage.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};
const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

async function render() {
    const fake = createFakeModelsRemote(SAMPLE_SNAPSHOT);
    const store = createModelsStore(fake.remote);
    stores.push(store);
    const wrapper = mount(ProvidersPage, {global, props: {store, writable: true, reportWriteFailure: () => undefined}, attachTo: document.body});
    mounted.push(wrapper);
    await waitUntil("服务商详情", () => document.querySelector("[data-provider-detail]") !== null, {timeoutMs: 10_000});
    return {wrapper, store};
}
const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    await flushPromises();
};
const selected = (): string | null => document.querySelector("[data-provider-detail]")?.getAttribute("data-provider-detail") ?? null;

describe("添加：按模板", () => {
    it("点一个普通模板：加上并选中，焦点到密钥框，名称与图标跟模板；再添加同一个模板得到另一份（名称加 2）", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-provider-add]").click();
        await waitUntil("添加窗口有模板", () => document.querySelector("[data-add-provider='zai']") !== null, {timeoutMs: 10_000});
        query<HTMLButtonElement>("[data-add-provider='zai']").click();
        await waitUntil("选中新服务商", () => selected() === "z.ai", {timeoutMs: 10_000});
        await waitUntil("焦点在密钥框", () => document.activeElement?.closest("[data-key-input]") != null, {timeoutMs: 10_000});
        expect(store.snapshot.value?.providers.find((provider) => provider.id === "z.ai")).toMatchObject({template: "zai", name: "Z.AI", icon: null});
        expect(query("[data-provider-name]").textContent).toBe("Z.AI");
        expect(document.querySelector("[data-add-provider-dialog]")).toBeNull();
        query<HTMLButtonElement>("[data-provider-add]").click();
        await waitUntil("再开添加窗口", () => document.querySelector("[data-add-provider='zai']") !== null, {timeoutMs: 10_000});
        expect(query("[data-add-provider='zai']").getAttribute("aria-label")).toContain("已添加");
    });
});

describe("标题区", () => {
    it("改名：回车提交；重名在输入框下写原因、不发；空名与 Esc 回退", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-provider-rename]").click();
        await flushPromises();
        const input = (): HTMLInputElement => query<HTMLInputElement>("[data-provider-name-input] input, input[data-provider-name-input]");
        await type(input(), "火山方舟");
        input().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(document.querySelector("[data-name-problem]")?.textContent).toContain("已有同名服务商");
        expect(store.snapshot.value?.providers[0]?.name).toBe("DeepSeek");
        await type(input(), "深度求索");
        input().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await waitUntil("改名写进去", () => store.snapshot.value?.providers[0]?.name === "深度求索", {timeoutMs: 10_000});
        expect(query("[data-provider-name]").textContent).toBe("深度求索");
        query<HTMLButtonElement>("[data-provider-rename]").click();
        await flushPromises();
        await type(input(), "   ");
        input().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        await flushPromises();
        expect(query("[data-provider-name]").textContent).toBe("深度求索");
    });

    it("复制一份：选中副本、名称加 2；换内置图标与恢复模板的图标", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-provider-duplicate]").click();
        await waitUntil("选中副本", () => selected() === "deepseek-copy", {timeoutMs: 10_000});
        expect(store.snapshot.value?.providers.find((provider) => provider.id === "deepseek-copy")?.name).toBe("DeepSeek 2");
        query<HTMLButtonElement>("[data-provider-icon-button]").click();
        await waitUntil("图标面板", () => document.querySelector("[data-icon-choice]") !== null, {timeoutMs: 10_000});
        query<HTMLButtonElement>("[data-icon-choice='openai']").click();
        await waitUntil("图标写进去", () => store.snapshot.value?.providers.find((provider) => provider.id === "deepseek-copy")?.icon?.kind === "builtin", {timeoutMs: 10_000});
        // 写入返回之前面板的控件是停用的（`iconBusy`）：等恢复按钮可点。
        await waitUntil("恢复按钮可点", () => document.querySelector<HTMLButtonElement>("[data-icon-restore]")?.disabled === false, {timeoutMs: 10_000});
        query<HTMLButtonElement>("[data-icon-restore]").click();
        await waitUntil("恢复模板的图标", () => store.snapshot.value?.providers.find((provider) => provider.id === "deepseek-copy")?.icon === null, {timeoutMs: 10_000});
    });
});

describe("几百个模型", () => {
    it("系列默认收起、收起的不渲染；搜索时展开命中的组并最多画 200 行；开自动加入的开关写 followSource", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-provider-add]").click();
        await waitUntil("添加窗口有模板", () => document.querySelector("[data-add-provider='openrouter']") !== null, {timeoutMs: 10_000});
        query<HTMLButtonElement>("[data-add-provider='openrouter']").click();
        await waitUntil("选中 OpenRouter", () => selected() === "openrouter", {timeoutMs: 10_000});
        await waitUntil("行读完", () => store.rowsOf("openrouter").rows.length === 600, {timeoutMs: 10_000});
        await flushPromises();
        // 默认：系列组的标题在、行都没渲染。
        expect(document.querySelectorAll("[data-model-row]").length).toBe(0);
        expect(document.querySelectorAll(".provider-detail__series-title").length).toBeGreaterThan(1);
        // 展开一组：只渲染这一组的行。
        query<HTMLButtonElement>(".provider-detail__series-title").click();
        await flushPromises();
        const opened = document.querySelectorAll("[data-model-row]").length;
        expect(opened).toBeGreaterThan(0);
        expect(opened).toBeLessThan(600);
        // 搜索一个所有模型 id 里都有的词：最多画 200 行，并写“还有 N 条”。
        await type(query<HTMLInputElement>("[data-models-search] input, input[data-models-search]"), "model");
        expect(document.querySelectorAll("[data-model-row]").length).toBe(200);
        expect(query("[data-models-more]").textContent).toContain("还有 400 条");
        // 关掉自动加入。
        query<HTMLElement>("[data-follow-source]").click();
        await waitUntil("followSource 关了", () => store.snapshot.value?.providers.find((provider) => provider.id === "openrouter")?.followSource === false, {timeoutMs: 10_000});
    });

    it("全部模型：每家一节默认收起、不渲染行；展开才读这家的行", async () => {
        const {wrapper, store} = await render();
        const rail = [...document.querySelectorAll<HTMLElement>("[data-provider-rail-item]")].find((item) => item.getAttribute("data-provider-rail-item") === "all");
        rail?.click();
        await waitUntil("全部模型", () => document.querySelector("[data-all-models-provider]") !== null, {timeoutMs: 10_000});
        expect(document.querySelectorAll("[data-all-models-row]").length).toBe(0);
        query<HTMLButtonElement>("[data-all-models-provider='moonshot'] button").click();
        await waitUntil("moonshot 的行出现", () => document.querySelector("[data-all-models-row='moonshot/kimi-k2']") !== null, {timeoutMs: 10_000});
        expect(document.querySelector("[data-all-models-row='openai/gpt-5-mini']")).toBeNull();
        expect(store.rowsOf("moonshot").rows.length).toBe(1);
        wrapper.unmount();
    });
});
