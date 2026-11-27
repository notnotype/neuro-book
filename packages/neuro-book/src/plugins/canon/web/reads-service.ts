/**
 * `canonReadsKey` 的实现（docs/specs/canon/author-ui.md 输出 35）：把窗口的读取层（`world.ts`）与组件里用它的组合函数
 * （`use-reads.ts`）交给别的浏览器入口。整个窗口一份读取层，每个调用方一个门面：门面只多记调用方插件的 id，放进外部读取的键里。
 * 窗口没有绑定项目时没有读取层：`connection` 是 `no-project`，组合函数都给 null。
 */

import {computed, defineAsyncComponent, defineComponent, h, shallowRef} from "vue";
import type {Component, PropType} from "vue";

import type {CanonReads, PageHeadProps} from "../shared/reads";
import {chapterLine, defaultPosition, positionExists, positionFromValue} from "./positions";
import {useExternalList, useExternalRead, useWorldList, useWorldRead} from "./use-reads";
import type {WindowLine} from "./window-line";
import type {CanonWorld} from "./world";

/** 页头组件绑上读取层与窗口的线；组件本身第一次用到时才加载（canon 的界面组件都按需加载）。 */
function boundPageHead(world: CanonWorld, line: WindowLine): Component<PageHeadProps> {
    const Head = defineAsyncComponent(() => import("./components/entry-page/PageHead.vue"));
    return defineComponent({
        name: "CanonPageHead",
        props: {title: {type: String, required: true}, position: {type: String, default: ""}, planned: {type: Boolean, default: false}, wide: {type: Boolean, default: false}},
        emits: {"update:position": (_value: string) => true, "update:planned": (_value: boolean) => true},
        setup(props, {emit, slots}) {
            return () => h(Head, {world, windowLine: line, ...props, "onUpdate:position": (value: string) => emit("update:position", value), "onUpdate:planned": (value: boolean) => emit("update:planned", value)}, slots);
        },
    }) as unknown as Component<PageHeadProps>;
}

const NO_HEAD = defineComponent({name: "CanonPageHeadUnbound", props: {title: {type: String as PropType<string>, required: true}}, setup: () => () => null}) as unknown as Component<PageHeadProps>;

export function createCanonReads(world: CanonWorld | null, plugin: string, line: WindowLine): CanonReads {
    const lines = {line: line.line, setLine: (next: string) => line.set(next), lineOptions: line.options};
    if (world === null) {
        const none = computed(() => null);
        return {
            usePosition: () => none,
            PageHead: NO_HEAD,
            connection: shallowRef("no-project"),
            retry: async () => undefined,
            useRead: () => none,
            useList: () => ({state: none, more: () => undefined}),
            useExternal: () => none,
            useExternalList: () => ({state: none, more: () => undefined}),
            ...lines,
        };
    }
    const PageHead = boundPageHead(world, line);
    return {
        ...lines,
        PageHead,
        usePosition: (value) => {
            const chapters = useWorldRead(world, "chapters", () => ({}));
            return computed(() => {
                const items = chapters.value?.data?.items;
                if (items === undefined) return null;
                const given = value();
                const read = given === "" ? null : positionFromValue(given);
                const base = read !== null && positionExists(read, items) ? read : defaultPosition(items);
                const position = line.line.value === "" ? base : {...base, line: line.line.value};
                return {position, line: chapterLine(position, items)};
            });
        },
        connection: world.connection,
        retry: () => world.retry(),
        useRead: (method, input) => useWorldRead(world, method, input),
        useList: (method, input, pageSize) => useWorldList(world, method, input, pageSize),
        useExternal: (method, input, fetch) => useExternalRead(world, plugin, method, input, fetch),
        useExternalList: (method, input, fetch, pageSize) => useExternalList(world, plugin, method, input, fetch, pageSize),
    };
}
