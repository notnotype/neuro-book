/**
 * 归属插件的提供者经句柄用（agent/conversation.md 输出 53）：每次读联系人、打开、记看到都在那一刻取实现。运行时合同：停止或撤回之后
 * 句柄不再交出实现，接收者不得缓存实现绕过门禁（nb-runtime 的 `ContributionHandle`）。归属插件停止到撤回回调之间读到的是空的；
 * 打开在途时它停了，结果作废。
 */

import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";

import type {SessionOwnerProvider} from "../shared/contracts";

export function gatedProvider(handle: Pick<ContributionHandle<unknown, SessionOwnerProvider>, "published" | "implementation">): SessionOwnerProvider {
    const current = (): SessionOwnerProvider | null => (handle.published ? handle.implementation() : null);
    return {
        contacts: {get value() {
            return current()?.contacts.value ?? [];
        }},
        state: {get value() {
            return current()?.state.value ?? {kind: "loading" as const};
        }},
        reload: () => current()?.reload(),
        open: async (id) => {
            const provider = current();
            if (provider === null) return {ok: false, code: "provider-stopped"};
            const opened = await provider.open(id);
            return handle.published ? opened : {ok: false, code: "provider-stopped"};
        },
        seen: (id, seq) => current()?.seen(id, seq),
    };
}
