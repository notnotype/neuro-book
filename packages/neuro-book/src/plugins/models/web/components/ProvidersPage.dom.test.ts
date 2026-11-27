/**
 * “服务商与模型”页的模板化交互（docs/specs/models/settings-pages.md 输出 3、4、6 到 11）：按模板添加、标题区改名与复制与换图标、
 * 几百个模型时系列默认收起且不渲染、搜索最多 200 行、全部模型按服务商收起。数据经 Lab 场景同一份假远端（`fake-remote.ts`，走 JSON 编解码）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {Select} from "@notnotype/nb-ui/components";

import {createFakeModelsRemote} from "nbook/plugins/models/web/lab/fake-remote";
import {generatedRows, SAMPLE_ROWS, SAMPLE_SNAPSHOT, sampleRow} from "nbook/plugins/models/web/lab/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {checkKey, createModelsStore} from "../models-store";
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

async function render(options: Parameters<typeof createFakeModelsRemote>[1] = {}) {
    const fake = createFakeModelsRemote(SAMPLE_SNAPSHOT, options);
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
        expect(query("[data-add-provider='zai']").textContent).toContain("已添加");
    });
});

describe("标题区", () => {
    it("改名：回车提交；重名在输入框下写原因、不发；空名回退；点名称也能改、组字时的回车不提交、Esc 取消并还焦点给铅笔", async () => {
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
        // 点名称也能改；输入法组字时的回车不提交；Esc 取消，焦点回到铅笔。
        query<HTMLElement>("[data-provider-name]").click();
        await flushPromises();
        await type(input(), "组字中");
        input().dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true, isComposing: true}));
        await flushPromises();
        expect(document.querySelector("[data-provider-name-input]")).not.toBeNull();
        input().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await waitUntil("焦点回到铅笔", () => document.activeElement?.matches("[data-provider-rename]") === true, {timeoutMs: 5_000});
        expect(document.querySelector("[data-provider-name-input]")).toBeNull();
        expect(query("[data-provider-name]").textContent).toBe("深度求索");
        expect(store.snapshot.value?.providers[0]?.name).toBe("深度求索");
    });

    it("复制一份：选中副本、焦点到名称、名称加 2；换内置图标与恢复模板的图标", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-provider-duplicate]").click();
        await waitUntil("选中副本", () => selected() === "deepseek-copy", {timeoutMs: 10_000});
        await waitUntil("焦点在副本的名称上", () => document.activeElement?.matches("[data-provider-name]") === true && document.activeElement.textContent === "DeepSeek 2", {timeoutMs: 10_000});
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

describe("模型来源（service.md“模型来源”）", () => {
    it("重新拉取：写正在拉取（按钮不停用），列表到了写更新时间；管理模型里类型不明的单独一组，加入没有窗口的先停用", async () => {
        const {store} = await render();
        query<HTMLElement>("[data-provider-rail-item='volcengine']").click();
        await waitUntil("选中火山方舟", () => selected() === "volcengine", {timeoutMs: 10_000});
        expect(query("[data-source-status]").textContent).toContain("还没有拉到服务商的模型列表");
        // 空白模板也有“自动加入”开关。
        expect(document.querySelector("[data-follow-source]")).not.toBeNull();
        query<HTMLButtonElement>("[data-source-refresh]").click();
        // 假远端受理时同步标上在拉取，下一轮事件循环才交回列表：等到这一轮的渲染就看得到中间状态。
        await flushPromises();
        expect(query("[data-source-status]").textContent).toContain("正在拉取");
        // 拉取进行中不停用（再点与在途的合并），焦点不会掉到页面上。
        expect(query<HTMLButtonElement>("[data-source-refresh]").disabled).toBe(false);
        await waitUntil("列表到了", () => query("[data-source-status]").textContent?.includes("更新于") === true, {timeoutMs: 10_000});
        expect(query<HTMLButtonElement>("[data-source-refresh]").disabled).toBe(false);

        query<HTMLButtonElement>("[data-models-manage]").click();
        await waitUntil("管理模型列出候选", () => document.querySelector("[data-manage-item='house-router']") !== null, {timeoutMs: 10_000});
        const unknown = query("[data-manage-group='unknown']");
        expect(unknown.textContent).toContain("类型不明");
        expect(unknown.querySelector("[data-manage-item='house-router']")).not.toBeNull();
        expect(unknown.querySelector("[data-manage-item='doubao-seed-2-0-mini']")).toBeNull();
        query<HTMLButtonElement>("[data-manage-item='house-router'] [data-manage-toggle]").click();
        await flushPromises();
        [...document.querySelectorAll<HTMLButtonElement>("[data-manage-models-dialog] button")].find((button) => button.textContent?.trim() === "完成")!.click();
        await waitUntil("加入了", () => store.rowsOf("volcengine").rows.some((row) => row.id === "house-router"), {timeoutMs: 10_000});
        expect(store.rowsOf("volcengine").rows.find((row) => row.id === "house-router")?.enabled).toBe(false);
    });

    it("没有密钥时“重新拉取”停用", async () => {
        await render();
        query<HTMLElement>("[data-provider-rail-item='openai']").click();
        await waitUntil("选中 OpenAI", () => selected() === "openai", {timeoutMs: 10_000});
        expect(query<HTMLButtonElement>("[data-source-refresh]").disabled).toBe(true);
        // 停用的原因写成看得见的字（停用的按钮聚焦不了，悬停提示读屏读不到）。
        expect(query("[data-source-needs-key]").textContent).toContain("先填密钥");
        expect(query("[data-source-status]").textContent).toContain("用内置的模型目录");
    });
});

describe("协议检测（输出 21）", () => {
    it("地址框里改了地址直接点检测：先写地址再检测、焦点留在按钮上；四行结果，当前的“正在用”，点“用这个”后跟着换；之后换了密钥整块置灰、不能再采纳；换服务商时结果不留", async () => {
        // 写入要过一会儿才生效：页面不等写完就检测时，检测读到的是旧地址。
        const {store} = await render({slowWrites: true});
        const relay = "https://relay.example.com/v1";
        const url = query<HTMLInputElement>("[data-url-input] input, input[data-url-input]");
        await type(url, relay);
        // 鼠标点按钮：地址框先失焦（交出草稿），再点击。
        url.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        const start = query<HTMLButtonElement>("[data-api-detect-start]");
        start.focus();
        start.click();
        await flushPromises();
        // 同一个按钮换成“取消协议检测”，焦点没有掉。
        expect(document.activeElement).toBe(start);
        expect(start.hasAttribute("data-api-detect-cancel")).toBe(true);
        expect(start.textContent).toContain("取消协议检测");
        await waitUntil("结果出来", () => document.querySelectorAll("[data-api-detect-row]").length === 4, {timeoutMs: 10_000});
        expect(query("[data-api-detect-announce]").textContent).toBe("检测完成：2 种协议能用");
        // 检测读到的是新地址：草稿先写进去了。
        expect(store.snapshot.value?.providers[0]?.baseUrl).toBe(relay);
        expect(query("[data-api-detect-row='openai-completions']").textContent).toContain(`${relay}/chat/completions`);
        expect(query("[data-api-detect-row='openai-completions'] [data-api-detect-using]")).not.toBeNull();
        expect(query("[data-api-detect-row='anthropic-messages']").textContent).toContain("HTTP 404");
        expect(document.querySelector("[data-api-detect-row='anthropic-messages'] [data-api-detect-adopt]")).toBeNull();
        expect(document.querySelector("[data-api-detect-row='anthropic-messages'] [data-api-detect-copy]")).not.toBeNull();

        query<HTMLButtonElement>("[data-api-detect-row='openai-responses'] [data-api-detect-adopt]").click();
        await waitUntil("协议改了", () => store.snapshot.value?.providers[0]?.api === "openai-responses", {timeoutMs: 10_000});
        await flushPromises();
        expect(query("[data-api-detect-row='openai-responses'] [data-api-detect-using]")).not.toBeNull();
        expect(document.querySelector("[data-api-detect-stale]")).toBeNull();

        await store.call("clearKey", {provider: "deepseek"});
        await waitUntil("整块置灰", () => document.querySelector("[data-api-detect-stale]") !== null, {timeoutMs: 10_000});
        expect(query<HTMLButtonElement>("[data-api-detect-row='openai-completions'] [data-api-detect-adopt]").disabled).toBe(true);
        // 没有密钥了：检测按钮停用，原因写成看得见的字。
        expect(query<HTMLButtonElement>("[data-api-detect-start]").disabled).toBe(true);
        expect(query("[data-api-detect-needs-key]").textContent).toContain("先填密钥");

        query<HTMLElement>("[data-provider-rail-item='volcengine']").click();
        await waitUntil("选中火山方舟", () => selected() === "volcengine", {timeoutMs: 10_000});
        expect(document.querySelector("[data-api-detect]")).toBeNull();
    });

    it("密钥框里换了密钥直接点检测：等密钥写完再检测，结果对得上新密钥（不置灰）", async () => {
        const {store} = await render({slowWrites: true});
        const before = store.snapshot.value?.providers[0]?.connection;
        const key = query<HTMLInputElement>("[data-key-input] input, input[data-key-input]");
        await type(key, "sk-new-key-0123456789");
        key.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        query<HTMLButtonElement>("[data-api-detect-start]").click();
        await waitUntil("结果出来", () => document.querySelectorAll("[data-api-detect-row]").length === 4, {timeoutMs: 10_000});
        // 新密钥写进去了（连接版本变了）之后再看：检测用的是它，结果不置灰。
        await waitUntil("密钥写完", () => store.snapshot.value?.providers[0]?.connection !== before, {timeoutMs: 10_000});
        await flushPromises();
        expect(document.querySelector("[data-api-detect-stale]")).toBeNull();
        expect(query("[data-api-detect-row='openai-completions'] [data-api-detect-using]")).not.toBeNull();
    });

    it("地址框里的草稿不合格：不检测，焦点回到地址框", async () => {
        await render();
        const input = query<HTMLInputElement>("[data-url-input] input, input[data-url-input]");
        await type(input, "not a url");
        query<HTMLButtonElement>("[data-api-detect-start]").click();
        await flushPromises();
        expect(document.querySelector("[data-url-problem]")).not.toBeNull();
        expect(document.querySelector("[data-api-detect]")).toBeNull();
        expect(document.activeElement).toBe(input);
    });
});

describe("检测全部", () => {
    it("超过 20 个先确认个数，确认后检测的正是这一份、进度写已检几个，取消则什么都不发、焦点回到按钮", async () => {
        const many = generatedRows(25);
        const {store} = await render({rows: {...SAMPLE_ROWS, deepseek: many}, slowWrites: true});
        await waitUntil("模型行读到", () => store.rowsOf("deepseek").rows.length === 25, {timeoutMs: 10_000});

        query<HTMLButtonElement>("[data-models-check-all]").click();
        await waitUntil("确认对话框", () => document.querySelector("[role='alertdialog']") !== null, {timeoutMs: 10_000});
        expect(query("[role='alertdialog']").textContent).toContain("检测DeepSeek的 25 个模型？");
        expect(query("[role='alertdialog']").textContent).toContain("同时检测 4 个");
        const button = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")].find((item) => item.textContent?.trim() === label)!;
        button("取消").click();
        await waitUntil("对话框关上、焦点回到按钮", () => document.querySelector("[role='alertdialog']") === null && document.activeElement?.hasAttribute("data-models-check-all") === true, {timeoutMs: 10_000});
        expect(many.some((row) => store.checks.has(checkKey("deepseek", row.id)))).toBe(false);

        query<HTMLButtonElement>("[data-models-check-all]").click();
        await waitUntil("确认对话框", () => document.querySelector("[role='alertdialog']") !== null, {timeoutMs: 10_000});
        button("检测").click();
        await waitUntil("进度写已检几个", () => /^已检 [1-9]\d* \/ 共 25$/u.test(document.querySelector("[data-models-check-progress]")?.textContent?.trim() ?? ""), {timeoutMs: 10_000});
        expect(query("[data-models-check-announce]").textContent).toBe("正在检测 25 个模型");
        await waitUntil("全部检完", () => many.every((row) => store.checks.get(checkKey("deepseek", row.id))?.status === "done"), {timeoutMs: 10_000});
        expect(store.checkRuns.has("deepseek")).toBe(false);
        await flushPromises();
        expect(document.querySelector("[data-models-check-progress]")).toBeNull();
        expect(query("[data-models-check-announce]").textContent).toBe("检测全部已结束");
    });

    it("20 个以内不确认，直接检测（并发、进度与取消由 models-store.test.ts 对真实服务验）", async () => {
        const {store} = await render();
        query<HTMLButtonElement>("[data-models-check-all]").click();
        await waitUntil("两个都检完", () => store.checks.get(checkKey("deepseek", "deepseek-flash"))?.status === "done" && store.checks.get(checkKey("deepseek", "deepseek-pro"))?.status === "done", {timeoutMs: 10_000});
        expect(document.querySelector("[role='alertdialog']")).toBeNull();
    });
});

describe("服务商的代理（高级）", () => {
    const proxyOf = (store: Awaited<ReturnType<typeof render>>["store"]) => store.snapshot.value?.providers.find((item) => item.id === selected())?.proxy;
    async function openAdvanced(wrapper: Awaited<ReturnType<typeof render>>["wrapper"]) {
        query<HTMLButtonElement>("[data-provider-advanced]").click();
        await flushPromises();
        const select = wrapper.findAllComponents(Select).find((item) => (item.vm.$attrs as Record<string, unknown>)["data-proxy-select"] !== undefined);
        if (select === undefined) throw new Error("没有代理下拉");
        return select;
    }

    it("选直连写进去；选自定义先停在自定义、地址框出现并拿到焦点，不合规的原位写原因不写，合规的回车写进去；选跟随应用清掉", async () => {
        const {wrapper, store} = await render();
        const select = await openAdvanced(wrapper);
        select.vm.$emit("update:modelValue", "direct");
        await waitUntil("写进直连", () => proxyOf(store)?.mode === "direct");
        select.vm.$emit("update:modelValue", "custom");
        await waitUntil("地址框出现", () => document.querySelector("[data-proxy-input]") !== null);
        const input = query<HTMLInputElement>("[data-proxy-input] input, input[data-proxy-input]");
        await waitUntil("焦点进地址框", () => document.activeElement === input);
        expect(proxyOf(store)?.mode).toBe("direct");
        await type(input, "socks5://127.0.0.1:1080");
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(query("[data-proxy-problem]").getAttribute("role")).toBe("alert");
        expect(proxyOf(store)?.mode).toBe("direct");
        await type(input, "http://127.0.0.1:7890");
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("写进自定义", () => proxyOf(store)?.mode === "custom");
        expect(proxyOf(store)).toEqual({mode: "custom", url: "http://127.0.0.1:7890"});

        // 清空已保存的地址再失焦：框里换回实际的地址，生效的不变。先离开再回来，免得走的是“编辑时别处改了”的那条路。
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        await type(input, "");
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(input.value).toBe("http://127.0.0.1:7890");
        expect(proxyOf(store)).toEqual({mode: "custom", url: "http://127.0.0.1:7890"});

        select.vm.$emit("update:modelValue", "app");
        await waitUntil("跟随应用", () => proxyOf(store) === null);
    });

    it("写失败：框里不留没保存的地址，也不停在没写进去的“自定义”", async () => {
        const fake = createFakeModelsRemote(SAMPLE_SNAPSHOT);
        const store = createModelsStore(fake.remote);
        stores.push(store);
        const wrapper = mount(ProvidersPage, {global, props: {store, writable: true, reportWriteFailure: () => undefined}, attachTo: document.body});
        mounted.push(wrapper);
        await waitUntil("服务商详情", () => document.querySelector("[data-provider-detail]") !== null, {timeoutMs: 10_000});
        const select = await openAdvanced(wrapper);
        select.vm.$emit("update:modelValue", "custom");
        await flushPromises();
        await flushPromises();
        fake.failWrites(true);
        const input = query<HTMLInputElement>("[data-proxy-input] input, input[data-proxy-input]");
        await type(input, "http://127.0.0.1:7890");
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("代理地址框收起", () => document.querySelector("[data-proxy-input]") === null);
        expect(proxyOf(store)).toBeNull();

        // 已保存了自定义地址，再改一个新的写失败：框里退回已保存的地址。
        fake.failWrites(false);
        select.vm.$emit("update:modelValue", "custom");
        await waitUntil("地址框出现", () => document.querySelector("[data-proxy-input]") !== null);
        const saved = query<HTMLInputElement>("[data-proxy-input] input, input[data-proxy-input]");
        await type(saved, "http://127.0.0.1:7890");
        saved.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("写进自定义", () => proxyOf(store)?.mode === "custom");
        saved.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        fake.failWrites(true);
        saved.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        await type(saved, "http://10.0.0.1:3128");
        saved.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await waitUntil("退回已保存的地址", () => saved.value === "http://127.0.0.1:7890");
        expect(proxyOf(store)).toEqual({mode: "custom", url: "http://127.0.0.1:7890"});
    });
});

describe("列表里没有的已配置模型（决定 30）", () => {
    it("行上标“列表里没有”，照常可用", async () => {
        const rows = {...SAMPLE_ROWS, deepseek: [...SAMPLE_ROWS.deepseek!, sampleRow("deepseek-v4-flash", {name: "DeepSeek V4 Flash", unlisted: true})]};
        await render({rows});
        await waitUntil("行出来", () => document.querySelector("[data-model-row='deepseek-v4-flash']") !== null);
        expect(query("[data-model-row='deepseek-v4-flash'] [data-model-unlisted]").textContent?.trim()).toBe("列表里没有");
        expect(document.querySelectorAll("[data-model-unlisted]")).toHaveLength(1);
    });
});
