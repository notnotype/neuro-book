/**
 * `example.board` 两端共用的合同：项目入口与浏览器入口之间的远程服务，以及浏览器入口交给窗口里其它插件的本地服务。
 * 别的插件在运行时只引用这个文件，并且只用本地服务；远程合同是本插件两端之间的协议。
 */

import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteResult, RemoteSubscribeOptions} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 提供方位置是 `project`：每个项目实例各提供一份，调用方经 `.at("project")` 到达自己绑定的那个项目。 */
export const boardContract = defineRemoteService({
    id: "example.board/remote",
    version: 1,
    provider: "project",
    callers: ["browser"],
    methods: {
        pin: {input: Type.Object({text: Type.String({minLength: 1})}, {additionalProperties: false}), output: Type.Null(), effect: "write"},
        items: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(Type.String()), effect: "read"},
    },
    events: {
        pinned: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.String()},
    },
});

/** 窗口里的插件用的白板：没有“哪个项目”的参数，项目由窗口的绑定决定。 */
export interface BoardService {
    pin(text: string): Promise<RemoteResult<null>>;
    items(): Promise<RemoteResult<ReadonlyArray<string>>>;
    /** 订阅新钉上的条目；项目实例结束时订阅以 `onEnd` 结束。 */
    watch(listener: (text: string) => void, options?: Pick<RemoteSubscribeOptions, "onEnd">): Promise<RemoteResult<{release(): void}>>;
}

export const boardKey: ServiceKey<BoardService> = defineServiceKey<BoardService>("example.board/board");
