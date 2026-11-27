/**
 * 网络页（docs/specs/network/egress.md 的“网络页”）：配置服务是设置场景的局部宿主（产品里同一个配置实例，用户层在内存里），页面
 * 写的是真的设置；选路说明与测试用 Lab 同一份替身（说明按配置服务里此刻的值现算），在线目录用模型页的替身。真实的选路与测试在
 * `nb-host` 的 `network/egress.test.ts` 与 `plugins/network/network.test.ts`。
 */

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {createFakeModelsRemote} from "nbook/plugins/models/web/lab/fake-remote";
import {SAMPLE_CATALOG, SAMPLE_SNAPSHOT} from "nbook/plugins/models/web/lab/sample";
import {createFakeNetworkRemote} from "nbook/plugins/network/web/lab/fake-remote";
import type {FakeNetworkOptions} from "nbook/plugins/network/web/lab/fake-remote";
import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import type {ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {networkSettings} from "../../shared/settings";
import {createNetworkStore} from "../network-store";
import {networkCatalogs} from "../text";
import NetworkPage from "./NetworkPage.vue";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const {proxyMode, proxyUrl, catalogAutoUpdate} = networkSettings.settings;

interface RenderOptions {
    readonly values?: Record<string, unknown>;
    readonly network?: Omit<FakeNetworkOptions, "setting">;
    readonly catalog?: ModelsSnapshot["catalog"];
    readonly modelsUnavailable?: boolean;
    readonly locale?: DisplayLocale;
    readonly writable?: boolean;
}

async function render(options: RenderOptions = {}) {
    const host = createSettingsHost({settings: [proxyMode, proxyUrl, catalogAutoUpdate].map((definition) => ({plugin: "nbook.network", definition})), sections: [], user: {values: options.values ?? {}}, notify: () => undefined, report: () => undefined});
    cleanup.push(() => host.dispose());
    const settings = host.service("nbook.network");
    let tests = 0;
    const network = createFakeNetworkRemote({setting: () => ({mode: settings.get(proxyMode), url: settings.get(proxyUrl)}), ...options.network});
    const counted = {...network, test: (...args: Parameters<typeof network.test>) => {
        tests += 1;
        return network.test(...args);
    }} as typeof network;
    const models = createFakeModelsRemote({...SAMPLE_SNAPSHOT, catalog: options.catalog ?? SAMPLE_CATALOG}, {unavailable: options.modelsUnavailable === true});
    const store = createNetworkStore(counted, models.remote);
    cleanup.push(() => store.dispose());
    const engine = createHostTextEngine({locale: options.locale ?? "zh-CN"});
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    engine.register("nbook.network", networkCatalogs.catalogs, networkCatalogs.source);
    const failures: string[] = [];
    const wrapper = mount(NetworkPage, {
        global: {provide: provideText(engine.port)},
        props: {store, settings, writable: options.writable ?? true, reportWriteFailure: (subject: string) => failures.push(subject)},
        attachTo: document.body,
    });
    cleanup.push(() => wrapper.unmount());
    await flushPromises();
    const query = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
    return {wrapper, settings, store, failures, query, host, tests: () => tests};
}

const summary = () => document.querySelector("[data-network-summary]")?.textContent?.trim() ?? null;
const testButton = () => document.querySelector<HTMLButtonElement>("[data-network-test]");
/** 按钮看得见的那一种文字：两种文字叠在同一格里，另一种是 `visibility: hidden`。 */
const label = (button: HTMLElement | null) => [...(button?.querySelectorAll<HTMLElement>(".network-page__swap > span") ?? [])].find((item) => !item.classList.contains("network-page__swap-hidden"))?.textContent?.trim() ?? "";
const statusOf = (button: HTMLElement | null) => button?.closest("[data-settings-action-row]")?.querySelector("[data-settings-action-status]")?.textContent?.trim() ?? "";
const modeButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-network-mode] button, [data-network-mode] [role='radio']")].find((item) => item.textContent?.trim() === label)!;
const urlInput = () => document.querySelector<HTMLInputElement>("[data-network-url] input, input[data-network-url]")!;
/** 用指针选：先 pointerdown（页面据此在选了“自定义”后把焦点交给地址框），再 click。 */
const pick = (label: string): void => {
    const button = modeButton(label);
    button.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
    button.click();
};
async function type(value: string, commit: "enter" | "blur" | "none" = "enter"): Promise<void> {
    const input = urlInput();
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input"));
    if (commit === "enter") input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
    if (commit === "blur") input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
    await flushPromises();
}
const fresh = (): void => cleanup.splice(0).forEach((dispose) => dispose());

