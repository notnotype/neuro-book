/**
 * useSashGesture 的根元素（模块头“根元素换掉即注销，重挂不会留下重复监听”）：根换成别的元素、置空之后，挂上时的那个元素上不留监听；
 * 根在别的窗口里（iframe）时，窗口级的监听挂在那个窗口与文档上，也从那里摘。
 * 真的手势要排版与命中，在 Lab 的分隔线 e2e 里；这里只看监听的挂与摘，目标上记下增删的监听。
 */
import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h, nextTick, shallowRef} from "vue";
import type {ShallowRef} from "vue";

import {useSashGesture} from "./useSashGesture";
import type {SashGestureScope} from "./useSashGesture";

/** 目标上此刻挂着的监听（类型加是否捕获）。 */
function tracked(element: EventTarget): Set<string> {
    const live = new Set<string>();
    const keyOf = (type: string, options?: boolean | AddEventListenerOptions): string => `${type}:${String(typeof options === "boolean" ? options : options?.capture === true)}`;
    const add = element.addEventListener.bind(element);
    const remove = element.removeEventListener.bind(element);
    element.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        live.add(keyOf(type, options));
        add(type, listener, options);
    }) as typeof element.addEventListener;
    element.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        live.delete(keyOf(type, options as boolean | AddEventListenerOptions | undefined));
        remove(type, listener, options);
    }) as typeof element.removeEventListener;
    return live;
}

function host(root: ShallowRef<HTMLElement | null>): {scope: () => SashGestureScope} {
    let scope: SashGestureScope | null = null;
    mount(defineComponent({
        setup() {
            scope = useSashGesture({host: () => null, root});
            return () => h("div");
        },
    }));
    return {scope: () => scope!};
}

describe("useSashGesture 的根元素", () => {
    it("根从 A 换成 B：A 上的监听全部摘掉，B 上挂好；根置空之后 dispose，B 上也不留", async () => {
        const [a, b] = [document.createElement("div"), document.createElement("div")];
        const [onA, onB] = [tracked(a), tracked(b)];
        const root = shallowRef<HTMLElement | null>(a);
        const {scope} = host(root);
        expect(onA.size).toBeGreaterThan(0);
        root.value = b;
        await nextTick();
        expect([...onA]).toEqual([]);
        expect(onB.size).toBeGreaterThan(0);
        root.value = null;
        await nextTick();
        scope().dispose();
        expect([...onB]).toEqual([]);
    });

    it("根在 iframe 的文档里：窗口级的监听挂在 iframe 的窗口与文档上，根置空后从那里摘掉", async () => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const frameWindow = frame.contentWindow!;
        const frameDocument = frame.contentDocument!;
        const element = frameDocument.createElement("div");
        frameDocument.body.append(element);
        const [onWindow, onDocument] = [tracked(frameWindow), tracked(frameDocument)];
        const root = shallowRef<HTMLElement | null>(element);
        host(root);
        expect(onWindow.size).toBeGreaterThan(0);
        expect(onDocument.size).toBeGreaterThan(0);
        root.value = null;
        await nextTick();
        expect([...onWindow, ...onDocument]).toEqual([]);
        frame.remove();
    });
});
