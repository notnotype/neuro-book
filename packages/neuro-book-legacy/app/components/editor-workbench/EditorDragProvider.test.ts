// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref} from "vue";
import {DragDropProvider} from "@dnd-kit/vue";
import type {DragDropManager} from "@dnd-kit/dom";
import EditorDragProvider from "./EditorDragProvider.vue";
import EditorTabBar from "./EditorTabBar.vue";
import {useEditorTabDrag} from "./useEditorTabDrag";
import type {EditorTabPresentation} from "./editor-view.types";


vi.hoisted(() => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
// jsdom只补布局/命中，不mock manager、session、碰撞检测器、resolver或真实组件。
const mounted: VueWrapper[] = [];
const tab = (path: string, pinned = false): EditorTabPresentation => ({path, title: path, pinned, preview: false, dirty: false, iconClass: "i-lucide-file-text"});
let hit: Element | null = null;
let resizeCallbacks: {callback: ResizeObserverCallback; elements: Set<Element>}[] = [];
const Content = defineComponent({
    props: {groupId: {type: String, required: true}},
    setup(props) {
        const element = ref<HTMLElement | null>(null);
        useEditorTabDrag()!.registerTarget(`content:${props.groupId}`, {kind: "content", groupId: props.groupId, element: () => element.value});
        return () => h("div", {ref: element, "data-content": props.groupId});
    },
});
function rect(element: Element, left: number, top: number, width: number, height: number): void {
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => new DOMRect(left, top, width, height));
    for (const [name, value] of Object.entries({clientWidth: width, clientHeight: height, offsetWidth: width, offsetHeight: height})) {
        Object.defineProperty(element, name, {configurable: true, value});
    }
}
async function settle(): Promise<void> {
    await nextTick();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await nextTick();
}
beforeEach(() => {
    hit = null;
    resizeCallbacks = [];
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    vi.stubGlobal("ResizeObserver", class {
        readonly elements = new Set<Element>();
        constructor(callback: ResizeObserverCallback) { resizeCallbacks.push({callback, elements: this.elements}); }
        observe(element: Element) { this.elements.add(element); }
        unobserve(element: Element) { this.elements.delete(element); }
        disconnect() { this.elements.clear(); }
    });
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}}));
    Object.defineProperty(Element.prototype, "setPointerCapture", {configurable: true, value: () => {}});
    Object.defineProperty(Element.prototype, "releasePointerCapture", {configurable: true, value: () => {}});
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(document.documentElement, "clientWidth", {configurable: true, value: 1200});
    Object.defineProperty(document.documentElement, "clientHeight", {configurable: true, value: 800});
    Object.defineProperty(document, "elementsFromPoint", {configurable: true, value: () => hit ? [hit] : []});
    Object.defineProperty(document, "elementFromPoint", {configurable: true, value: () => hit});
    Object.defineProperty(document, "getAnimations", {configurable: true, value: () => []});
    Object.defineProperty(Element.prototype, "getAnimations", {configurable: true, value: () => []});
});
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});
async function setup(wrap = false, sidePinned = false) {
    const wrapped = ref(wrap);
    const groups = [{id: "main", tabs: [tab("A"), tab("B"), tab("C")]}, {id: "side", tabs: [tab("D", sidePinned)]}];
    const wrapper = mount(EditorDragProvider, {
        props: {groups, allowSplit: true, contextKey: "one"}, attachTo: document.body,
        slots: {default: () => groups.flatMap(group => [h(EditorTabBar, {tabs: group.tabs, activePath: group.tabs[0]!.path, groupId: group.id, wrap: wrapped.value}), h(Content, {groupId: group.id})])},
    });
    mounted.push(wrapper);
    await nextTick();
    for (const [index, bar] of wrapper.findAllComponents(EditorTabBar).entries()) {
        const y = index * 400;
        rect(bar.element, 0, y, 500, 36);
        rect(bar.get('[role="tablist"][aria-label="editorWorkbench.regularTabs"]').element, 0, y, 500, 36);
        for (const [i, item] of bar.findAll('[data-role="editor-tab-item"]').entries()) {
            rect(item.element, i * 104, y + 4, 100, 28);
            rect(item.get('[role="tab"]').element, i * 104, y + 4, 80, 28);
        }
        rect(wrapper.get(`[data-content="${groups[index]!.id}"]`).element, 0, y + 40, 500, 300);
    }
    const manager = wrapper.findComponent(DragDropProvider).props("manager") as DragDropManager;
    const source = Array.from(manager.registry.draggables).find(item => item.data.path === "A")!;
    async function start() {
        manager.actions.start({source, coordinates: {x: 30, y: 20}});
        await settle();
    }
    async function move(x: number, y: number, target: Element) {
        hit = target;
        manager.actions.move({to: {x, y}});
        await settle();
    }
    return {wrapper, manager, source, start, move, wrapped};
}