describe("代理", () => {
    it("跟随系统：行下写当前使用的代理与来源；系统没设写直连；不支持写原因；说明读不到写一句", async () => {
        await render();
        expect(summary()).toBe("当前使用 http://127.0.0.1:7890（来自环境变量 HTTPS_PROXY）");
        fresh();
        await render({network: {system: "none"}});
        expect(summary()).toBe("系统未设置代理，直接连接");
        fresh();
        await render({network: {system: "unsupported"}});
        expect(summary()).toContain("系统的代理是 SOCKS 或自动配置脚本，不支持");
        expect(document.querySelector("[data-network-summary]")?.getAttribute("data-tone")).toBe("danger");
        fresh();
        await render({network: {describeFails: true}});
        await waitUntil("读不到", () => summary() === "无法读取当前使用的代理");
    });

    it("说明一直不答时写“正在读取”；选“直连”后没有说明，也没有“测试代理”", async () => {
        const {settings} = await render({network: {describeHangs: true}});
        expect(summary()).toBe("正在读取当前使用的代理…");
        pick("直连");
        await waitUntil("写进用户层", () => settings.get(proxyMode) === "direct");
        await flushPromises();
        expect(summary()).toBeNull();
        expect(testButton()).toBeNull();
    });

    it("用指针选“自定义”：焦点进地址框，地址空着不报错；不合规的地址在行下写原因（alert）、不写；合规的回车写进去", async () => {
        const {settings} = await render();
        pick("自定义");
        await waitUntil("写进用户层", () => settings.get(proxyMode) === "custom");
        await flushPromises();
        expect(document.activeElement).toBe(urlInput());
        expect(summary()).toBeNull();
        for (const bad of ["socks5://127.0.0.1:1080", "http://user:secret@127.0.0.1:7890", "user:secret@127.0.0.1:7890", "not a url"]) {
            await type(bad);
            const problem = document.querySelector("[data-network-url-problem]");
            expect(problem?.getAttribute("role")).toBe("alert");
            expect(problem?.textContent).toContain("须为 http 或 https 地址");
            expect(settings.get(proxyUrl)).toBe("");
        }
        await type("http://127.0.0.1:7890");
        await waitUntil("地址写进去", () => settings.get(proxyUrl) === "http://127.0.0.1:7890");
        expect(document.querySelector("[data-network-url-problem]")).toBeNull();
    });

    it("回车写过、紧接着失焦不再写；写失败时通知一次，框里退回实际的地址", async () => {
        const {host, failures} = await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}});
        host.user.failWrites("write-failed");
        await type("http://10.0.0.1:3128");
        urlInput().dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await waitUntil("失败通知", () => failures.length > 0);
        await flushPromises();
        expect(failures).toEqual(["代理地址"]);
        expect(urlInput().value).toBe("http://127.0.0.1:7890");
    });

    it("别处改了地址：框里没改过就跟着换，失焦也不把旧值写回去；改过的不被打断", async () => {
        const {settings} = await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}});
        urlInput().focus();
        await settings.update(proxyUrl, "http://10.0.0.2:8080", {layer: "user"});
        await flushPromises();
        expect(urlInput().value).toBe("http://10.0.0.2:8080");
        urlInput().dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(settings.get(proxyUrl)).toBe("http://10.0.0.2:8080");
        await type("http://10.0.0.3:8080", "none");
        await settings.update(proxyUrl, "http://10.0.0.4:8080", {layer: "user"});
        await flushPromises();
        expect(urlInput().value).toBe("http://10.0.0.3:8080");
    });

    it("用户层不能写：代理方式、地址与开关停用；测试与现在更新不写设置，照样能用", async () => {
        const {store} = await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}, writable: false});
        expect(modeButton("直连").closest("[data-network-mode]")?.querySelector("[disabled], [data-disabled]")).not.toBeNull();
        expect(urlInput().disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>("[data-network-auto-update]")?.disabled).toBe(true);
        testButton()!.click();
        await waitUntil("测完", () => store.test.value.status === "done");
    });
});

