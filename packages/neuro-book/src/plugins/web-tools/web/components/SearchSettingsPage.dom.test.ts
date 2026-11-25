/**
 * “搜索与网页”页（docs/specs/web/settings-page.md 输出 1 到 14）：组件经属性拿数据模块，数据模块建在 Lab 场景同一份远程合同替身上
 * （`fake-remote.ts`）；设置项经设置场景的局部宿主写（产品里同一个配置实例，用户层在内存里）。页面与服务端的真实来回在
 * `web-tools/search-store.test.ts` 与 `e2e/web-settings.e2e.ts`。窄布局（容器查询换下拉）在 happy-dom 里量不出来，看 Lab 截图。
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
const TAVILY_KEY = "tvly-dom-test-not-real-123456";

const S = webSettings.settings;
const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

type Failure = {subject: string; reason: string; uncertain?: boolean};
type Item = "rules" | "deepseek" | "tavily";

/** 在给定的数据模块上挂一次页面；同一个数据模块可以挂多次（离开这页再回来）。`input` 这几个取的是右边详情里的。 */
function mountPage(store: SearchStore, settings: SettingsService, {writable = true, locale = "zh-CN" as DisplayLocale} = {}) {
    const failures: Failure[] = [];
    const wrapper = mount(SearchSettingsPage, {
        global: {provide: provideText(testTextPort(locale, {[WEB_TEXT_NAMESPACE]: webCatalogs, "nbook.settings": settingsCatalogs}))},
        props: {store, settings, writable, reportWriteFailure: (subject: string, failure: {reason: string; uncertain?: boolean}) => failures.push({subject, ...failure})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    const detail = "[data-search-detail]";
    const input = () => wrapper.get<HTMLInputElement>(`${detail} [data-key-input]`);
    const checkButton = () => wrapper.get<HTMLButtonElement>(`${detail} [data-search-check]`);
    const result = () => wrapper.get(`${detail} [data-search-check-result]`);
    const clear = () => wrapper.find<HTMLButtonElement>(`${detail} [data-key-clear]`);
    const railItem = (item: Item) => wrapper.get<HTMLButtonElement>(`[data-search-rail-item="${item}"]`);
    /** 在左栏点选一项，等右边换成它。 */
    const show = async (item: Item): Promise<void> => {
        await railItem(item).trigger("click");
        await waitUntil(`详情换成 ${item}`, () => wrapper.find(`[data-search-detail="${item}"]`).exists() || undefined);
    };
    return {wrapper, failures, input, checkButton, result, clear, railItem, show};
}

const ALL_SETTINGS = [S.provider, S.deepseekBaseUrl, S.tavilyBaseUrl, S.resultCount, S.blockedSites, S.tavilySearchDepth];

function render(options: FakeWebRemoteOptions = {}, page: {writable?: boolean; locale?: DisplayLocale; values?: Record<string, unknown>; userUnreachable?: boolean} = {}) {
    const fake = createFakeWebRemote(options);
    const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
    stores.push(store);
    const host = createSettingsHost({settings: ALL_SETTINGS.map((definition) => ({plugin: "nbook.web", definition})), sections: [], user: {values: page.values ?? {}, unreachable: page.userUnreachable === true}, notify: () => undefined, report: () => undefined});
    stores.push(host);
    const settings = host.service("nbook.web");
    return {fake, store, host, settings, ...mountPage(store, settings, page)};
}

async function type(input: {setValue(value: string): Promise<void>; trigger(event: string, options?: object): Promise<void>}, value: string): Promise<void> {
    await input.setValue(value);
    await input.trigger("keydown", {key: "Enter"});
    await flushPromises();
}

const loaded = (page: {input(): {attributes(name: string): string | undefined}}) => waitUntil("状态到了", () => page.input().attributes("placeholder") !== "读取中" || undefined, {timeoutMs: 10_000});

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
        expect(failed.wrapper.text()).toContain("会发一次搜索，可能计费");
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


    it("版式：左栏依次是搜索规则与各家，第一次显示选中使用中的那家；各家带 logo；方向键在左栏里移动并选中（输出 1、10、14）", async () => {
        const page = render({hasKey: true}, {values: {"nbook.web/provider": "tavily"}});
        await loaded(page);
        expect(page.wrapper.findAll("[data-search-rail-item]").map((item) => item.attributes("data-search-rail-item"))).toEqual(["rules", "deepseek", "tavily"]);
        expect(page.wrapper.get("[data-search-detail]").attributes("data-search-detail")).toBe("tavily");
        expect(page.railItem("tavily").attributes("aria-current")).toBe("page");
        expect(page.railItem("tavily").attributes("tabindex")).toBe("0");
        expect(page.railItem("deepseek").attributes("tabindex")).toBe("-1");
        // logo：两家都在图标表里，画的是图（不是首字母块）；地址表按需加载，等它到。
        await waitUntil("logo 到了", () => page.wrapper.findAll("[data-search-rail-item] img.provider-logo").length === 2 || undefined, {timeoutMs: 10_000});
        await page.railItem("tavily").trigger("keydown", {key: "ArrowUp"});
        await waitUntil("上移到 DeepSeek", () => page.wrapper.find('[data-search-detail="deepseek"]').exists() || undefined);
        await page.railItem("deepseek").trigger("keydown", {key: "Home"});
        await waitUntil("到搜索规则", () => page.wrapper.find('[data-search-detail="rules"]').exists() || undefined);
    });

    it("使用中：左栏与标题区写“使用中”；状态格只在出问题时有图标：使用中却没密钥是钥匙，检测没通过是警示；没在用也没密钥的不标（输出 11）", async () => {
        const page = render({check: {ok: false, code: "auth"}, hasTavilyKey: true});
        await loaded(page);
        expect(page.railItem("deepseek").find("[data-search-in-use]").exists()).toBe(true);
        expect(page.railItem("tavily").find("[data-search-in-use]").exists()).toBe(false);
        expect(page.railItem("deepseek").get("[data-search-flag]").attributes("data-search-flag")).toBe("warning");
        expect(page.railItem("tavily").find("[data-search-flag]").exists()).toBe(false);
        // 使用中却没密钥：密钥行右边写“未填写”；读屏描述是“使用中，还没有密钥”。
        expect(page.wrapper.get("[data-search-detail] [data-key-notice]").text()).toBe("未填写");
        const describedBy = page.railItem("deepseek").attributes("aria-describedby") ?? "";
        expect(page.wrapper.element.querySelector(`[id="${describedBy}"]`)?.textContent).toBe("使用中，还没有密钥");
        await page.show("tavily");
        await page.checkButton().trigger("click");
        await waitUntil("检测没通过", () => page.railItem("tavily").find('[data-search-flag="danger"]').exists() || undefined);
        expect(page.wrapper.find("[data-search-detail] [data-key-notice]").exists()).toBe(false);
    });

    it("设为使用中：这家有密钥时直接写设置；写失败交窗口通知，主语是“使用”（输出 11）", async () => {
        const page = render({hasKey: true, hasTavilyKey: true});
        await loaded(page);
        await page.show("tavily");
        await page.wrapper.get("[data-search-use-action]").trigger("click");
        await waitUntil("写进去了", () => page.settings.get(S.provider) === "tavily" || undefined);
        expect(page.settings.inspect(S.provider).user).toMatchObject({value: "tavily"});
        await waitUntil("标题区换成使用中", () => page.wrapper.find("[data-search-detail] [data-search-in-use]").exists() || undefined);
        expect(page.railItem("tavily").find("[data-search-in-use]").exists()).toBe(true);

        page.host.user.failWrites("unknown-outcome");
        await page.show("deepseek");
        await page.wrapper.get("[data-search-use-action]").trigger("click");
        await waitUntil("通知", () => page.failures.length > 0 || undefined);
        expect(page.failures).toEqual([{subject: "使用", reason: "可能没有保存，以设置文件为准", uncertain: true}]);
        expect(page.settings.get(S.provider)).toBe("tavily");
    });

    it("设为使用中：这家没有密钥而使用中的那家有时先不切，焦点进密钥框；填好后自动切过去；换选别的项或清除时作废（输出 11）", async () => {
        const page = render({hasKey: true});
        await loaded(page);
        await page.show("tavily");
        await page.wrapper.get("[data-search-use-action]").trigger("click");
        await flushPromises();
        expect(page.settings.get(S.provider)).toBe("deepseek");
        expect(page.wrapper.get("[data-search-detail] [data-key-notice]").text()).toBe("填写密钥后即可启用");
        expect(document.activeElement).toBe(page.input().element);
        await type(page.input(), TAVILY_KEY);
        await waitUntil("自动切过去", () => page.settings.get(S.provider) === "tavily" || undefined);
        expect(page.fake.calls.filter((call) => call.method === "setKey")).toEqual([{method: "setKey", provider: "tavily", key: TAVILY_KEY}]);

        // 换选别的项：等待作废，之后在那家填密钥不再切。
        const other = render({hasKey: true});
        await loaded(other);
        await other.show("tavily");
        await other.wrapper.get("[data-search-use-action]").trigger("click");
        await flushPromises();
        await other.show("rules");
        await other.show("tavily");
        expect(other.wrapper.find("[data-search-detail] [data-key-notice]").exists()).toBe(false);
        await type(other.input(), TAVILY_KEY);
        expect(other.settings.get(S.provider)).toBe("deepseek");
    });

    it("设为使用中：使用中的那家也没有密钥时照常切（输出 11）", async () => {
        const page = render();
        await loaded(page);
        await page.show("tavily");
        await page.wrapper.get("[data-search-use-action]").trigger("click");
        await waitUntil("切过去了", () => page.settings.get(S.provider) === "tavily" || undefined);
        expect(page.wrapper.get("[data-search-detail] [data-key-notice]").text()).toBe("未填写");
    });

    it("搜索规则：默认结果条数写用户层，范围外原位提示、不写；屏蔽网站归一化后写，不像域名的不收；左栏写屏蔽了几个（输出 12）", async () => {
        const page = render({hasKey: true});
        await loaded(page);
        await page.show("rules");
        const count = () => page.wrapper.get<HTMLInputElement>("[data-search-count] input, input[data-search-count]");
        await count().setValue("7");
        await waitUntil("写了条数", () => page.settings.get(S.resultCount) === 7 || undefined);
        await count().setValue("11");
        await flushPromises();
        expect(page.wrapper.text()).toContain("填 1 到 10 的整数");
        expect(page.settings.get(S.resultCount)).toBe(7);

        const blocked = () => page.wrapper.get<HTMLInputElement>("[data-search-blocked] input, input[data-search-blocked]");
        await blocked().setValue("https://Blog.CSDN.net/article/1");
        await blocked().trigger("keydown", {key: "Enter"});
        await waitUntil("写了屏蔽网站", () => page.settings.get(S.blockedSites).length === 1 || undefined);
        expect(page.settings.get(S.blockedSites)).toEqual(["blog.csdn.net"]);
        expect(page.railItem("rules").text()).toContain("1");
        await blocked().setValue("不是域名");
        await blocked().trigger("keydown", {key: "Enter"});
        await flushPromises();
        expect(page.wrapper.text()).toContain("“不是域名”不是域名");
        expect(page.settings.get(S.blockedSites)).toEqual(["blog.csdn.net"]);
    });

    it("高级：标题旁写有哪几项；接口地址回车写、不是 http(s) 的原位提示不写、清空回到缺省；Tavily 的搜索深度写设置；改过的默认展开（输出 13）", async () => {
        const page = render({hasKey: true, hasTavilyKey: true}, {values: {"nbook.web/tavilySearchDepth": "advanced"}});
        await loaded(page);
        expect(page.wrapper.get("[data-search-advanced]").text()).toContain("接口地址");
        expect(page.wrapper.get("[data-search-advanced]").attributes("aria-expanded")).toBe("false");
        await page.wrapper.get("[data-search-advanced]").trigger("click");
        await waitUntil("展开", () => page.wrapper.find("[data-search-base-url]").exists() || undefined);
        const url = () => page.wrapper.get<HTMLInputElement>("input[data-search-base-url], [data-search-base-url] input");
        await url().setValue("ftp://relay.example");
        await url().trigger("keydown", {key: "Enter"});
        await flushPromises();
        expect(page.wrapper.text()).toContain("要以 http:// 或 https:// 开头");
        expect(page.settings.inspect(S.deepseekBaseUrl).user).not.toMatchObject({value: expect.anything()});
        await url().setValue("https://relay.example/deepseek");
        await url().trigger("keydown", {key: "Enter"});
        await waitUntil("写了地址", () => page.settings.get(S.deepseekBaseUrl) === "https://relay.example/deepseek" || undefined);
        await url().setValue("");
        await url().trigger("keydown", {key: "Enter"});
        await waitUntil("回到缺省", () => page.settings.get(S.deepseekBaseUrl) === "https://api.deepseek.com" || undefined);

        // Tavily 改过搜索深度：它的高级默认展开。
        await page.show("tavily");
        expect(page.wrapper.get("[data-search-advanced]").text()).toContain("接口地址、搜索深度");
        expect(page.wrapper.get("[data-search-advanced]").attributes("aria-expanded")).toBe("true");
        await page.wrapper.get('[data-search-depth] [data-value="basic"]').trigger("click");
        await waitUntil("写了深度", () => page.settings.get(S.tavilySearchDepth) === "basic" || undefined);
    });

    it("各家互不影响：在一家的框里输入只让这一家的检测可点；一家检测中时另一家照常可点；写失败的主语是那一家（输出 6、8）", async () => {
        const page = render({hasKey: true, hasTavilyKey: true, check: "hang"});
        await loaded(page);
        await page.checkButton().trigger("click");
        await flushPromises();
        expect(page.checkButton().text()).toBe("检测中");
        await page.show("tavily");
        expect(page.checkButton().text()).toBe("检测");
        expect(page.checkButton().element.disabled).toBe(false);

        const fresh = render();
        await loaded(fresh);
        await fresh.input().setValue(KEY);
        expect(fresh.checkButton().element.disabled).toBe(false);
        await fresh.input().setValue("");
        await fresh.show("tavily");
        expect(fresh.checkButton().element.disabled).toBe(true);
        fresh.fake.failWrites("credentials-unavailable");
        await type(fresh.input(), TAVILY_KEY);
        expect(fresh.failures).toEqual([{subject: "Tavily 的 API 密钥", reason: "密钥文件读写失败；请重新输入", uncertain: false}]);
    });

    it("说明：DeepSeek 的密钥旁有说明图标，Tavily 没有；详情里不写说明句（输出 9）", async () => {
        const page = render({hasKey: true});
        await loaded(page);
        expect(page.wrapper.find("[data-search-detail] .api-key-field__label button").exists()).toBe(true);
        expect(page.wrapper.text()).not.toContain("这把密钥只给搜索与读网页用");
        await page.show("tavily");
        expect(page.wrapper.find("[data-search-detail] .api-key-field__label button").exists()).toBe(false);
    });

    it("页面声明：铺满的版式；设置窗口里按 DeepSeek 或 Tavily 都搜得到这一页（“输入与前置条件”）", () => {
        const declaration = webBrowserPlugin.entries[0]!.contributions?.[0]?.declaration as {keywords?: unknown[]; layout?: string} | undefined;
        expect(declaration?.layout).toBe("fill");
        expect(declaration?.keywords).toEqual(expect.arrayContaining([webText("keywords.deepseek"), webText("keywords.tavily")]));
    });
});
