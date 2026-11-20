/**
 * 经句柄用归属插件的提供者（agent/conversation.md 输出 53）：句柄是只实现 `published` 与 `implementation()` 的替身，门禁同运行时合同
 * （停止后 `implementation()` 抛错）；真实宿主里的发布与撤回由 e2e bots-chat 走过。
 */

import {describe, expect, it} from "bun:test";
import {shallowRef} from "vue";

import type {SessionOwnerProvider} from "../shared/contracts";
import {gatedProvider} from "./owner-providers";

function handleOf(provider: SessionOwnerProvider) {
    const handle = {
        published: true,
        implementation: () => {
            if (!handle.published) throw new Error("plugin-stopped");
            return provider;
        },
    };
    return handle;
}

describe("经句柄用提供者", () => {
    it("停了之后读不到联系人、不记看到；打开在途时停了，结果作废", async () => {
        const seen: [string, number][] = [];
        let finish!: (value: {ok: true; sessionId: string}) => void;
        const provider: SessionOwnerProvider = {
            contacts: shallowRef([{id: "lyra", name: "星璃", unread: 3, last: null, sessionId: "bot-lyra"}]),
            state: shallowRef({kind: "ready" as const}),
            reload: () => undefined,
            open: () => new Promise((resolve) => {
                finish = resolve;
            }),
            seen: (id, seq) => void seen.push([id, seq]),
        };
        const handle = handleOf(provider);
        const gated = gatedProvider(handle);
        expect(gated.contacts.value.map((contact) => contact.unread)).toEqual([3]);
        const opening = gated.open("lyra");
        handle.published = false;
        finish({ok: true, sessionId: "bot-lyra"});
        expect(await opening).toEqual({ok: false, code: "provider-stopped"});
        expect(gated.contacts.value).toEqual([]);
        expect(gated.state.value).toEqual({kind: "loading"});
        gated.seen("lyra", 5);
        expect(seen).toEqual([]);
        expect(await gated.open("lyra")).toEqual({ok: false, code: "provider-stopped"});
    });
});
