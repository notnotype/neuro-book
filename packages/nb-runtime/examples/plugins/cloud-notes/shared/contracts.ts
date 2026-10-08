import {Type} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import type {RemoteResult} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 本插件两端之间的协议：服务端按调用方插件分开存。 */
export const cloudNotesContract = defineRemoteService({
    id: "example.cloud-notes/remote",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        add: {input: Type.Object({text: Type.String()}, {additionalProperties: false}), output: Type.Null(), effect: "write"},
        list: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(Type.String()), effect: "read"},
    },
});

/** 窗口里的插件拿到的云笔记；没有“哪个插件”的参数，身份由内核填写。 */
export interface CloudNotes {
    add(text: string): Promise<RemoteResult<null>>;
    list(): Promise<RemoteResult<ReadonlyArray<string>>>;
}

export const cloudNotesKey: ServiceKey<CloudNotes> = defineServiceKey<CloudNotes>("example.cloud-notes/notes");
