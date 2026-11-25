/**
 * “搜索与网页”页（docs/specs/web/settings-page.md 输出 2 到 11）：组件经属性拿数据模块，数据模块建在 Lab 场景同一份远程合同替身上
 * （`fake-remote.ts`）；“使用”经设置场景的局部宿主写（产品里同一个配置实例，用户层在内存里）。页面与服务端的真实来回在
 * `web-tools/search-store.test.ts` 与 `e2e/web-settings.e2e.ts`。
 */

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {createFakeWebRemote} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import type {FakeWebRemoteOptions} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingsService} from "nbook/shared/settings";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {webSettings} from "../../shared/settings";
import {WEB_TEXT_NAMESPACE, webText} from "../../shared/text";
import {webBrowserPlugin} from "../plugin";
import {createSearchStore} from "../search-store";
import type {SearchStore} from "../search-store";
import {webCatalogs} from "../text";
import SearchSettingsPage from "./SearchSettingsPage.vue";

const KEY = "sk-dom-test-not-real-123456";

const {provider: providerSetting} = webSettings.settings;
const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

type Failure = {subject: string; reason: string; uncertain?: boolean};

/** 在给定的数据模块上挂一次页面；同一个数据模块可以挂多次（离开这页再回来）。`input` 这几个取的是 `provider` 那一节的。 */
function mountPage(store: SearchStore, settings: SettingsService, {writable = true, locale = "zh-CN" as DisplayLocale, provider = "deepseek"} = {}) {
    const failures: Failure[] = [];
    const wrapper = mount(SearchSettingsPage, {
        global: {provide: provideText(testTextPort(locale, {[WEB_TEXT_NAMESPACE]: webCatalogs, "nbook.settings": settingsCatalogs}))},
        props: {store, settings, writable, reportWriteFailure: (subject: string, failure: {reason: string; uncertain?: boolean}) => failures.push({subject, ...failure})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    const section = `[data-search-provider="${provider}"]`;
    const input = () => wrapper.get<HTMLInputElement>(`${section} [data-key-input]`);
    const checkButton = () => wrapper.get<HTMLButtonElement>(`${section} [data-search-check]`);
    const result = () => wrapper.get(`${section} [data-search-check-result]`);
    const clear = () => wrapper.find<HTMLButtonElement>(`${section} [data-key-clear]`);
    return {wrapper, failures, input, checkButton, result, clear};
}

function render(options: FakeWebRemoteOptions = {}, page: {writable?: boolean; locale?: DisplayLocale; provider?: "deepseek" | "tavily"; values?: Record<string, unknown>; userUnreachable?: boolean} = {}) {
    const fake = createFakeWebRemote(options);
    const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
    stores.push(store);
    const host = createSettingsHost({settings: [{plugin: "nbook.web", definition: providerSetting}], sections: [], user: {values: page.values ?? {}, unreachable: page.userUnreachable === true}, notify: () => undefined, report: () => undefined});
    stores.push(host);
    const settings = host.service("nbook.web");
    return {fake, store, host, settings, ...mountPage(store, settings, page)};
}

async function type(input: {setValue(value: string): Promise<void>; trigger(event: string, options?: object): Promise<void>}, value: string): Promise<void> {
    await input.setValue(value);
    await input.trigger("keydown", {key: "Enter"});
    await flushPromises();
}

describe("SearchSettingsPage", () => {
    it("读取中：密钥框写“读取中”且停用，检测停用（输出 2）", async () => {
        const {input, checkButton} = render({neverLoads: true});
        await flushPromises();
        expect(input().attributes("placeholder")).toBe("读取中");
        expect(input().element.disabled).toBe(true);
        expect(checkButton().element.disabled).toBe(true);
    });

    it("还没取到状态、或密钥文件读不了时，不说选中的那家没有密钥（输出 11）", async () => {
        const loading = render({neverLoads: true}, {values: {"nbook.web/provider": "tavily"}});
        await flushPromises();
        expect(loading.wrapper.find("[data-search-use-no-key]").exists()).toBe(false);
        const unreadable = render({unreadable: true}, {values: {"nbook.web/provider": "tavily"}});
        await waitUntil("提示", () => unreadable.wrapper.find("[data-search-keys-unreadable]").exists() || undefined, {timeoutMs: 10_000});
        expect(unreadable.wrapper.find("[data-search-use-no-key]").exists()).toBe(false);
        const ready = render({}, {values: {"nbook.web/provider": "tavily"}});
        await waitUntil("取到状态后才说", () => ready.wrapper.find("[data-search-use-no-key]").exists() || undefined, {timeoutMs: 10_000});
    });

    it("填密钥：密码框带标签；回车写入、框清空、显示“已设置”；页面上找不到密钥原文；紧接着失焦不再写（输出 3、10）", async () => {
        const {wrapper, fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        expect(input().attributes("type")).toBe("password");
        expect(input().attributes("autocomplete")).toBe("new-password");
        expect(wrapper.get(`label[for="${input().attributes("id") ?? ""}"]`).text()).toBe("API 密钥");
        await type(input(), `  ${KEY}  `);
        await input().trigger("focusout");
        await flushPromises();
        expect(fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", provider: "deepseek", key: KEY}]);
        expect(input().element.value).toBe("");
        expect(input().attributes("placeholder")).toBe("已设置");
        expect(wrapper.find("[data-key-clear]").exists()).toBe(true);
        expect(document.body.innerHTML).not.toContain(KEY);
        expect([...document.body.querySelectorAll("*")].some((element) => [...element.attributes].some((attribute) => attribute.value.includes(KEY)))).toBe(false);
    });

    it("只失焦也写一次（输出 3）", async () => {
        const {fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await input().setValue(KEY);
        await input().trigger("focusout");
        await flushPromises();
        expect(fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", provider: "deepseek", key: KEY}]);
        expect(input().attributes("placeholder")).toBe("已设置");
    });

    it("env: 写法：原位提示、框标为无效，不写（输出 4）", async () => {
        const {wrapper, fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(input(), "env:DEEPSEEK_API_KEY");
        expect(wrapper.get("[data-key-problem]").text()).toContain("不支持环境变量引用");
        expect(input().attributes("aria-invalid")).toBe("true");
        expect(fake.calls.some((call) => call.method === "setKey")).toBe(false);
    });

    it("清除：按钮名称带服务名；直接写，回到未设置，检测停用（输出 5、10）", async () => {
        const {wrapper, fake, input, checkButton} = render({hasKey: true});
        await waitUntil("已设置", () => wrapper.find("[data-key-clear]").exists() || undefined, {timeoutMs: 10_000});
        expect(wrapper.get("[data-key-clear]").attributes("aria-label")).toBe("清除 DeepSeek 的密钥");
        await wrapper.get("[data-key-clear]").trigger("click");
        await flushPromises();
        expect(fake.calls.some((call) => call.method === "clearKey")).toBe(true);
        expect(input().attributes("placeholder")).toBe("还没有填写");
        expect(checkButton().element.disabled).toBe(true);
    });

    it("写失败：交给窗口通知，原因后写“请重新输入”；结果未知时标为不确定（输出 6）", async () => {
        const failed = render();
        failed.fake.failWrites("credentials-unavailable");
        await waitUntil("状态到了", () => failed.input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(failed.input(), KEY);
        expect(failed.failures).toEqual([{subject: "DeepSeek 的 API 密钥", reason: "密钥文件读写失败；请重新输入", uncertain: false}]);

        const unknown = render();
        unknown.fake.failWrites("unknown-outcome");
        await waitUntil("状态到了", () => unknown.input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(unknown.input(), KEY);
        expect(unknown.failures).toEqual([{subject: "DeepSeek 的 API 密钥", reason: "可能没有保存，以页面上显示的为准；请重新输入", uncertain: true}]);

        const english = render({}, {locale: "en-US"});
        english.fake.failWrites("credentials-unavailable");
        await waitUntil("状态到了", () => english.input().attributes("placeholder") === "Not entered yet" || undefined, {timeoutMs: 10_000});
        await type(english.input(), KEY);
        expect(english.failures).toEqual([{subject: "DeepSeek API key", reason: "The key file couldn't be read or written. Please enter it again.", uncertain: false}]);
    });

    it("只读：网页工具没运行时写一句说明、控件停用；writable 为假时控件停用（输出 7）", async () => {
        const readonly = render({unavailable: true});
        await waitUntil("只读", () => readonly.wrapper.find("[data-search-readonly]").exists() || undefined, {timeoutMs: 10_000});
        expect(readonly.wrapper.get("[data-search-readonly]").text()).toBe("网页工具没有运行，这一页暂时不能修改。");
        expect(readonly.input().element.disabled).toBe(true);
        expect(readonly.checkButton().element.disabled).toBe(true);
        // 没取到状态：不说“未设置”（输出 2）；原因写在顶上。
        expect(readonly.input().attributes("placeholder")).toBe("读取中");

        const locked = render({hasKey: true}, {writable: false});
        await waitUntil("已设置", () => locked.input().attributes("placeholder") === "已设置" || undefined, {timeoutMs: 10_000});
        expect(locked.input().element.disabled).toBe(true);
        expect(locked.checkButton().element.disabled).toBe(true);
        expect(locked.wrapper.get<HTMLButtonElement>("[data-key-clear]").element.disabled).toBe(true);
    });

    it("密钥文件读不了：顶上写一句，密钥框按未设置画、照常可写（输出 2、7）", async () => {
        const {wrapper, input} = render({unreadable: true});
        await waitUntil("提示", () => wrapper.find("[data-search-keys-unreadable]").exists() || undefined, {timeoutMs: 10_000});
        expect(wrapper.get("[data-search-keys-unreadable]").text()).toBe("密钥文件读不了。在下面重新填写密钥会覆盖它。");
        expect(input().element.disabled).toBe(false);
        expect(input().attributes("placeholder")).toBe("还没有填写");
    });

    it("检测：进行中显示“检测中”并停用；通过带时间；失败按码写原因；没检成写远程失败（输出 8、10）", async () => {
        const running = render({hasKey: true, check: "hang"});
        await waitUntil("已设置", () => !running.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        expect(running.checkButton().attributes("aria-label")).toBe("检测 DeepSeek 的密钥");
        await running.checkButton().trigger("click");
        await flushPromises();
        expect(running.checkButton().text()).toBe("检测中");
        expect(running.checkButton().element.disabled).toBe(true);
        // 按钮停用后读屏读不到它的新文字，进行中由结果区（role="status"）播报。
        expect(running.result().text()).toBe("检测中");

        const passed = render({hasKey: true});
        await waitUntil("已设置", () => !passed.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await passed.checkButton().trigger("click");
        await waitUntil("通过", () => passed.wrapper.get("[data-search-check-result]").text().startsWith("检测通过") || undefined);
        expect(passed.wrapper.get("[data-search-check-result]").attributes("role")).toBe("status");

        const failed = render({hasKey: true, check: {ok: false, code: "auth", detail: "bad"}});
        await waitUntil("已设置", () => !failed.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        expect(failed.wrapper.text()).toContain("会发一次搜索，按次计费。");
        await failed.checkButton().trigger("click");
        await waitUntil("失败", () => failed.wrapper.get("[data-search-check-result]").text() === "检测没通过：DeepSeek 不认这把密钥" || undefined);
        // 失败了可以再点。
        expect(failed.checkButton().element.disabled).toBe(false);

        const notRun = render({hasKey: true, check: "unknown"});
        await waitUntil("已设置", () => !notRun.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await notRun.checkButton().trigger("click");
        await waitUntil("没检成", () => notRun.result().text() !== "" || undefined);
        // 检测不保存东西，结果未知时不借写入的说法。
        expect(notRun.result().text()).toBe("没检成：连接断了，不确定检测有没有发出去");

        const gone = render({hasKey: true, check: "unavailable"});
        await waitUntil("已设置", () => !gone.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await gone.checkButton().trigger("click");
        await waitUntil("没检成", () => gone.result().text() !== "" || undefined);
        expect(gone.result().text()).toBe("没检成：网页工具没有运行");
    });

    it("第一次填写：框里有输入时“检测”就能点；失焦写入后紧接着点，检测排在写入后面（输出 8）", async () => {
        const {fake, input, checkButton} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        expect(checkButton().element.disabled).toBe(true);
        await input().setValue(KEY);
        expect(checkButton().element.disabled).toBe(false);
        await input().setValue("env:DEEPSEEK_API_KEY");
        expect(checkButton().element.disabled).toBe(true);
        await input().setValue(KEY);
        // 按下按钮时框先失焦写入。
        await input().trigger("focusout");
        await checkButton().trigger("click");
        await waitUntil("检测结束", () => fake.calls.some((call) => call.method === "check") || undefined);
        expect(fake.calls.filter((call) => call.method !== "status")).toEqual([{method: "setKey", provider: "deepseek", key: KEY}, {method: "check", provider: "deepseek", key: KEY}]);
    });

    it("离开这页再回来：进行中的检测与结果还在（输出 8）", async () => {
        const first = render({hasKey: true, check: "hang"});
        await waitUntil("已设置", () => !first.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await first.checkButton().trigger("click");
        await flushPromises();
        first.wrapper.unmount();
        mounted.splice(mounted.indexOf(first.wrapper), 1);

        const again = mountPage(first.store, first.settings);
        await flushPromises();
        expect(again.checkButton().text()).toBe("检测中");
        expect(again.checkButton().element.disabled).toBe(true);

        const done = render({hasKey: true});
        await waitUntil("已设置", () => !done.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await done.checkButton().trigger("click");
        await waitUntil("通过", () => done.result().text().startsWith("检测通过") || undefined);
        done.wrapper.unmount();
        mounted.splice(mounted.indexOf(done.wrapper), 1);
        expect(mountPage(done.store, done.settings).result().text()).toBe("检测通过（08:30:00）");
    });

    it("说明经 aria-describedby 关联到密钥框（输出 9、10）", async () => {
        const {wrapper, input} = render();
        await flushPromises();
        const ids = (input().attributes("aria-describedby") ?? "").split(" ");
        const note = ids.map((id) => wrapper.element.querySelector(`[id="${id}"]`)).find((element) => element !== null);
        expect(note?.textContent).toContain("与模型设置里的 DeepSeek 密钥分开存放");
    });

    it("使用：缺省选中 DeepSeek；点 Tavily 写进用户层；选中的那家没有密钥时下面写一句；写失败交窗口通知、单选回到写前那家（输出 1、11）", async () => {
        const {wrapper, settings, host, failures} = render({hasKey: true});
        await waitUntil("状态到了", () => wrapper.find('[data-search-provider="deepseek"] [data-key-clear]').exists() || undefined, {timeoutMs: 10_000});
        const group = () => wrapper.get("[data-search-use]");
        const option = (value: string) => wrapper.get<HTMLButtonElement>(`[data-search-use] [data-value="${value}"]`);
        expect(group().attributes("role")).toBe("radiogroup");
        expect(group().attributes("aria-label")).toBe("使用");
        expect(option("deepseek").attributes("aria-checked")).toBe("true");
        // 两节依次是 DeepSeek、Tavily（输出 1）。
        expect(wrapper.findAll("[data-search-provider]").map((section) => section.attributes("data-search-provider"))).toEqual(["deepseek", "tavily"]);
        expect(wrapper.find("[data-search-use-no-key]").exists()).toBe(false);

        const hint = () => wrapper.find("[data-search-use-no-key]");
        const announced = () => wrapper.get('[data-search-settings] [role="status"].sr-only').text();
        await option("tavily").trigger("click");
        await waitUntil("写进去了", () => settings.get(providerSetting) === "tavily" || undefined);
        expect(settings.inspect(providerSetting).user).toMatchObject({value: "tavily"});
        await waitUntil("提示", () => hint().exists() || undefined);
        expect(hint().text()).toBe("Tavily 还没有密钥");
        expect(option("tavily").attributes("aria-checked")).toBe("true");
        // 提示是单选组的说明，改选之后也经播报区念出来（输出 10）。
        expect((group().attributes("aria-describedby") ?? "").split(" ")).toContain(hint().attributes("id"));
        expect(announced()).toBe("Tavily 还没有密钥");

        // 改选有密钥的那家，提示收起。
        await option("deepseek").trigger("click");
        await waitUntil("提示收起", () => !hint().exists() || undefined);
        expect(announced()).toBe("");
        await option("tavily").trigger("click");
        await waitUntil("又选了 Tavily", () => hint().exists() || undefined);

        // 写失败：原因用设置窗口同一套说法；结果未知时标为不确定；设置行自己的“恢复默认”失败同样通知。
        host.user.failWrites("write-failed");
        await option("deepseek").trigger("click");
        await waitUntil("通知", () => failures.length > 0 || undefined);
        expect(failures[0]).toMatchObject({subject: "使用", uncertain: false});
        expect(failures[0]!.reason).toMatch(/^写不进设置文件/u);
        expect(settings.get(providerSetting)).toBe("tavily");
        expect(option("tavily").attributes("aria-checked")).toBe("true");
        host.user.failWrites("unknown-outcome");
        await option("deepseek").trigger("click");
        await waitUntil("第二条通知", () => failures.length > 1 || undefined);
        expect(failures[1]).toEqual({subject: "使用", reason: "可能没有保存，以设置文件为准", uncertain: true});
        host.user.failWrites("write-failed");
        await wrapper.get("[data-settings-row-reset]").trigger("click");
        await waitUntil("恢复默认的通知", () => failures.length > 2 || undefined);
        expect(failures[2]).toMatchObject({subject: "使用", uncertain: false});
    });

    it("使用：网页工具没运行、writable 为假时停用（输出 11）", async () => {
        const readonly = render({unavailable: true});
        await waitUntil("只读", () => readonly.wrapper.find("[data-search-readonly]").exists() || undefined, {timeoutMs: 10_000});
        expect(readonly.wrapper.get("[data-search-use]").attributes("aria-disabled")).toBe("true");
        const locked = render({hasKey: true}, {writable: false});
        await flushPromises();
        expect(locked.wrapper.get("[data-search-use]").attributes("aria-disabled")).toBe("true");
        // 用户层不可写（例如设置服务连不上）：设置行自己停用。
        const unreachable = render({hasKey: true}, {userUnreachable: true});
        await waitUntil("已设置", () => unreachable.wrapper.find('[data-search-provider="deepseek"] [data-key-clear]').exists() || undefined, {timeoutMs: 10_000});
        expect(unreachable.wrapper.get("[data-search-use]").attributes("aria-disabled")).toBe("true");
        const usable = render({hasKey: true});
        await waitUntil("已设置", () => usable.wrapper.find('[data-search-provider="deepseek"] [data-key-clear]').exists() || undefined, {timeoutMs: 10_000});
        expect(usable.wrapper.get("[data-search-use]").attributes("aria-disabled")).toBeUndefined();
    });

    it("Tavily 一节：写的、清的、检测的都是 tavily；名称与失败原因带 Tavily（输出 3、5、8、9、10）", async () => {
        const {wrapper, fake, input, checkButton, result, clear} = render({check: {ok: false, code: "quota"}}, {provider: "tavily"});
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        // 草稿按家分开：在一家的框里输入，只让这一家的“检测”可点（输出 8）。
        const deepseekInput = wrapper.get<HTMLInputElement>('[data-search-provider="deepseek"] [data-key-input]');
        const deepseekCheck = () => wrapper.get<HTMLButtonElement>('[data-search-provider="deepseek"] [data-search-check]');
        await deepseekInput.setValue(KEY);
        expect(deepseekCheck().element.disabled).toBe(false);
        expect(checkButton().element.disabled).toBe(true);
        await deepseekInput.setValue("");
        await input().setValue("tvly-dom-test-not-real-123456");
        expect(checkButton().element.disabled).toBe(false);
        expect(deepseekCheck().element.disabled).toBe(true);
        await type(input(), "tvly-dom-test-not-real-123456");
        expect(fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", provider: "tavily", key: "tvly-dom-test-not-real-123456"}]);
        expect(checkButton().attributes("aria-label")).toBe("检测 Tavily 的密钥");
        await checkButton().trigger("click");
        await waitUntil("失败", () => result().text() !== "" || undefined);
        expect(result().text()).toBe("检测没通过：Tavily 的余额或额度不够了");
        expect(fake.calls.at(-1)).toMatchObject({method: "check", provider: "tavily"});
        const ids = (input().attributes("aria-describedby") ?? "").split(" ");
        expect(ids.map((id) => wrapper.element.querySelector(`[id="${id}"]`)?.textContent).filter((text) => text !== undefined)).toContain("这把密钥只给搜索与读网页用。");
        expect(clear().attributes("aria-label")).toBe("清除 Tavily 的密钥");
        await clear().trigger("click");
        await flushPromises();
        expect(fake.calls.at(-1)).toEqual({method: "clearKey", provider: "tavily"});
        // DeepSeek 一节没动。
        expect(wrapper.get<HTMLInputElement>('[data-search-provider="deepseek"] [data-key-input]').attributes("placeholder")).toBe("还没有填写");
    });

    it("两节互不影响：一家检测中时另一家照常可点；一家写失败的主语是它自己（输出 6、8）", async () => {
        const {wrapper, checkButton} = render({hasKey: true, hasTavilyKey: true, check: "hang"});
        const tavilyCheck = () => wrapper.get<HTMLButtonElement>('[data-search-provider="tavily"] [data-search-check]');
        await waitUntil("都已设置", () => (!checkButton().element.disabled && !tavilyCheck().element.disabled) || undefined, {timeoutMs: 10_000});
        await checkButton().trigger("click");
        await flushPromises();
        expect(checkButton().text()).toBe("检测中");
        expect(tavilyCheck().text()).toBe("检测");
        expect(tavilyCheck().element.disabled).toBe(false);

        const failing = render({}, {provider: "tavily"});
        failing.fake.failWrites("credentials-unavailable");
        await waitUntil("状态到了", () => failing.input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(failing.input(), "tvly-dom-test-not-real-123456");
        expect(failing.failures).toEqual([{subject: "Tavily 的 API 密钥", reason: "密钥文件读写失败；请重新输入", uncertain: false}]);
    });

    it("页面声明：设置窗口里按 DeepSeek 或 Tavily 都搜得到这一页（“输入与前置条件”）", () => {
        const declaration = webBrowserPlugin.entries[0]!.contributions?.[0]?.declaration as {keywords?: unknown[]} | undefined;
        expect(declaration?.keywords).toEqual(expect.arrayContaining([webText("keywords.deepseek"), webText("keywords.tavily")]));
    });
});