describe("测试代理", () => {
    it("连接成功写出口 IP 与耗时；框里刚填的地址先写完再测（测到的是新地址）", async () => {
        const {settings, store} = await render({values: {[proxyMode.key]: "custom"}});
        await type("http://10.0.0.9:3128", "blur");
        testButton()!.click();
        await waitUntil("测完", () => store.test.value.status === "done");
        expect(settings.get(proxyUrl)).toBe("http://10.0.0.9:3128");
        const state = store.test.value;
        expect(state.status === "done" && state.result.summary.origin).toBe("http://10.0.0.9:3128");
        await flushPromises();
        expect(statusOf(testButton())).toBe("连接成功：出口 IP 203.0.113.7，286 ms");
    });

    it("进行中按钮换成“取消测试”（同一个元素、宽度不变）、焦点不掉；点了取消；改了代理设置后旧结果清掉；离开页面取消在跑的测试", async () => {
        const {settings, store, wrapper} = await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}, network: {test: "hang"}});
        const button = testButton()!;
        button.focus();
        button.click();
        await flushPromises();
        expect(label(button)).toBe("取消测试");
        // 两种文字都在按钮里，看不见的那一种占着宽度。
        expect(button.textContent).toContain("测试");
        expect(document.activeElement).toBe(button);
        expect(statusOf(button)).toBe("正在测试…");
        button.click();
        await flushPromises();
        expect(store.test.value.status).toBe("idle");
        expect(statusOf(button)).toBe("");

        button.click();
        await flushPromises();
        expect(store.test.value.status).toBe("running");
        await settings.update(proxyUrl, "http://127.0.0.1:7891", {layer: "user"});
        await flushPromises();
        expect(store.test.value.status).toBe("idle");

        button.click();
        await flushPromises();
        expect(store.test.value.status).toBe("running");
        wrapper.unmount();
        expect(store.test.value.status).toBe("idle");
    });

    it("测试目标没走代理时不说“连接成功”；无法连接写原因", async () => {
        await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}, network: {test: "bypassed"}});
        testButton()!.click();
        await waitUntil("测完", () => statusOf(testButton()) !== "" && statusOf(testButton()) !== "正在测试…");
        expect(statusOf(testButton())).toBe("测试目标没有经过代理（直连）：出口 IP 203.0.113.7，286 ms");
        fresh();
        await render({values: {[proxyMode.key]: "custom", [proxyUrl.key]: "http://127.0.0.1:7890"}, network: {test: "unreachable"}});
        testButton()!.click();
        await waitUntil("测完", () => statusOf(testButton()).startsWith("无法连接"));
        expect(testButton()!.closest("[data-settings-action-row]")?.querySelector("[data-settings-action-status]")?.getAttribute("data-tone")).toBe("danger");
    });
});

describe("模型目录", () => {
    it("写出上次更新的时间与模型数；“更新”进行中写“更新中”、不停用（焦点不掉）、点了不另发，完了换新的时间", async () => {
        const {store} = await render();
        await waitUntil("收到目录状态", () => store.catalog.value !== null);
        await flushPromises();
        const button = document.querySelector<HTMLButtonElement>("[data-network-update]")!;
        const row = button.closest("[data-settings-action-row]")!;
        expect(row.textContent).toContain("1,104");
        // 替身下一轮事件循环就更新完：逐次记下按钮的文字与状态，不靠轮询碰上“更新中”。
        const seen: string[] = [];
        const observer = new MutationObserver(() => seen.push(`${label(button)}${button.disabled ? "（停用）" : ""}${button.getAttribute("aria-disabled") === "true" ? "（不可点）" : ""}`));
        observer.observe(button, {subtree: true, childList: true, characterData: true, attributes: true});
        button.focus();
        button.click();
        await waitUntil("更新完", () => seen.length > 0 && label(button) === "更新" && button.getAttribute("aria-disabled") !== "true");
        observer.disconnect();
        expect(seen).toContain("更新中（不可点）");
        expect(seen.some((item) => item.includes("（停用）"))).toBe(false);
        expect(document.activeElement).toBe(button);
        expect(store.catalog.value?.checkedAt).not.toBe(SAMPLE_CATALOG.checkedAt);
    });

    it("没取过、关掉了、上次失败、模型服务没有运行各写一句；关掉与读不到时按钮停用", async () => {
        const update = () => document.querySelector<HTMLButtonElement>("[data-network-update]")!;
        const rowText = () => update().closest("[data-settings-action-row]")!.textContent ?? "";
        await render({catalog: {...SAMPLE_CATALOG, checkedAt: null, modelCount: null}});
        await waitUntil("收到", () => rowText().includes("还没有取过在线目录"));
        fresh();
        await render({catalog: {...SAMPLE_CATALOG, enabled: false}});
        await waitUntil("收到", () => rowText().includes("这台机器关掉了在线目录"));
        expect(update().disabled).toBe(true);
        fresh();
        await render({catalog: {...SAMPLE_CATALOG, error: {reason: "proxy", message: "socks"}}});
        await waitUntil("收到", () => statusOf(update()) === "上次更新失败：代理设置无效");
        fresh();
        await render({modelsUnavailable: true});
        await flushPromises();
        expect(rowText()).toContain("读不到模型目录的状态");
        expect(update().disabled).toBe(true);
    });

    it("自动更新的开关写进用户层", async () => {
        const {settings} = await render();
        document.querySelector<HTMLElement>("[data-network-auto-update]")!.click();
        await waitUntil("关掉", () => settings.get(catalogAutoUpdate) === false);
    });
});

describe("英文", () => {
    it("英文界面：代理方式与测试的文字", async () => {
        await render({locale: "en-US"});
        expect(summary()).toBe("Using http://127.0.0.1:7890 (from the HTTPS_PROXY environment variable)");
        expect(label(testButton())).toBe("Test");
    });
});
