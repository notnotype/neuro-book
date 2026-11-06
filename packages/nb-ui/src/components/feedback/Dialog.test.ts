/**
 * Dialog 的模态用法（同名 .md）：点遮罩与 Esc 的关闭判定、同时打开的模态按打开顺序叠放、内容里的浮层压在对话框之上、
 * 初始焦点与关闭后的焦点归还。浮动窗口用法的拖动与缩放在 components.test.ts。
 *
 * 层级断言读的是行内 z-index：happy-dom 不排版，“谁盖住谁”在产品页的 e2e（bookshelf.e2e.ts）里看。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";

import Dialog from "./Dialog.vue";
import {captureDialogOrigin} from "./dialog-origin";
import Select from "../popup/Select.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    captureDialogOrigin();
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function track<T extends {unmount(): void}>(wrapper: T): T {
    mounted.push(wrapper);
    return wrapper;
}

const query = <T extends Element>(selector: string, root: ParentNode = document.body): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};

function press(target: Element, type: "pointerdown" | "pointerup", button = 0): void {
    target.dispatchEvent(new PointerEvent(type, {bubbles: true, button}));
}

function escape(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true, ...init});
    target.dispatchEvent(event);
    return event;
}

const zIndexOf = (element: Element): number => Number((element as HTMLElement).style.zIndex);

/** 两个受控的模态对话框，由外部决定开关；`second` 在 DOM 里排在 `first` 前面。 */
const TwoDialogs = defineComponent({
    setup() {
        const first = ref(false);
        const second = ref(false);
        const reasons = ref<string[]>([]);
        return {first, second, reasons};
    },
    render() {
        return h("div", [
            h(Dialog, {
                "open": this.second,
                "title": "第二层",
                "showFooter": false,
                "data-second": "",
                "onRequest-close": (reason: string) => {
                    this.reasons.push(`second:${reason}`);
                    this.second = false;
                },
            }, () => h("input", {"data-second-input": ""})),
            h(Dialog, {
                "open": this.first,
                "title": "第一层",
                "showFooter": false,
                "data-first": "",
                "onRequest-close": (reason: string) => {
                    this.reasons.push(`first:${reason}`);
                    this.first = false;
                },
            }, () => h("input", {"data-first-input": ""})),
        ]);
    },
});

