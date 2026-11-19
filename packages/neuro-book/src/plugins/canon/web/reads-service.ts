/**
 * `canonReadsKey` 的实现（docs/specs/canon/author-ui.md 输出 35）：把窗口的读取层（`world.ts`）与组件里用它的组合函数
 * （`use-reads.ts`）交给别的浏览器入口。整个窗口一份读取层，每个调用方一个门面：门面只多记调用方插件的 id，放进外部读取的键里。
 * 窗口没有绑定项目时没有读取层：`connection` 是 `no-project`，组合函数都给 null。
 */

import {computed, shallowRef} from "vue";

import type {CanonReads} from "../shared/reads";
import {useExternalList, useExternalRead, useWorldList, useWorldRead} from "./use-reads";
import type {CanonWorld} from "./world";

export function createCanonReads(world: CanonWorld | null, plugin: string): CanonReads {
    if (world === null) {
        const none = computed(() => null);
        return {
            connection: shallowRef("no-project"),
            retry: async () => undefined,
            useRead: () => none,
            useList: () => ({state: none, more: () => undefined}),
            useExternal: () => none,
            useExternalList: () => ({state: none, more: () => undefined}),
        };
    }
    return {
        connection: world.connection,
        retry: () => world.retry(),
        useRead: (method, input) => useWorldRead(world, method, input),
        useList: (method, input, pageSize) => useWorldList(world, method, input, pageSize),
        useExternal: (method, input, fetch) => useExternalRead(world, plugin, method, input, fetch),
        useExternalList: (method, input, fetch, pageSize) => useExternalList(world, plugin, method, input, fetch, pageSize),
    };
}
