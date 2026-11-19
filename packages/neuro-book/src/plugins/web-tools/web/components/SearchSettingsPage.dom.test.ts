/**
 * “搜索与网页”页（docs/specs/web/settings-page.md 输出 2 到 10）：组件经属性拿数据模块，数据模块建在 Lab 场景同一份远程合同替身上
 * （`fake-remote.ts`）。页面与服务端的真实来回在 `web-tools/search-store.test.ts` 与 `e2e/web-settings.e2e.ts`。
 */

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeWebRemote} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import type {FakeWebRemoteOptions} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {WEB_TEXT_NAMESPACE} from "../../shared/text";
import {createSearchStore} from "../search-store";
import type {SearchStore} from "../search-store";
import {webCatalogs} from "../text";
import SearchSettingsPage from "./SearchSettingsPage.vue";

const KEY = "sk-dom-test-not-real-123456";

const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

type Failure = {subject: string; reason: string; uncertain?: boolean};

/** 在给定的数据模块上挂一次页面；同一个数据模块可以挂多次（离开这页再回来）。 */
function mountPage(store: SearchStore, {writable = true, locale = "zh-CN" as DisplayLocale} = {}) {
    const failures: Failure[] = [];
    const wrapper = mount(SearchSettingsPage, {
        global: {provide: provideText(testTextPort(locale, {[WEB_TEXT_NAMESPACE]: webCatalogs}))},
        props: {store, writable, reportWriteFailure: (subject: string, failure: {reason: string; uncertain?: boolean}) => failures.push({subject, ...failure})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    const input = () => wrapper.get<HTMLInputElement>("[data-key-input]");
    const checkButton = () => wrapper.get<HTMLButtonElement>("[data-search-check]");
    const result = () => wrapper.get("[data-search-check-result]");
    return {wrapper, failures, input, checkButton, result};
}

function render(options: FakeWebRemoteOptions = {}, page: {writable?: boolean; locale?: DisplayLocale} = {}) {
    const fake = createFakeWebRemote(options);
    const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
    stores.push(store);
    return {fake, store, ...mountPage(store, page)};
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

    it("填密钥：密码框带标签；回车写入、框清空、显示“已设置”；页面上找不到密钥原文；紧接着失焦不再写（输出 3、10）", async () => {
        const {wrapper, fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        expect(input().attributes("type")).toBe("password");
        expect(input().attributes("autocomplete")).toBe("new-password");
        expect(wrapper.get(`label[for="${input().attributes("id") ?? ""}"]`).text()).toBe("API 密钥");
        await type(input(), `  ${KEY}  `);
        await input().trigger("focusout");
        await flushPromises();
        expect(fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", key: KEY}]);
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
        expect(fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", key: KEY}]);
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
        expect(readonly.input().element.disabled).toBe(true);
        // 没取到状态：不说“未设置”（输出 2）。
        expect(readonly.input().attributes("placeholder")).toBe("读取中");

        const locked = render({hasKey: true}, {writable: false});
        await waitUntil("已设置", () => locked.input().attributes("placeholder") === "已设置" || undefined, {timeoutMs: 10_000});
        expect(locked.input().element.disabled).toBe(true);
        expect(locked.checkButton().element.disabled).toBe(true);
    });

    it("密钥文件读不了：顶上写一句，密钥框按未设置画、照常可写（输出 2、7）", async () => {
        const {wrapper, input} = render({unreadable: true});
        await waitUntil("提示", () => wrapper.find("[data-search-keys-unreadable]").exists() || undefined, {timeoutMs: 10_000});
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
        await failed.checkButton().trigger("click");
        await waitUntil("失败", () => failed.wrapper.get("[data-search-check-result]").text() === "检测没通过：DeepSeek 不认这把密钥" || undefined);

        const notRun = render({hasKey: true, check: "unknown"});
        await waitUntil("已设置", () => !notRun.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await notRun.checkButton().trigger("click");
        await waitUntil("没检成", () => notRun.result().text() !== "" || undefined);
        // 检测不保存东西，结果未知时不借写入的说法。
        expect(notRun.result().text()).toBe("没检成：连接断了，不确定检测有没有发出去");
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
        expect(fake.calls.filter((call) => call.method !== "status")).toEqual([{method: "setKey", key: KEY}, {method: "check", key: KEY}]);
    });

    it("离开这页再回来：进行中的检测与结果还在（输出 8）", async () => {
        const first = render({hasKey: true, check: "hang"});
        await waitUntil("已设置", () => !first.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await first.checkButton().trigger("click");
        await flushPromises();
        first.wrapper.unmount();
        mounted.splice(mounted.indexOf(first.wrapper), 1);

        const again = mountPage(first.store);
        await flushPromises();
        expect(again.checkButton().text()).toBe("检测中");
        expect(again.checkButton().element.disabled).toBe(true);

        const done = render({hasKey: true});
        await waitUntil("已设置", () => !done.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        await done.checkButton().trigger("click");
        await waitUntil("通过", () => done.result().text().startsWith("检测通过") || undefined);
        done.wrapper.unmount();
        mounted.splice(mounted.indexOf(done.wrapper), 1);
        expect(mountPage(done.store).result().text()).toBe("检测通过（08:30:00）");
    });

    it("说明经 aria-describedby 关联到密钥框（输出 9、10）", async () => {
        const {wrapper, input} = render();
        await flushPromises();
        const ids = (input().attributes("aria-describedby") ?? "").split(" ");
        const note = ids.map((id) => wrapper.element.querySelector(`[id="${id}"]`)).find((element) => element !== null);
        expect(note?.textContent).toContain("与模型设置里的 DeepSeek 密钥分开存放");
    });
});
