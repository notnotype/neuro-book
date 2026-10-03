// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, ref, type Ref, type Slots} from "vue";
import {mount, type VueWrapper} from "@vue/test-utils";
import NotificationViewport from "nbook/app/components/common/NotificationViewport.vue";
import {markTitleBarPresent} from "nbook/app/composables/useTitleBarPresent";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";

/**
 * 通知视口的让位：**按标题栏是否真的在场**，不是按 bridge 标志。
 * 浏览器档（无 bridge）也有 36px 标题栏——让位量不跟着，toast 会从 y=16 起画并压住标题栏右侧按钮。
 */

const mounted: VueWrapper[] = [];

/** `useNotification` 走 Nuxt 的 `useState`（自动导入）；vitest 不跑 Nuxt，这里补一个同语义替身。 */
beforeEach(() => {
    const states: Record<string, Ref<unknown>> = {};
    vi.stubGlobal("useState", <T>(key: string, init: () => T): Ref<T> => {
        const existing = states[key];
        if (existing !== undefined) return existing as Ref<T>;
        const created = ref(init()) as Ref<T>;
        states[key] = created as Ref<unknown>;
        return created;
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    markTitleBarPresent(false);
    vi.unstubAllGlobals();
});

/** `ClientOnly` 是 Nuxt 内建组件，vitest 里给一个直通替身。 */
const ClientOnlyStub = defineComponent({
    setup(_props, {slots}: {slots: Slots}) {
        return () => slots.default?.();
    },
});

function mountViewport(titlebar: boolean): VueWrapper {
    const wrapper = mount(NotificationViewport, {
        props: {titlebar},
        global: {stubs: {ClientOnly: ClientOnlyStub}},
    });
    mounted.push(wrapper);
    return wrapper;
}

describe("NotificationViewport", () => {
    it("标题栏在场时让出标题栏那一档高度，不在场时不占位", () => {
        const withTitlebar = mountViewport(true);
        expect(withTitlebar.get(".pointer-events-none.fixed").attributes("style"))
            .toContain(`top: ${String(SHELL_TITLEBAR_HEIGHT)}px`);

        const withoutTitlebar = mountViewport(false);
        expect(withoutTitlebar.get(".pointer-events-none.fixed").attributes("style") ?? "")
            .not.toContain("top:");
    });

    it("浏览器档（无 bridge、但有标题栏）同样让位：让位量只看在场事实", () => {
        // 切片 5 的真相源是标题栏组件的挂载事实；浏览器没有 bridge 也登记为在场。
        markTitleBarPresent(true);
        const wrapper = mountViewport(true);
        expect(wrapper.get(".pointer-events-none.fixed").attributes("style"))
            .toContain(`top: ${String(SHELL_TITLEBAR_HEIGHT)}px`);
    });
});
