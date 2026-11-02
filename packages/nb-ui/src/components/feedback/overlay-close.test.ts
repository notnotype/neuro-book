/**
 * 浮层的关闭合同（docs/ui-development-spec.md 的“浮层的打开与关闭”与各组件同名 .md）：每种关闭方式发对的
 * `request-close(reason)`，随后 `update:open(false)`；`Dialog` 的关不关只看 `closeOnRequest`，不看宿主挂了哪些监听；
 * 打开态受控，宿主不接 `update:open` 时浮层保持打开。
 *
 * 不适用的格子：`AlertDialog`、`Drawer` 由 reka 直接关闭，不发可拒绝的请求，也不发原因；`ContextMenu` 没有遮罩，
 * 它的 Tab 与选择在 ContextMenu.test.ts；`closed` 的真实时机（等退场动画）只能在浏览器里看，happy-dom 没有动画。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, ref} from "vue";

import Dialog from "./Dialog.vue";
import FloatingWindow from "./FloatingWindow.vue";
import ContextMenu from "../popup/ContextMenu.vue";
import QuickPick from "../popup/QuickPick.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function track<T extends {unmount(): void}>(wrapper: T): T {
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element>(selector: string): T => {
    const found = document.body.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

const buttonNamed = (name: string): HTMLButtonElement => {
    const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === name || button.textContent?.trim() === name);
    if (found === undefined) throw new Error(`没有名为 ${name} 的按钮`);
    return found;
};

function pressEscape(target: Element): void {
    target.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
}

function clickOverlay(): void {
    const overlay = query("[data-dialog-overlay]");
    overlay.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
    overlay.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, button: 0}));
}

const DIALOG_WAYS: ReadonlyArray<{reason: string; act: () => void}> = [
    {reason: "escape", act: () => pressEscape(query("[data-dialog-surface]"))},
    {reason: "outside", act: clickOverlay},
    {reason: "close-button", act: () => buttonNamed("关闭").click()},
    {reason: "cancel", act: () => buttonNamed("取消").click()},
];

/** 按发出的先后记下关闭相关的事件。 */
function mountDialog(props: Record<string, unknown> = {}) {
    const order: string[] = [];
    const wrapper = track(mount(Dialog, {
        props: {
            "open": true,
            "title": "改名",
            "closable": true,
            "showCancel": true,
            "onRequest-close": (reason: string) => order.push(`request-close:${reason}`),
            "onUpdate:open": (value: boolean) => order.push(`update:open:${String(value)}`),
            ...props,
        },
        attachTo: document.body,
    }));
    return {wrapper, order};
}

describe("Dialog 的关闭", () => {
    it.each(DIALOG_WAYS)("$reason：先发 request-close($reason)，再发 update:open(false)", async ({reason, act}) => {
        const {order} = mountDialog();
        await flushPromises();
        act();
        expect(order).toEqual([`request-close:${reason}`, "update:open:false"]);
    });

    it("没挂任何监听也照样发 update:open：行为不随监听变化", async () => {
        const wrapper = track(mount(Dialog, {props: {open: true, title: "改名"}, attachTo: document.body}));
        await flushPromises();
        clickOverlay();
        expect(wrapper.emitted("update:open")).toEqual([[false]]);
    });

    it.each(DIALOG_WAYS)("closeOnRequest=false：$reason 只发请求，不发 update:open", async ({reason, act}) => {
        const {order} = mountDialog({closeOnRequest: false});
        await flushPromises();
        act();
        expect(order).toEqual([`request-close:${reason}`]);
    });

    it("关掉之后发一次 closed", async () => {
        const {wrapper} = mountDialog();
        await flushPromises();
        await wrapper.setProps({open: false});
        await vi.waitFor(() => expect(wrapper.emitted("closed")).toEqual([[]]));
    });

    it("确认按钮只发 confirm，不关闭", async () => {
        const {wrapper} = mountDialog();
        await flushPromises();
        buttonNamed("确认").click();
        expect(wrapper.emitted("confirm")).toEqual([[]]);
        expect(wrapper.emitted("update:open")).toBeUndefined();
    });

    it("受控：宿主不接 update:open 时，关闭请求之后对话框还开着", async () => {
        const Host = defineComponent({setup: () => () => h(Dialog, {open: true, title: "改名"})});
        track(mount(Host, {attachTo: document.body}));
        await flushPromises();
        pressEscape(query("[data-dialog-surface]"));
        await flushPromises();
        expect(document.body.querySelector("[data-dialog-surface]")).not.toBeNull();
    });
});

const WINDOW_WAYS: ReadonlyArray<{reason: string; act: () => void}> = [
    {reason: "escape", act: () => pressEscape(query("[data-dialog-surface]"))},
    {reason: "close-button", act: () => buttonNamed("关闭").click()},
    {reason: "cancel", act: () => buttonNamed("取消").click()},
];