describe("Dialog（模态）", () => {
    it("遮罩上按下并松开同一个键才请求关闭；从面板里按下拖到遮罩松开不算；closeOnOverlay=false 时不关", async () => {
        const wrapper = track(mount(Dialog, {props: {"open": true, "title": "移除作品", "onRequest-close": () => undefined}, attachTo: document.body}));
        await flushPromises();
        const overlay = query("[data-dialog-overlay]");
        expect(query("[data-dialog-surface]").getAttribute("aria-modal")).toBe("true");

        press(query("[data-dialog-surface]"), "pointerdown");
        press(overlay, "pointerup");
        press(overlay, "pointerdown", 0);
        press(overlay, "pointerup", 2);
        expect(wrapper.emitted("request-close")).toBeUndefined();

        press(overlay, "pointerdown");
        press(overlay, "pointerup");
        expect(wrapper.emitted("request-close")).toEqual([["outside"]]);

        await wrapper.setProps({closeOnOverlay: false});
        press(overlay, "pointerdown");
        press(overlay, "pointerup");
        expect(wrapper.emitted("request-close")).toHaveLength(1);
    });

    it("对话框里开着下拉时，点遮罩只关下拉，不关对话框；下拉压在对话框之上", async () => {
        const wrapper = track(mount(Dialog, {
            props: {"open": true, "title": "体裁", "onRequest-close": () => undefined},
            slots: {default: () => h(Select, {modelValue: "novel", options: [{label: "长篇", value: "novel"}, {label: "短篇", value: "stories"}]})},
            attachTo: document.body,
        }));
        await flushPromises();
        query<HTMLElement>("[role='combobox']").dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        const menu = query(".nb-ui-menu-surface");
        expect(zIndexOf(menu)).toBeGreaterThan(zIndexOf(query("[data-dialog-surface]")));

        const overlay = query("[data-dialog-overlay]");
        press(overlay, "pointerdown");
        press(overlay, "pointerup");
        expect(wrapper.emitted("request-close")).toBeUndefined();
    });

    it("Esc 请求关闭；输入法组字时、内层控件已经处理过的 Esc、closeOnEsc=false 时都不关", async () => {
        const wrapper = track(mount(Dialog, {
            props: {"open": true, "title": "改名", "onRequest-close": () => undefined},
            slots: {
                default: () => [
                    h("input", {"data-plain": ""}),
                    h("input", {"data-handles-esc": "", "onKeydown": (event: KeyboardEvent) => event.key === "Escape" && event.preventDefault()}),
                ],
            },
            attachTo: document.body,
        }));
        await flushPromises();
        const plain = query("[data-plain]");

        escape(plain, {isComposing: true});
        escape(query("[data-handles-esc]"));
        expect(wrapper.emitted("request-close")).toBeUndefined();

        escape(plain);
        expect(wrapper.emitted("request-close")).toEqual([["escape"]]);

        await wrapper.setProps({closeOnEsc: false});
        escape(plain);
        expect(wrapper.emitted("request-close")).toHaveLength(1);
    });

    it("后打开的叠在上面（与 DOM 顺序无关）；Esc 与点遮罩只关最上层；关掉后再开的排回顶上", async () => {
        const wrapper = track(mount(TwoDialogs, {attachTo: document.body}));
        const vm = wrapper.vm as unknown as {first: boolean; second: boolean; reasons: string[]};
        vm.first = true;
        await flushPromises();
        vm.second = true;
        await flushPromises();

        const first = query("[data-first]");
        const second = query("[data-second]");
        expect(zIndexOf(second)).toBeGreaterThan(zIndexOf(first));
        const overlays = [...document.querySelectorAll("[data-dialog-overlay]")];
        expect(overlays.map(zIndexOf).sort((a, b) => a - b)).toEqual([zIndexOf(first), zIndexOf(second)]);

        escape(query("[data-second-input]"));
        await flushPromises();
        expect(vm.reasons).toEqual(["second:escape"]);
        expect(vm.first).toBe(true);

        vm.second = true;
        await flushPromises();
        expect(zIndexOf(query("[data-second]"))).toBeGreaterThan(zIndexOf(query("[data-first]")));
        const topOverlay = [...document.querySelectorAll("[data-dialog-overlay]")].reduce((top, overlay) => (zIndexOf(overlay) > zIndexOf(top) ? overlay : top));
        press(topOverlay, "pointerdown");
        press(topOverlay, "pointerup");
        await flushPromises();
        expect(vm.reasons).toEqual(["second:escape", "second:outside"]);
        expect(vm.first).toBe(true);
    });

    it("页脚状态行：按钮靠右的尺寸一直留着，平时是 status 插槽，status 非空时换成错误；按钮平分整行的尺寸没有", async () => {
        const wrapper = track(mount(Dialog, {
            props: {open: true, title: "选择目录", size: "md"},
            slots: {status: () => "已选 Documents"},
            attachTo: document.body,
        }));
        await flushPromises();
        const status = query("[data-dialog-status]");
        expect(status.textContent).toBe("已选 Documents");
        expect(status.hasAttribute("data-dialog-status-error")).toBe(false);

        await wrapper.setProps({status: "没有加入书架：路径无效"});
        expect(query("[data-dialog-status]")).toBe(status);
        expect(status.textContent).toBe("没有加入书架：路径无效");
        expect(status.hasAttribute("data-dialog-status-error")).toBe(true);
        expect(status.getAttribute("aria-live")).toBe("polite");

        await wrapper.setProps({size: "sm"});
        expect(document.body.querySelector("[data-dialog-status]")).toBeNull();
    });

    it("初始焦点：按 initialFocus 找；找不到时聚焦面板；不给时是第一个可聚焦元素", async () => {
        const body = () => [h("button", {"data-a": ""}, "甲"), h("input", {"data-b": ""})];
        const open = async (initialFocus?: string): Promise<void> => {
            track(mount(Dialog, {props: {open: true, title: "焦点", showFooter: false, initialFocus}, slots: {default: body}, attachTo: document.body}));
            await flushPromises();
        };

        await open("[data-b]");
        expect(document.activeElement).toBe(query("[data-b]"));
        mounted.splice(0).forEach((entry) => entry.unmount());

        await open("[data-missing]");
        expect(document.activeElement).toBe(query("[data-dialog-surface]"));
        mounted.splice(0).forEach((entry) => entry.unmount());

        await open();
        expect(document.activeElement).toBe(query("[data-a]"));
    });

    it("关闭后焦点回到打开它的元素", async () => {
        const Host = defineComponent({
            setup() {
                const open = ref(false);
                return {open};
            },
            render() {
                return h("div", [
                    h("button", {"data-opener": "", "onClick": () => {
                        this.open = true;
                    }}, "打开"),
                    h(Dialog, {"open": this.open, "title": "确认", "onUpdate:open": (value: boolean) => {
                        this.open = value;
                    }}, () => h("input")),
                ]);
            },
        });
        track(mount(Host, {attachTo: document.body}));
        const opener = query<HTMLButtonElement>("[data-opener]");
        opener.focus();
        opener.click();
        await flushPromises();
        expect(document.activeElement).not.toBe(opener);

        escape(document.activeElement ?? document.body);
        await flushPromises();
        await nextTick();
        expect(document.body.querySelector("[data-dialog-surface]")).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    describe("从触发点展开", () => {
        const fromOffset = (): {x: number; y: number; scale: string} => {
            const style = query<HTMLElement>("[data-dialog-surface]").style;
            return {x: Number.parseFloat(style.getPropertyValue("--nb-dialog-from-x") || "0"), y: Number.parseFloat(style.getPropertyValue("--nb-dialog-from-y") || "0"), scale: style.getPropertyValue("--nb-dialog-from-scale")};
        };

        const Host = defineComponent({
            setup() {
                const open = ref(false);
                return {open};
            },
            render() {
                return h("div", [
                    h("button", {"data-opener": "", "onClick": () => {
                        this.open = true;
                    }}, "打开"),
                    h(Dialog, {"open": this.open, "title": "确认", "onUpdate:open": (value: boolean) => {
                        this.open = value;
                    }}, () => h("input")),
                ]);
            },
        });

        it("点按钮打开时面朝按下的位置偏一小段，起始缩放更小", async () => {
            track(mount(Host, {attachTo: document.body}));
            const opener = query<HTMLButtonElement>("[data-opener]");
            // happy-dom 不排版，面的矩形是零，中心在 (0, 0)：触发点在 (200, -300)
            opener.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 200, clientY: -300}));
            opener.click();
            await flushPromises();
            const offset = fromOffset();
            expect(offset.x).toBeGreaterThan(0);
            expect(offset.y).toBeLessThan(0);
            expect(Math.abs(offset.x)).toBeLessThan(200);
            expect(Number(offset.scale)).toBeLessThan(0.96);
        });

        it("没有按下、焦点也不在按钮上时（程序打开）原地展开，不写位移", async () => {
            const wrapper = track(mount(Dialog, {props: {open: false, title: "确认"}, attachTo: document.body}));
            await wrapper.setProps({open: true});
            await flushPromises();
            expect(fromOffset()).toEqual({x: 0, y: 0, scale: ""});
        });
    });
});