describe("EditorDragProvider", () => {
    it("拖动保留原标签和固定布局，不新增占位，取消后仍可再次拖动", async () => {
        const {manager, source, start} = await setup();
        const element = source.element!;
        for (let attempt = 0; attempt < 2; attempt++) {
            await start();
            expect(getComputedStyle(element).opacity).not.toBe("0");
            expect(document.querySelector('[data-dnd-placeholder]')).toBeNull();
            expect(document.querySelector('.editor-pinned-tabs')).toBeNull();
            expect(document.querySelector('[data-dnd-overlay]')?.textContent).toBe("A");
            manager.actions.stop({canceled: true});
            await settle();
            expect(getComputedStyle(element).opacity).not.toBe("0");
            expect(document.querySelector('[data-dnd-overlay][data-dnd-dragging]')).toBeNull();
        }
    });
    it("鼠标按下不即刻起拖，超过门槛后经传感器释放提交；关闭按钮不启动", async () => {
        const {wrapper, manager, source} = await setup();
        const pointer = (type: string, x: number) => new PointerEvent(type, {pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: 20, bubbles: true, cancelable: true});
        const handle = source.handle!;
        hit = handle;
        handle.dispatchEvent(pointer("pointerdown", 30));
        document.dispatchEvent(pointer("pointermove", 35));
        await settle();
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        document.dispatchEvent(pointer("pointermove", 40));
        await settle();
        hit = wrapper.findAllComponents(EditorTabBar)[0]!.get('.editor-regular-tabs').element;
        document.dispatchEvent(pointer("pointermove", 206));
        await settle();
        expect(document.querySelector('[data-editor-drop-feedback] [data-drop-feedback-line]')).not.toBeNull();
        document.dispatchEvent(pointer("pointerup", 206));
        await settle();
        expect(wrapper.emitted("move-tab")).toEqual([["main", "A", "C", false, "before"]]);
        const close = wrapper.get('.editor-tab-close').element;
        close.dispatchEvent(pointer("pointerdown", 30));
        document.dispatchEvent(pointer("pointermove", 206));
        await settle();
        expect(manager.dragOperation.status.idle).toBe(true);
        document.dispatchEvent(pointer("pointerup", 206));
    });

    it("普通Space保留选中，Ctrl+Space启动键盘拖动，Escape清理", async () => {
        const {wrapper, source, manager} = await setup();
        const handle = source.handle! as HTMLElement;
        handle.focus();
        handle.dispatchEvent(new KeyboardEvent("keydown", {key: " ", code: "Space", bubbles: true, cancelable: true}));
        await settle();
        expect(manager.dragOperation.status.idle).toBe(true);
        handle.dispatchEvent(new KeyboardEvent("keydown", {key: " ", code: "Space", ctrlKey: true, bubbles: true, cancelable: true}));
        await settle();
        expect(manager.dragOperation.status.dragging).toBe(true);
        window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true}));
        await settle();
        expect(manager.dragOperation.status.idle).toBe(true);
        expect(wrapper.emitted("move-tab")).toBeUndefined();
    });

    it("真实注册表与公开拖动操作经同一预览提交间隙插入，仅提交一次", async () => {
        const {wrapper, manager, start, move} = await setup();
        await start();
        const band = wrapper.findAllComponents(EditorTabBar)[0]!.get('.editor-regular-tabs').element;
        await move(206, 20, band);
        expect(document.querySelectorAll('[data-editor-drop-feedback] [data-drop-feedback-line]')).toHaveLength(1);
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toEqual([["main", "A", "C", false, "before"]]);
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
    });
    it("原位间隙显示唯一插入线，释放不提交移动且清除反馈", async () => {
        const {wrapper, manager, start, move} = await setup();
        const band = wrapper.findAllComponents(EditorTabBar)[0]!.get('.editor-regular-tabs').element;
        await start();
        await move(102, 20, band);
        const lines = document.querySelectorAll<HTMLElement>('[data-editor-drop-feedback] [data-drop-feedback-line]');
        expect(lines).toHaveLength(1);
        expect(lines[0]!.style.left).toBe("101px");
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        expect(wrapper.emitted("transfer-tab")).toBeUndefined();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
    });
    it("单行固定区拒绝拖入，多行独立固定区才接受且只有一条线", async () => {
        const {wrapper, manager, start, move, wrapped} = await setup(false, true);
        const side = wrapper.findAllComponents(EditorTabBar)[1]!;
        const pinned = side.get('.editor-pinned-tabs').element;
        rect(pinned, 0, 400, 500, 36);
        await start();
        await move(10, 420, pinned);
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("transfer-tab")).toBeUndefined();
        wrapped.value = true;
        await settle();
        await start();
        await move(10, 420, pinned);
        expect(document.querySelectorAll('[data-drop-feedback-line]')).toHaveLength(1);
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("transfer-tab")).toEqual([[{path: "A", sourceGroupId: "main", targetGroupId: "side", targetPath: "D", targetPinned: true, position: "before"}]]);
    });
    it("多行真实登记按第二行落点提交，切回单行后不遗留旧目标", async () => {
        const {wrapper, manager, start, move, wrapped} = await setup(true);
        const bar = wrapper.findAllComponents(EditorTabBar)[0]!;
        const row = bar.element.firstElementChild!;
        rect(bar.element, 0, 0, 250, 80);
        rect(row, 0, 0, 250, 80);
        rect(bar.get('.editor-regular-tabs').element, 0, 0, 250, 80);
        const c = bar.get('[data-editor-tab-path="C"]');
        rect(c.element, 0, 40, 100, 28);
        rect(c.get('[role="tab"]').element, 0, 40, 80, 28);
        await start();
        await move(10, 54, c.element);
        const line = document.querySelector<HTMLElement>('[data-editor-drop-feedback] [data-drop-feedback-line]');
        expect(line?.style.top).toBe("42px");
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toEqual([["main", "A", "C", false, "before"]]);
        wrapped.value = false;
        await settle();
        rect(bar.get('.editor-regular-tabs').element, 0, 0, 500, 36);
        await start();
        await move(10, 54, c.element);
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        manager.actions.stop({canceled: true});
        await settle();
        expect(wrapper.emitted("move-tab")).toHaveLength(1);
    });
    it("正文中央画整区反馈但不提交，同组与跨组都不改布局，边缘仍提交完整分屏意图", async () => {
        const {wrapper, manager, start, move} = await setup();
        const content = wrapper.get('[data-content="side"]').element;
        await start();
        await move(250, 580, content);
        const area = document.querySelector<HTMLElement>('[data-editor-drop-feedback] [data-drop-feedback-area]')!;
        // 500×300 的正文盒整区（绘制盒只差覆盖层自己的 6px 内缩），不是四边的半个区。
        expect([area.style.width, area.style.height]).toEqual(["488px", "288px"]);
        expect(document.querySelector('[data-editor-drop-feedback] [data-drop-feedback-line]')).toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        expect(wrapper.emitted("transfer-tab")).toBeUndefined();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        // 同一命中面的右边缘仍是半区反馈与真实分屏提交。
        await start();
        await move(490, 580, content);
        const half = document.querySelector<HTMLElement>('[data-editor-drop-feedback] [data-drop-feedback-area]')!;
        expect([half.style.width, half.style.height]).toEqual(["238px", "288px"]);
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("split-tab")).toEqual([[{path: "A", sourceGroupId: "main", targetGroupId: "side", direction: "right", mode: "move"}]]);
    });
    it("同组正文中央同样只有整区反馈，释放不产生组内移动", async () => {
        const {wrapper, manager, start, move} = await setup();
        await start();
        await move(250, 200, wrapper.get('[data-content="main"]').element);
        expect(document.querySelector('[data-editor-drop-feedback] [data-drop-feedback-area]')).not.toBeNull();
        expect(document.querySelector('[data-editor-drop-feedback] [data-drop-feedback-line]')).toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        expect(wrapper.emitted("transfer-tab")).toBeUndefined();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
    });
    it("同组唯一标签拖回自己正文：中央只画整区反馈，四边与中央都不提交", async () => {
        const {wrapper, manager, move} = await setup();
        const content = wrapper.get('[data-content="side"]').element;
        const source = Array.from(manager.registry.draggables).find(item => item.data.path === "D")!;
        manager.actions.start({source, coordinates: {x: 0, y: 420}});
        await settle();
        await move(250, 580, content);
        expect(document.querySelector('[data-editor-drop-feedback] [data-drop-feedback-area]')).not.toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
        manager.actions.start({source, coordinates: {x: 0, y: 420}});
        await settle();
        await move(490, 580, content);
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        expect(wrapper.emitted("transfer-tab")).toBeUndefined();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
    });
    it("边缘预览后在中央释放：无论中央预览是否已绘制都不能提交旧分屏", async () => {
        for (const publishCenter of [true, false]) {
            const {wrapper, source} = await setup();
            const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {
                pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
                buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true,
            });
            hit = source.handle!;
            source.handle!.dispatchEvent(pointer("pointerdown", 30, 20));
            document.dispatchEvent(pointer("pointermove", 45, 20));
            await settle();
            hit = wrapper.get('[data-content="side"]').element;
            document.dispatchEvent(pointer("pointermove", 490, 580));
            await settle();
            expect(document.querySelector<HTMLElement>('[data-drop-feedback-area]')?.style.width).toBe("238px");
            document.dispatchEvent(pointer("pointermove", 250, 580));
            if (publishCenter) {
                await settle();
                expect(document.querySelector<HTMLElement>('[data-drop-feedback-area]')?.style.width).toBe("488px");
            }
            document.dispatchEvent(pointer("pointerup", 250, 580));
            await settle();
            expect(wrapper.emitted("split-tab")).toBeUndefined();
            expect(wrapper.emitted("transfer-tab")).toBeUndefined();
            expect(wrapper.emitted("move-tab")).toBeUndefined();
            expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
            wrapper.unmount();
            mounted.splice(mounted.indexOf(wrapper), 1);
        }
    });
    it("释放时命中已改变但未发布新预览，拒绝提交旧或新意图", async () => {
        const {wrapper, manager, start, move} = await setup();
        await start();
        await move(206, 20, wrapper.findAllComponents(EditorTabBar)[0]!.get('.editor-regular-tabs').element);
        hit = wrapper.get('[data-content="side"]').element;
        manager.actions.move({to: {x: 490, y: 580}});
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("move-tab")).toBeUndefined();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
    });
    it("场景切换、Escape、失焦、卸载清理反馈且无提交", async () => {
        for (const kind of ["context", "escape", "blur", "unmount"]) {
            const {wrapper, manager, start, move} = await setup();
            await start();
            await move(490, 580, wrapper.get('[data-content="side"]').element);
            if (kind === "context") await wrapper.setProps({contextKey: "two"});
            if (kind === "escape") window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
            if (kind === "blur") window.dispatchEvent(new Event("blur"));
            if (kind === "unmount") { wrapper.unmount(); mounted.splice(mounted.indexOf(wrapper), 1); }
            else manager.actions.stop();
            await settle();
            expect(wrapper.emitted("split-tab")).toBeUndefined();
            expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        }
    });
    it("停住指针时目标尺寸变化仍更新预览；被浮层遮住后不给反馈", async () => {
        const {wrapper, manager, start, move} = await setup();
        await start();
        const content = wrapper.get('[data-content="side"]').element;
        await move(450, 580, content);
        const area = () => document.querySelector<HTMLElement>('[data-editor-drop-feedback] [data-drop-feedback-area]')!;
        const before = area().style.width;
        rect(content, 0, 440, 520, 300);
        for (const observer of resizeCallbacks) {
            if (observer.elements.has(content)) observer.callback([], {} as ResizeObserver);
        }
        await settle();
        expect(area().style.width).not.toBe(before);
        hit = document.body.appendChild(document.createElement("aside"));
        window.dispatchEvent(new Event("scroll"));
        await settle();
        expect(document.querySelector('[data-editor-drop-feedback]')).toBeNull();
        manager.actions.stop();
        await settle();
        expect(wrapper.emitted("split-tab")).toBeUndefined();
    });
});
