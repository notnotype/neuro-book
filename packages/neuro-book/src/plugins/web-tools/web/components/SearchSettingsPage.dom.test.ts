/**
 * “搜索与网页”页（docs/specs/web/settings-page.md 输出 2 到 10）：组件经属性拿数据模块，数据模块建在 Lab 场景同一份远程合同替身上
 * （`fake-remote.ts`）。页面与服务端的真实来回在 `web-tools/search-store.test.ts` 与 `e2e/web-settings.e2e.ts`。
 */

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeWebRemote} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import type {FakeWebRemoteOptions} from "nbook/plugins/lab/web/fixtures/web-tools-scene/fake-remote";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {WEB_TEXT_NAMESPACE} from "../../shared/text";
import {createSearchStore} from "../search-store";
import {webCatalogs} from "../text";
import SearchSettingsPage from "./SearchSettingsPage.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[WEB_TEXT_NAMESPACE]: webCatalogs}))};
const KEY = "sk-dom-test-not-real-123456";

const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

function render(options: FakeWebRemoteOptions = {}, writable = true) {
    const fake = createFakeWebRemote(options);
    const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
    stores.push(store);
    const failures: Array<{subject: string; reason: string; uncertain?: boolean}> = [];
    const wrapper = mount(SearchSettingsPage, {
        global,
        props: {store, writable, reportWriteFailure: (subject: string, failure: {reason: string; uncertain?: boolean}) => failures.push({subject, ...failure})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    const input = () => wrapper.get<HTMLInputElement>("[data-key-input]");
    const checkButton = () => wrapper.get<HTMLButtonElement>("[data-search-check]");
    return {wrapper, fake, store, failures, input, checkButton};
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

    it("填密钥：回车写入、框清空、显示“已设置”；页面上找不到密钥原文；紧接着失焦不再写（输出 3）", async () => {
        const {wrapper, fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
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

    it("env: 写法：原位提示、框标为无效，不写（输出 4）", async () => {
        const {wrapper, fake, input} = render();
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(input(), "env:DEEPSEEK_API_KEY");
        expect(wrapper.get("[data-key-problem]").text()).toContain("不支持环境变量引用");
        expect(input().attributes("aria-invalid")).toBe("true");
        expect(fake.calls.some((call) => call.method === "setKey")).toBe(false);
    });

    it("清除：直接写，回到未设置，检测停用（输出 5）", async () => {
        const {wrapper, fake, input, checkButton} = render({hasKey: true});
        await waitUntil("已设置", () => wrapper.find("[data-key-clear]").exists() || undefined, {timeoutMs: 10_000});
        await wrapper.get("[data-key-clear]").trigger("click");
        await flushPromises();
        expect(fake.calls.some((call) => call.method === "clearKey")).toBe(true);
        expect(input().attributes("placeholder")).toBe("还没有填写");
        expect(checkButton().element.disabled).toBe(true);
    });

    it("写失败：交给窗口通知，原因后写“请重新输入”（输出 6）", async () => {
        const {fake, failures, input} = render();
        fake.failWrites(true);
        await waitUntil("状态到了", () => input().attributes("placeholder") === "还没有填写" || undefined, {timeoutMs: 10_000});
        await type(input(), KEY);
        expect(failures).toEqual([{subject: "DeepSeek 的 API 密钥", reason: "密钥文件读写失败；请重新输入", uncertain: false}]);
    });

    it("只读：网页工具没运行时写一句说明、控件停用；writable 为假时控件停用（输出 7）", async () => {
        const readonly = render({unavailable: true});
        await waitUntil("只读", () => readonly.wrapper.find("[data-search-readonly]").exists() || undefined, {timeoutMs: 10_000});
        expect(readonly.input().element.disabled).toBe(true);
        // 没取到状态：不说“未设置”（输出 2）。
        expect(readonly.input().attributes("placeholder")).toBe("读取中");

        const locked = render({hasKey: true}, false);
        await waitUntil("已设置", () => locked.input().attributes("placeholder") === "已设置" || undefined, {timeoutMs: 10_000});
        expect(locked.input().element.disabled).toBe(true);
        expect(locked.checkButton().element.disabled).toBe(true);
    });

    it("密钥文件读不了：顶上写一句，密钥框照常可写（输出 7）", async () => {
        const {wrapper, input} = render({unreadable: true});
        await waitUntil("提示", () => wrapper.find("[data-search-keys-unreadable]").exists() || undefined, {timeoutMs: 10_000});
        expect(input().element.disabled).toBe(false);
    });

    it("检测：进行中显示“检测中”并停用；通过带时间；失败按码写原因；没检成写远程失败（输出 8、10）", async () => {
        const running = render({hasKey: true, check: "hang"});
        await waitUntil("已设置", () => !running.checkButton().element.disabled || undefined, {timeoutMs: 10_000});
        expect(running.checkButton().attributes("aria-label")).toBe("检测 DeepSeek 的密钥");
        await running.checkButton().trigger("click");
        await flushPromises();
        expect(running.checkButton().text()).toBe("检测中");
        expect(running.checkButton().element.disabled).toBe(true);

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
        await waitUntil("没检成", () => notRun.wrapper.get("[data-search-check-result]").text().startsWith("没检成") || undefined);
    });

    it("说明经 aria-describedby 关联到密钥框（输出 9、10）", async () => {
        const {wrapper, input} = render();
        await flushPromises();
        const ids = (input().attributes("aria-describedby") ?? "").split(" ");
        const note = ids.map((id) => wrapper.element.querySelector(`[id="${id}"]`)).find((element) => element !== null);
        expect(note?.textContent).toContain("与模型设置里的 DeepSeek 密钥分开存放");
    });
});
