/**
 * 探针：宿主用「等值但新身份」的 panels 数组重渲染时，进行中的手势会不会被判为 context-changed。
 *
 * 运行方式（本文件是给审查用的副本，`./Splitter.vue` 只有在同目录才解析得到）：
 *   cp .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t39-splitter-review/evidences/probe-eager-context-cancel.test.ts \
 *      packages/nb-ui/src/components/layout/
 *   bun run --cwd packages/nb-ui vitest run src/components/layout/probe-eager-context-cancel.test.ts --disable-console-intercept
 *   跑完删除 packages/nb-ui/src/components/layout/probe-eager-context-cancel.test.ts
 */
import {afterEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref, type Component} from "vue";
import Splitter from "./Splitter.vue";

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

function rect(left: number, width: number): DOMRect {
    return {
        x: left, y: 0, top: 0, left, right: left + width, bottom: 600,
        width, height: 600, toJSON: () => ({}),
    } as DOMRect;
}

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

const hostTick = ref(0);

/** 每次宿主渲染都新建一个等值 panels 数组（模板内联字面量的等价写法） */
const Host = defineComponent({
    render: () => h("div", [
        h("span", String(hostTick.value)),
        h(Splitter, {
            panels: [
                {id: "outline", defaultSize: 28},
                {id: "editor", defaultSize: 52},
                {id: "inspector", defaultSize: 20},
            ],
        }),
    ]),
});

/** 对照组：panels 用稳定数组（模块级常量 / ref），宿主重渲染不应影响手势 */
const STABLE_PANELS = [
    {id: "outline", defaultSize: 28},
    {id: "editor", defaultSize: 52},
    {id: "inspector", defaultSize: 20},
];
const StableHost = defineComponent({
    render: () => h("div", [
        h("span", String(hostTick.value)),
        h(Splitter, {panels: STABLE_PANELS}),
    ]),
});

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) if (wrapper.exists()) wrapper.unmount();
    for (const container of containers.splice(0)) container.remove();
    vi.restoreAllMocks();
});

/** 拖到一半时让宿主重渲染一次（约束值不变），再松手 */
async function dragAcrossHostRerender(host: Component, label: string): Promise<void> {
    const wrapper = mount(host, {attachTo: attachContainer()});
    wrappers.push(wrapper);
    await nextTick();

    const splitter = wrapper.findComponent(Splitter);
    const handles = splitter.findAll("[data-panel-resize-handle-id]").map((node) => node.element as HTMLElement);
    const metrics = new Map<Element, DOMRect>();
    metrics.set(splitter.find("[data-panel-group]").element, rect(0, 1000));
    handles.forEach((sash, index) => metrics.set(sash, rect(400 + index * 200, 1)));
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        return metrics.get(this) ?? rect(0, 0);
    });

    handles[0]!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: 400, clientY: 10}));
    document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 450, clientY: 10}));
    await nextTick();

    hostTick.value += 1;
    await nextTick();

    document.body.dispatchEvent(new MouseEvent("mousemove", {bubbles: true, clientX: 470, clientY: 10}));
    window.dispatchEvent(new MouseEvent("mouseup", {clientX: 470, clientY: 10}));
    await nextTick();

    console.log(label, "cancel", JSON.stringify(splitter.emitted("gesture-cancel")),
        "end", JSON.stringify(splitter.emitted("gesture-end")));
}

describe("探针：宿主等值重渲染 vs 进行中手势", () => {
    it("渲染期间重建等值 panels 数组", async () => {
        await dragAcrossHostRerender(Host, "P1 inline-array");
        expect(true).toBe(true);
    });

    it("对照组：panels 是稳定数组", async () => {
        await dragAcrossHostRerender(StableHost, "P1b stable-array");
        expect(true).toBe(true);
    });
});
