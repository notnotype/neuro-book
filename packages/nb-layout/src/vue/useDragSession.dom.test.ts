import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {defineComponent, effectScope, h, nextTick, onMounted, shallowRef} from "vue";

import type {DragEnd} from "../drag-gesture";
import type {DragSessionOptions} from "./drag-session";
import {useDragSession} from "./useDragSession";

/**
 * 组件里的会话（Spec `ui/layout-drag` 输出 18、19）：根出现时建、换根重建、根没了与作用域结束销毁；选项每个根只读一次。
 * 拖动本身的规则由 `drag-session.dom.test.ts` 管，这里只拿“按下再移过门槛就开始一场”验会话真的在、在哪个根上。
 */

type Drop = {readonly key: string};

let ends: DragEnd[];
let built: HTMLElement[];
/** 建会话与会话收尾按发生的先后记在一起，验“先销毁旧的再建新的”。 */
let log: string[];

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, ...init});
}

/** 一个带来源的根；`grab` 在它上面按下并移过门槛。 */
function makeRoot(name = ""): HTMLElement {
    const root = document.createElement("div");
    root.dataset.name = name;
    root.innerHTML = `<button data-source>来源</button>`;
    document.body.append(root);
    return root;
}

function grab(root: HTMLElement): void {
    const source = root.querySelector("[data-source]")!;
    source.dispatchEvent(pointer("pointerdown", {clientX: 0, clientY: 0}));
    source.dispatchEvent(pointer("pointermove", {clientX: 10, clientY: 0}));
}

const createOptions = (root: HTMLElement): Omit<DragSessionOptions<string, Drop, never>, "root"> => {
    built.push(root);
    log.push(`build:${root.dataset.name ?? ""}`);
    return {
        sourceAt: (target) => (target.closest("[data-source]") === null ? null : "row"),
        resolve: () => ({key: "a"}),
        actionKey: (drop) => drop.key,
        commit: () => undefined,
        onEnd: (end) => {
            ends.push(end);
            log.push(`end:${end.kind === "cancelled" ? end.reason : end.kind}`);
        },
    };
};

beforeEach(() => {
    ends = [];
    built = [];
    log = [];
    // happy-dom 没有这个方法；会话判定时找指针处最上层的元素，这里用不到结果。
    Object.assign(document, {elementsFromPoint: () => []});
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("useDragSession", () => {
    it("根已有值：调用时立即建；换根先销毁旧的（进行中的一场按 disposed 收尾）再建新的；根没了与作用域结束时销毁，进行中的一场同样收尾（输出 18）", async () => {
        const first = makeRoot("first");
        const second = makeRoot("second");
        const root = shallowRef<HTMLElement | null>(first);
        const scope = effectScope();
        const drag = scope.run(() => useDragSession<string, Drop>(root, createOptions))!;
        expect(drag.session.value).not.toBeNull();
        expect(log).toEqual(["build:first"]);

        grab(first);
        expect(drag.state.value?.source).toBe("row");

        root.value = second;
        await nextTick();
        expect(log).toEqual(["build:first", "end:disposed", "build:second"]);
        expect(drag.state.value).toBeNull();

        // 根没了：会话销毁，进行中的一场按 disposed 收尾；旧会话不再接旧根上的按下。
        grab(second);
        expect(drag.state.value?.source).toBe("row");
        const onSecond = drag.session.value!;
        root.value = null;
        await nextTick();
        expect(log).toEqual(["build:first", "end:disposed", "build:second", "end:disposed"]);
        expect(drag.session.value).toBeNull();
        expect(drag.state.value).toBeNull();
        grab(second);
        expect(onSecond.state.value).toBeNull();

        // 作用域结束：同样销毁并收尾。
        root.value = first;
        await nextTick();
        grab(first);
        const last = drag.session.value!;
        expect(last.state.value?.source).toBe("row");
        scope.stop();
        expect(log.at(-1)).toBe("end:disposed");
        expect(drag.session.value).toBeNull();
        grab(first);
        expect(last.state.value).toBeNull();
    });

    it("模板 ref 的根：挂载回调里还是 null，挂载后的那次刷新里建好；选项只在建时读一次（输出 18、19）", async () => {
        const seenInMounted: Array<unknown> = [];
        let handle: ReturnType<typeof useDragSession<string, Drop>> | null = null;
        const Host = defineComponent({
            setup() {
                const rootEl = shallowRef<HTMLElement | null>(null);
                const drag = useDragSession<string, Drop>(rootEl, createOptions);
                handle = drag;
                onMounted(() => void seenInMounted.push(drag.session.value));
                return () => h("div", {ref: rootEl}, [h("button", {"data-source": ""}, "来源")]);
            },
        });
        const wrapper = mount(Host, {attachTo: document.body});
        expect(seenInMounted).toEqual([null]);
        await nextTick();
        expect(handle!.session.value).not.toBeNull();
        expect(built).toHaveLength(1);

        // 组件重渲染不换根，选项不再读。
        await wrapper.vm.$forceUpdate();
        await nextTick();
        expect(built).toHaveLength(1);

        wrapper.unmount();
        expect(handle!.session.value).toBeNull();
    });

    it("选项不随响应式重建：建时读到的 ref 之后变了，会话不重建（输出 19）", async () => {
        const flag = shallowRef(1);
        const root = shallowRef<HTMLElement | null>(makeRoot());
        const scope = effectScope();
        const drag = scope.run(() => useDragSession<string, Drop>(root, (current) => {
            void flag.value;
            return createOptions(current);
        }))!;
        const first = drag.session.value;
        expect(built).toHaveLength(1);
        flag.value = 2;
        await nextTick();
        expect(built).toHaveLength(1);
        expect(drag.session.value).toBe(first);
        scope.stop();
    });

    it("`createOptions` 抛出：这个根上没有会话，错误交给应用的错误处理（输出 19）", async () => {
        const errors: unknown[] = [];
        let handle: ReturnType<typeof useDragSession<string, Drop>> | null = null;
        const Host = defineComponent({
            setup() {
                const rootEl = shallowRef<HTMLElement | null>(null);
                handle = useDragSession<string, Drop>(rootEl, () => {
                    throw new Error("选项坏了");
                });
                return () => h("div", {ref: rootEl});
            },
        });
        const wrapper = mount(Host, {attachTo: document.body, global: {config: {errorHandler: (error) => void errors.push(error)}}});
        await nextTick();
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe("选项坏了");
        expect(handle!.session.value).toBeNull();
        expect(handle!.state.value).toBeNull();
        wrapper.unmount();
    });
});
