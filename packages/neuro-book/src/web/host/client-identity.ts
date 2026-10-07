/**
 * 客户端身份：同一浏览器配置下跨刷新与多个窗口稳定的标识，随握手发给服务端（runtime.browser-host 术语）。
 * 与每次启动都换新的实例 id 区分；以后 Storage 的 `local` 分区按它划分。
 *
 * 浏览器的本地存储可能不可用（隐私模式、被禁用、配额已满），连访问 `localStorage` 本身都可能抛错，所以由调用方
 * 交入取存储的函数，读写都在 try 里；不可用时退回本页随机值并给出原因，窗口照常启动。
 */

/** 本地存储的最小读写面；浏览器里是 `window.localStorage`。 */
export interface IdentityStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const CLIENT_IDENTITY_KEY = "nbook.client-identity";

/** 合法的身份：非空、不太长；被其它代码写坏的值重新生成。 */
const VALID = /^[\w-]{1,128}$/u;

export interface ClientIdentity {
    readonly id: string;
    /** 身份没能存进本地存储时的原因；这时 `id` 只在本页有效，刷新后换新。 */
    readonly problem: string | null;
}

export function readClientIdentity(storage: () => IdentityStorage): ClientIdentity {
    let store: IdentityStorage;
    try {
        store = storage();
        const existing = store.getItem(CLIENT_IDENTITY_KEY);
        if (existing !== null && VALID.test(existing)) return {id: existing, problem: null};
    } catch (error) {
        return {id: crypto.randomUUID(), problem: `本地存储不可用：${describe(error)}`};
    }
    const created = crypto.randomUUID();
    try {
        store.setItem(CLIENT_IDENTITY_KEY, created);
    } catch (error) {
        return {id: created, problem: `客户端身份写不进本地存储：${describe(error)}`};
    }
    return {id: created, problem: null};
}

function describe(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
