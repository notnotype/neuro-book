/**
 * 只在内存里的密钥来源：真实模型的测试把真密钥交给它，不写进任何文件（docs/testing/README.md 的“真实模型测试”）。只由测试使用。
 */

import type {KeyStoreFactory} from "../backend/plugin";
import type {WebKeyStatus, WebProviderId} from "../shared/contracts";

export function memoryKeyStore(initial: Partial<Record<WebProviderId, string>>): KeyStoreFactory {
    return () => {
        const keys = new Map<WebProviderId, string>(Object.entries(initial) as Array<[WebProviderId, string]>);
        const status = (): WebKeyStatus => ({providers: {deepseek: {hasKey: keys.has("deepseek")}}});
        return {
            read: async (provider) => ({ok: true, key: keys.get(provider) ?? null}),
            status: async () => ({ok: true, status: status()}),
            set: async (provider, key) => {
                keys.set(provider, key);
                return {ok: true, status: status()};
            },
            clear: async (provider) => {
                keys.delete(provider);
                return {ok: true, status: status()};
            },
        };
    };
}