function mountWindow(props: Record<string, unknown> = {}) {
    const order: string[] = [];
    const wrapper = track(mount(FloatingWindow, {
        props: {
            "open": true,
            "title": "素材",
            "closable": true,
            "showCancel": true,
            "teleportTarget": false,
            "onRequest-close": (reason: string) => order.push(`request-close:${reason}`),
            "onUpdate:open": (value: boolean) => order.push(`update:open:${String(value)}`),
            ...props,
        },
        slots: {default: () => h("input", {"data-window-input": ""})},
        attachTo: document.body,
    }));
    return {wrapper, order};
}

describe("FloatingWindow 的关闭", () => {
    it.each(WINDOW_WAYS)("$reason：先发 request-close($reason)，再发 update:open(false)", async ({reason, act}) => {
        const {order} = mountWindow();
        await flushPromises();
        act();
        expect(order).toEqual([`request-close:${reason}`, "update:open:false"]);
    });

    it.each(WINDOW_WAYS)("closeOnRequest=false：$reason 只发请求", async ({reason, act}) => {
        const {order} = mountWindow({closeOnRequest: false});
        await flushPromises();
        act();
        expect(order).toEqual([`request-close:${reason}`]);
    });

    it("busy 时关闭与确认都不发", async () => {
        const {wrapper, order} = mountWindow({busy: true});
        await flushPromises();
        pressEscape(query("[data-dialog-surface]"));
        buttonNamed("确认").click();
        expect(order).toEqual([]);
        expect(wrapper.emitted("confirm")).toBeUndefined();
    });

    it("点窗口外面不关", async () => {
        const {order} = mountWindow();
        await flushPromises();
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
        expect(order).toEqual([]);
    });

    it("关掉之后发一次 closed", async () => {
        const {wrapper} = mountWindow();
        await flushPromises();
        await wrapper.setProps({open: false});
        await vi.waitFor(() => expect(wrapper.emitted("closed")).toEqual([[]]));
    });

    it("initialFocus 按选择器给初始焦点", async () => {
        mountWindow({initialFocus: "[data-window-input]"});
        await flushPromises();
        await vi.waitFor(() => expect(document.activeElement).toBe(query("[data-window-input]")));
    });

    it("一级窗口不画二级的面；窗口里开的窗口画", async () => {
        const Host = defineComponent({
            setup: () => () => h(FloatingWindow, {open: true, title: "外层", teleportTarget: false, "data-outer": ""}, () => h(FloatingWindow, {open: true, title: "内层", teleportTarget: false, "data-inner": ""})),
        });
        track(mount(Host, {attachTo: document.body}));
        await flushPromises();
        expect(query("[data-outer]").classList.contains("nb-ui-dialog-surface--nested")).toBe(false);
        expect(query("[data-inner]").classList.contains("nb-ui-dialog-surface--nested")).toBe(true);
    });
});

describe("ContextMenu 的关闭", () => {
    it.each([
        {reason: "escape", act: () => document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))},
        {reason: "outside", act: () => document.body.dispatchEvent(new MouseEvent("click", {bubbles: true}))},
    ])("$reason：先发 request-close($reason)，再发 update:open(false)；关掉之后发 closed", async ({reason, act}) => {
        const open = ref(true);
        const Host = defineComponent({
            setup: () => () => h(ContextMenu, {
                "open": open.value,
                "x": 10,
                "y": 10,
                "items": [{label: "新建"}],
                "onUpdate:open": (value: boolean) => {
                    open.value = value;
                },
            }),
        });
        // 用真的 Transition（测试库缺省把它换成桩）：closed 要等离场过渡结束才发。
        const wrapper = track(mount(Host, {attachTo: document.body, global: {stubs: {transition: false}}}));
        await flushPromises();
        act();
        await flushPromises();
        const menu = wrapper.findComponent(ContextMenu);
        expect(menu.emitted("request-close")).toEqual([[reason]]);
        expect(menu.emitted("update:open")).toEqual([[false]]);
        await vi.waitFor(() => expect(menu.emitted("closed")).toEqual([[]]));
    });
});

describe("QuickPick 的关闭", () => {
    it("escape：先发 request-close(escape)，再发 update:open(false)", async () => {
        const order: string[] = [];
        track(mount(QuickPick, {
            props: {
                "open": true,
                "query": "",
                "items": [{id: "a", label: "打开"}],
                "activeId": "a",
                "title": "命令",
                "placeholder": "输入命令",
                "emptyText": "没有匹配的命令",
                "onRequest-close": (reason: string) => order.push(`request-close:${reason}`),
                "onUpdate:open": (value: boolean) => order.push(`update:open:${String(value)}`),
            },
            attachTo: document.body,
        }));
        await flushPromises();
        query("input").dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        expect(order).toEqual(["request-close:escape", "update:open:false"]);
    });
});
