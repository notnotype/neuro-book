/**
 * `opening()`：会话创建时与每次压缩之后读一次开场（目录、参考文档），存进自己的 path 片，交给稳定的共用槽 `opening`
 * （缺省布局把它放在历史前面）。展开就是一个普通扩展：一片、两个处理函数、一个槽。
 */

import type {OpeningHelper} from "../api/index.js";
import {defineExtension, slice} from "../extension/define.js";

export const opening: OpeningHelper = (options) => {
    const load = async (ctx: {initial: unknown; resources: unknown; read: unknown; signal: AbortSignal; set: (slice: "parts", value: string[]) => void}) => {
        const parts = await options.load({initial: ctx.initial as never, resources: ctx.resources as never, read: ctx.read as never, signal: ctx.signal});
        ctx.set("parts", parts.filter((part): part is string => typeof part === "string" && part !== ""));
    };
    return defineExtension({
        id: options.id,
        ...(options.dependsOn === undefined ? {} : {dependsOn: options.dependsOn as unknown as readonly []}),
        state: {parts: slice.path<string[] | null>(null)},
        on: {
            sessionCreated: (_event, ctx) => load(ctx as never),
            compaction: (_event, ctx) => load(ctx as never),
        },
        contribute: {opening: {shared: true, value: ({state}) => (state.parts?.join("\n\n") || null)}},
    }) as never;
};
