/**
 * `release:smoke --from registry` 装包之前，先等这次要验的版本都能从 registry 取到。
 *
 * npm 接受发布以后还要“处理”一会儿，版本才出现在安装用的元数据里（发布时 npm 会打印“may take a few minutes to become
 * available”）。v0.13.0 实测：几十 KB 到 1 MB 的包 3 到 4 分钟，5.3 MB 的应用包约 8 分钟。按固定间隔重试冒烟等不准，
 * 而且 bun 会把没有新版本的元数据缓存一阵，重试也装不到；所以先轮询到全部可见，再只装一次。
 *
 * 查的是 bun 安装时读的那份：缩略元数据（`application/vnd.npm.install-v1+json`），不加防缓存的参数。registry 前面的 CDN
 * 会把它缓存最多 5 分钟（`cache-control: max-age=300`），绕过缓存看到了，bun 未必看得到。
 */

const INSTALL_METADATA = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

export type RegistryWaitOptions = {
    /** registry 地址，以 `/` 结尾。 */
    registry: string;
    timeoutMs: number;
    intervalMs: number;
    fetch?: (url: string, init: {headers: Record<string, string>}) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    /** 每轮之后报一次还没出现的版本，给 CI 日志看进度。 */
    report?: (missing: readonly string[]) => void;
};

/** 缺省的 registry：与 bun 一样先认 `NPM_CONFIG_REGISTRY`。 */
export function defaultRegistry(env: Record<string, string | undefined> = process.env): string {
    const configured = env.NPM_CONFIG_REGISTRY ?? env.npm_config_registry ?? "https://registry.npmjs.org/";
    return configured.endsWith("/") ? configured : `${configured}/`;
}

/**
 * 这一个版本现在能不能装到。包不存在（404）与版本还不在元数据里都算“还没有”；其它状态码与网络错误也只算这一轮没看到，
 * 原因带回去写进超时的报错，不在第一次出错时就判失败：处理中的 registry 偶尔回 5xx。
 */
async function visible(name: string, version: string, options: Required<Pick<RegistryWaitOptions, "registry" | "fetch">>): Promise<{ok: true} | {ok: false; reason: string}> {
    let response: Response;
    try {
        response = await options.fetch(`${options.registry}${name.replace("/", "%2f")}`, {headers: {accept: INSTALL_METADATA}});
    } catch (error) {
        return {ok: false, reason: `请求失败：${error instanceof Error ? error.message : String(error)}`};
    }
    if (response.status === 404) return {ok: false, reason: "registry 上没有这个包"};
    if (!response.ok) return {ok: false, reason: `registry 回 ${response.status}`};
    let document: {versions?: Record<string, unknown>};
    try {
        document = (await response.json()) as typeof document;
    } catch {
        return {ok: false, reason: "元数据不是 JSON"};
    }
    return document.versions?.[version] === undefined ? {ok: false, reason: "元数据里还没有这个版本"} : {ok: true};
}

/**
 * 轮询到 `expected`（包名到版本）全部可见。到 `timeoutMs` 仍有没出现的就抛出，消息里列出每个包最后一次看到的情况。
 */
export async function waitForRegistry(expected: ReadonlyMap<string, string>, options: RegistryWaitOptions): Promise<void> {
    const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    const sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
    const now = options.now ?? Date.now;
    const deadline = now() + options.timeoutMs;
    const pending = new Map(expected);
    const reasons = new Map<string, string>();
    for (;;) {
        for (const [name, version] of pending) {
            const result = await visible(name, version, {registry: options.registry, fetch: fetchImpl});
            if (result.ok) {
                pending.delete(name);
                reasons.delete(name);
            } else reasons.set(name, result.reason);
        }
        if (pending.size === 0) return;
        const missing = [...pending].map(([name, version]) => `${name}@${version}`);
        options.report?.(missing);
        if (now() + options.intervalMs > deadline) {
            const details = [...pending].map(([name, version]) => `${name}@${version}（${reasons.get(name)}）`);
            throw new Error(`等了 ${Math.round(options.timeoutMs / 60_000)} 分钟，registry 上仍取不到：${details.join("、")}`);
        }
        await sleep(options.intervalMs);
    }
}
