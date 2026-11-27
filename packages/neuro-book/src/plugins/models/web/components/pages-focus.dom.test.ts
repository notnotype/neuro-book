/**
 * 两页按打开时的 `focus` 定位（docs/specs/models/settings-pages.md 输出 18）：数据到了才取走；角色页滚到那个角色、聚焦它的模型选择框；
 * 服务商页的服务商 id 选中这家、聚焦密钥框，`add` 打开添加窗口；认不出的取走后不动。数据经 Lab 场景同一份假远端（`fake-remote.ts`）。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {ref} from "vue";

import {createFakeModelsRemote} from "nbook/plugins/models/web/lab/fake-remote";
import {SAMPLE_SNAPSHOT} from "nbook/plugins/models/web/lab/sample";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {MODELS_TEXT_NAMESPACE} from "../../shared/text";
import {createModelsStore} from "../models-store";
import {modelsCatalogs} from "../text";
import ProvidersPage from "./ProvidersPage.vue";
import RolesPage from "./RolesPage.vue";

const global = {provide: provideText(testTextPort("zh-CN", {[MODELS_TEXT_NAMESPACE]: modelsCatalogs}))};

const mounted: Array<{unmount(): void}> = [];
const stores: Array<{dispose(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    for (const store of stores.splice(0)) store.dispose();
    document.body.innerHTML = "";
});

/** 像设置窗口那样：等着的定位是一个值，取走即清空。 */
function pending(initial: string | null) {
    const focus = ref<string | null>(initial);
    const takeFocus = (): string | null => {
        const value = focus.value;
        focus.value = null;
        return value;
    };
    return {focus, takeFocus};
}

function render(page: typeof RolesPage | typeof ProvidersPage, focus: ReturnType<typeof pending>) {
    const store = createModelsStore(createFakeModelsRemote(SAMPLE_SNAPSHOT).remote);
    stores.push(store);
    const wrapper = mount(page, {
        global,
        props: {store, writable: true, reportWriteFailure: () => undefined, focus: focus.focus.value, takeFocus: focus.takeFocus},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

describe("打开设置时定位", () => {
    it("角色页：角色列表到了才取走，焦点落在那个角色的模型选择框上", async () => {
        const focus = pending("main");
        render(RolesPage, focus);
        await waitUntil("定位完", () => document.activeElement?.closest("[data-role-row]")?.getAttribute("data-role-row") === "main", {timeoutMs: 10_000});
        expect(focus.focus.value).toBeNull();
        // 行里有图标按钮、思考档下拉之后焦点仍在模型下拉上，不依赖控件的先后。
        expect(document.activeElement?.closest("[data-role-model]")).not.toBeNull();
    });

    it("角色页：认不出的角色取走后不动焦点", async () => {
        const focus = pending("nowhere");
        render(RolesPage, focus);
        await waitUntil("取走", () => focus.focus.value === null, {timeoutMs: 10_000});
        await flushPromises();
        expect(document.activeElement?.closest("[data-role-row]") ?? null).toBeNull();
    });

    it("服务商页：服务商 id 选中这家并聚焦密钥框", async () => {
        const focus = pending("openai");
        render(ProvidersPage, focus);
        await waitUntil("聚焦密钥框", () => document.activeElement?.closest("[data-key-input]") !== null && document.activeElement?.closest("[data-key-input]") !== undefined, {timeoutMs: 10_000});
        expect(document.querySelector("[data-provider-rail-item='openai']")?.getAttribute("aria-current")).toBe("page");
    });

    it("服务商页：add 打开添加窗口", async () => {
        const focus = pending("add");
        render(ProvidersPage, focus);
        await waitUntil("添加窗口", () => document.querySelector("[role='dialog']") !== null, {timeoutMs: 10_000});
    });
});
