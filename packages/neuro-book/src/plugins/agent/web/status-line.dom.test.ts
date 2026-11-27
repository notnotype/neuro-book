/**
 * 状态栏的设置与项（docs/specs/agent/conversation.md 输出 45、46，contributions.md 输出 22）：设置是设置场景的局部宿主（产品里同一个
 * 配置实例），用户层的拥有者在内存里；页面是真的组件、真的写入；贡献点校验与接收者用真的校验函数与句柄形状。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {readonly, ref} from "vue";
import type {Ref} from "vue";
import {resolveStatusLine, statusLineCatalog} from "@notnotype/nb-agent-ui";
import type {StatusLineItem} from "@notnotype/nb-agent-ui";
import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {validateStatusItemContribution} from "../shared/status-item-point";
import {agentSettings} from "../shared/settings";
import {agentCatalogs} from "./text";
import StatusLinePage from "./components/StatusLinePage.vue";
import {createStatusItems} from "./status-items";
import {statusLinePage, statusCatalog} from "./status-line-page";
import {createStatusLineWriter} from "./status-line-writes";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const words: StatusLineItem = {id: "x.words", side: "left", title: "本会话改的字数", description: "来自插件“字数统计”", defaultVisible: false, source: "x"};

function settingsWith(values: Record<string, unknown> = {}) {
    const settings = Object.values(agentSettings.settings).map((definition) => ({plugin: "nbook.agent", definition}));
    const host = createSettingsHost({settings, sections: [], user: {values}, notify: () => undefined, report: () => undefined});
    cleanup.push(() => host.dispose());
    return host.service("nbook.agent");
}
const current = (settings: ReturnType<typeof settingsWith>) => settings.get(agentSettings.settings.statusLine);

describe("状态栏设置的写入（输出 45）", () => {
    const catalog = statusLineCatalog([words]);

    it("勾选与移动写进用户层；同一拍连点几下都留下；改回缺省时去掉", async () => {
        const settings = settingsWith();
        const writer = createStatusLineWriter(settings, () => catalog);
        const results = await Promise.all([writer.toggle("model"), writer.toggle("x.words"), writer.move("cost", {side: "right", index: 0})]);
        expect(results.every((result) => result.ok)).toBe(true);
        expect(current(settings)).toEqual({order: ["context", "x.words", "cost", "usage", "model"], visible: {model: true, "x.words": true}});
        await writer.toggle("model");
        await writer.move("usage", {side: "right", index: 0});
        expect(current(settings)).toEqual({visible: {"x.words": true}});
    });

    it("换边写进 side；换回原处设置回到空对象", async () => {
        const settings = settingsWith();
        const writer = createStatusLineWriter(settings, () => catalog);
        expect((await writer.move("usage", {side: "left", index: 0})).ok).toBe(true);
        expect(current(settings)).toEqual({order: ["usage", "context", "x.words", "cost", "model"], side: {usage: "left"}});
        await writer.move("usage", {side: "right", index: 0});
        expect(current(settings)).toEqual({});
    });

    it("上移下移按写的那一刻的位置算：同一项连点两下挪两格，不是一格", async () => {
        const settings = settingsWith();
        const writer = createStatusLineWriter(settings, () => catalog);
        await Promise.all([writer.shift("usage", 1), writer.shift("usage", 1)]);
        expect(current(settings)).toEqual({order: ["context", "x.words", "cost", "model", "usage"]});
        await Promise.all([writer.shift("usage", -1), writer.shift("usage", -1)]);
        expect(current(settings)).toEqual({});
        // 右边第一项上移到左边最后。
        await writer.shift("usage", -1);
        expect(current(settings).side).toEqual({usage: "left"});
        expect(resolveStatusLine(catalog, current(settings)).left.map((item) => item.id)).toEqual(["context", "x.words", "usage"]);
    });

    it("目录是写的那一刻取的：插件的项停用后设置里它的显隐照样留着", async () => {
        const settings = settingsWith({[agentSettings.settings.statusLine.key]: {visible: {"x.words": true}}});
        const writer = createStatusLineWriter(settings, () => statusLineCatalog());
        await writer.toggle("model");
        expect(current(settings)).toEqual({visible: {"x.words": true, model: true}});
    });
});

describe("“状态栏”设置页（输出 46）", () => {
    function mountPage(values: Record<string, unknown> = {}, writable = true) {
        const settings = settingsWith(values);
        const items = createStatusItems(() => undefined);
        const writer = createStatusLineWriter(settings, () => statusCatalog(items));
        const engine = createHostTextEngine({locale: "zh-CN", strict: true});
        engine.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
        engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
        const failures: string[] = [];
        const context: SettingsPageContext = {
            id: "nbook.agent.status-line", layer: readonly(ref("user")) as Readonly<Ref<"user" | "project">>, projectTitle: readonly(ref(null)), writable: readonly(ref(writable)), options: {},
            dirty: () => undefined, reportWriteFailure: (subject) => void failures.push(subject), focus: readonly(ref(null)), takeFocus: () => null,
        };
        const Page = statusLinePage(StatusLinePage, {settings, items, writer, text: engine.port});
        const wrapper = mount(Page, {props: {context}, global: {provide: provideText(engine.port)}, attachTo: document.body});
        cleanup.push(() => wrapper.unmount());
        return {wrapper, settings, failures};
    }
    const rows = (side: "left" | "right") => [...document.body.querySelectorAll<HTMLElement>(`[data-sortable-section="${side}"] [data-status-row]`)].map((row) => row.dataset.statusRow);

    it("两组按解算的次序列全部项（含默认关的），勾选与上移下移写设置，边上的按钮停用；预览跟着变", async () => {
        const {settings} = mountPage();
        await flushPromises();
        expect(rows("left")).toEqual(["context"]);
        expect(rows("right")).toEqual(["usage", "cost", "model"]);
        const up = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-status-row="${id}"] [data-status-move-up]`)!;
        const down = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-status-row="${id}"] [data-status-move-down]`)!;
        // 只有左边第一项不能上移、右边最后一项不能下移：右边第一项上移到左边去。
        expect(up("context").disabled).toBe(true);
        expect(up("usage").disabled).toBe(false);
        expect(down("context").disabled).toBe(false);
        expect(down("model").disabled).toBe(true);

        down("usage").click();
        await waitUntil("次序写进设置", () => current(settings).order?.join() === "context,cost,usage,model");
        await flushPromises();
        expect(rows("right")).toEqual(["cost", "usage", "model"]);

        const model = document.body.querySelector<HTMLInputElement>('[data-status-row="model"] input[type="checkbox"]')!;
        model.click();
        await waitUntil("显隐写进设置", () => current(settings).visible?.model === true);
        await flushPromises();
        expect(document.body.querySelector("[data-status-line-preview] [data-status-model]")).not.toBeNull();
    });

    it("层写不了时勾选、按钮都停用", async () => {
        mountPage({}, false);
        await flushPromises();
        expect(document.body.querySelector<HTMLButtonElement>('[data-status-row="cost"] [data-status-move-down]')!.disabled).toBe(true);
        expect(document.body.querySelector<HTMLButtonElement>('[data-status-row="cost"] [data-status-move-up]')!.disabled).toBe(true);
        expect(document.body.querySelector<HTMLInputElement>('[data-status-row="cost"] input[type="checkbox"]')!.disabled).toBe(true);
    });

    it("拖动（键盘）把用量放到左边第一位：写进 side，写完之前次序留着，写完两组跟着设置", async () => {
        // happy-dom 没有 elementsFromPoint：拖动会话要找指针处最上层的元素，键盘一场里用不到它的结果。指针拖动在 lab-agent-ui.e2e.ts。
        Object.assign(document, {elementsFromPoint: () => []});
        const {settings} = mountPage();
        await flushPromises();
        const handle = document.body.querySelector<HTMLElement>('[data-sortable-key="usage"] [data-sortable-handle]')!;
        handle.focus();
        const press = (key: string): void => void handle.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
        press(" ");
        press("ArrowUp");
        press("ArrowUp");
        press("Enter");
        await flushPromises();
        expect(rows("left")).toEqual(["usage", "context"]);
        await waitUntil("换边写进设置", () => current(settings).side?.usage === "left");
        await flushPromises();
        expect(rows("left")).toEqual(["usage", "context"]);
        expect(rows("right")).toEqual(["cost", "model"]);
    });
});

describe("贡献点与接收者（contributions.md 输出 22）", () => {
    const descriptor = (patch: Partial<ContributionDescriptor> = {}): ContributionDescriptor => ({capability: "agent.statusItems", id: "x.words", plugin: "x", location: "browser", declaration: {title: "字数", side: "left"}, ...patch} as ContributionDescriptor);

    it("只接受浏览器入口的、形状对的声明", () => {
        expect(validateStatusItemContribution(descriptor())).toBeNull();
        expect(validateStatusItemContribution(descriptor({location: "server"}))).toContain("browser");
        expect(validateStatusItemContribution(descriptor({declaration: {title: "字数", side: "middle"}}))).toContain("invalid");
        expect(validateStatusItemContribution(descriptor({declaration: {title: "字数", side: "left", extra: 1}}))).toContain("invalid");
        expect(validateStatusItemContribution(descriptor({declaration: {side: "left"}}))).toContain("invalid");
    });

    it("发布后进目录与登记项，撤回后消失；设置里的显隐次序不动，回来时生效", async () => {
        const reports: string[] = [];
        const items = createStatusItems((message) => reports.push(message));
        const receiver = items.receiver();
        const handle = {capability: "agent.statusItems", id: "x.words", plugin: "x", entry: "browser", generation: 1, kind: "entry" as const, declaration: {title: "字数", side: "left" as const, defaultVisible: true}, published: true, implementation: () => ({load: async () => ({default: {render: () => null}})})};
        receiver.published?.(handle as never, undefined as never);
        expect(items.items.value.map((item) => [item.id, item.side, item.defaultVisible])).toEqual([["x.words", "left", true]]);
        expect(items.entries.value.map((entry) => entry.id)).toEqual(["x.words"]);

        const setting = {order: ["x.words", "context"], visible: {"x.words": false}};
        receiver.revoke?.(handle as never, undefined as never, "activation-stopped");
        expect(items.items.value).toEqual([]);
        expect(resolveStatusLine(statusCatalog(items), setting).left.map((item) => item.id)).toEqual(["context"]);
        receiver.published?.(handle as never, undefined as never);
        expect(resolveStatusLine(statusCatalog(items), setting).left.map((item) => [item.id, item.visible])).toEqual([["x.words", false], ["context", true]]);
        expect(reports).toEqual([]);

        receiver.published?.({...handle, id: "x.bad", implementation: () => ({})} as never, undefined as never);
        expect(reports[0]).toContain("x.bad");
    });
});
