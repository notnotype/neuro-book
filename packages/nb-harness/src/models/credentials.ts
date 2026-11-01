/**
 * 凭据库：OMP 的 `AuthStorage`（SQLite），只经它公开的 `credentials` 接口读写，不碰它的表（软删除、多行、版本迁移由
 * OMP 管）。这一层只管 API Key（docs/specs/models/service.md）：
 *
 * - 读：`credentials.list(provider)` 里 `type === "api_key"` 的活动行。不用 OMP 的 `has`／`get`，它们把 OAuth 也算上。
 * - 写：`credentials.set` 是 OMP 的替换语义，同一服务商的其它凭据（包括以后的 OAuth 行）一起被软删除。第一版库里只有
 *   本层写的 API Key，Spec 写明了；做 OAuth 时要改成按行更新。
 * - 内存里的快照以本进程的写为准（一个状态根只有一个服务端，ADR 0033）；库被外部工具改了要重开才看得到。
 */

import {AuthStorage} from "@oh-my-pi/pi-ai";

export interface CredentialStore {
    /** 有 API Key 的服务商。同步，读 OMP 的内存快照。 */
    providers(): ReadonlySet<string>;
    /** 这家的 API Key；没有时为 null。多行时取最新写的那行。 */
    get(provider: string): string | null;
    /** 写入后才 resolve，之后 `get`、`providers` 立即反映。 */
    set(provider: string, key: string): Promise<void>;
    /** 删掉这家在库里的全部凭据。 */
    clear(provider: string): Promise<void>;
    /** 本进程的写完成后调用（OMP 的快照代次变了）。 */
    onChange(listener: () => void): () => void;
    close(): void;
}

/**
 * 打开（必要时创建）凭据库：目录不存在时 OMP 以 0700 建，库文件 0600；已有目录不改权限，做不到的平台（Windows）按 OMP
 * 尽力而为。返回前先读一次库，返回时快照已就绪。
 */
export async function openCredentials(path: string): Promise<CredentialStore> {
    const storage = await AuthStorage.create(path);
    const pool = storage.credentials;
    // 打开只建连接，内存快照要先读一次库才有内容。
    await pool.reload();
    const apiKeyRows = (provider?: string) => pool.list(provider).filter((row) => row.disabledCause === null && row.credential.type === "api_key");
    return {
        providers: () => new Set(apiKeyRows().map((row) => row.provider)),
        get: (provider) => {
            const rows = apiKeyRows(provider);
            if (rows.length === 0) return null;
            const newest = rows.reduce((a, b) => (b.id > a.id ? b : a));
            return newest.credential.type === "api_key" ? newest.credential.key : null;
        },
        set: (provider, key) => pool.set(provider, {type: "api_key", key}),
        clear: (provider) => pool.remove(provider),
        onChange: (listener) => pool.onGeneration(() => listener()),
        close: () => storage.close(),
    };
}
