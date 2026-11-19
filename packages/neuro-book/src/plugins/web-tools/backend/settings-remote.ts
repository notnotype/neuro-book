/**
 * 远程合同 `nbook.web-tools/settings` 的实现（docs/specs/web/tools.md 输出 16 到 19）。密钥只进不出：响应里只有“有没有”。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import {WEB_PROVIDERS} from "../shared/contracts";
import type {WebCheckResult, WebProviderId, webSettingsContract} from "../shared/contracts";
import type {KeyStore} from "./keys";
import type {WebProvider} from "./providers/types";
import {SEARCH_DEADLINE_MS, withDeadline} from "./tools";

const isProvider = (value: string): value is WebProviderId => (WEB_PROVIDERS as readonly string[]).includes(value);

/**
 * 密钥的写法（输出 17）：Bearer 令牌（RFC 6750 的 b64token），字母、数字与 `-._~+/`，末尾可以有 `=`。别的字符放不进请求头
 * （存下来以后每次调用都失败），多半是粘错了东西；长度封顶同理。
 */
const KEY_SYNTAX = /^[A-Za-z0-9\-._~+/]+=*$/u;
export const MAX_KEY_LENGTH = 512;

function keyProblem(key: string): string | null {
    if (key === "") return "the key is empty";
    if (key.startsWith("env:")) return "environment variable references are not supported";
    if (key.length > MAX_KEY_LENGTH) return `the key is longer than ${String(MAX_KEY_LENGTH)} characters`;
    if (!KEY_SYNTAX.test(key)) return "the key has characters an API key does not have (spaces, line breaks, quotes or non-ASCII)";
    return null;
}

/** 检测用的查询：一次 `count: 1` 的搜索（输出 19）。 */
const CHECK_QUERY = "DeepSeek";

export function webSettingsRemote(keys: KeyStore, provider: () => WebProvider, clock: RuntimeClock): RemoteImplementation<typeof webSettingsContract> {
    return {
        methods: {
            status: async (_input, context) => {
                const status = await keys.status();
                return status.ok ? context.ok(status.status) : context.fail("credentials-unavailable", {detail: status.detail});
            },
            setKey: async (input, context) => {
                if (!isProvider(input.provider)) return context.fail("invalid-value", {detail: `unknown provider ${input.provider}`});
                const key = input.key.trim();
                const problem = keyProblem(key);
                if (problem !== null) return context.fail("invalid-value", {detail: problem});
                const written = await keys.set(input.provider, key);
                return written.ok ? context.ok(written.status) : context.fail("credentials-unavailable", {detail: written.detail});
            },
            clearKey: async (input, context) => {
                if (!isProvider(input.provider)) return context.fail("invalid-value", {detail: `unknown provider ${input.provider}`});
                const written = await keys.clear(input.provider);
                return written.ok ? context.ok(written.status) : context.fail("credentials-unavailable", {detail: written.detail});
            },
            check: async (input, context) => {
                if (!isProvider(input.provider)) return context.fail("invalid-value", {detail: `unknown provider ${input.provider}`});
                const {provider: id} = input;
                // 读密钥也在截止里：设置页改了密钥或关了窗口会取消这次检测，取消落在读密钥时也不再发出计费的搜索。
                const result = await withDeadline(context.signal, SEARCH_DEADLINE_MS, clock, async (scope): Promise<WebCheckResult> => {
                    const read = await keys.read(id);
                    if (!read.ok) return {ok: false, code: "credentials-unavailable"};
                    if (read.key === null) return {ok: false, code: "no-key"};
                    const outcome = await provider().search({query: CHECK_QUERY, count: 1}, read.key, {...scope, retry: false});
                    return outcome.ok ? {ok: true} : {ok: false, code: outcome.code, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})};
                });
                return context.ok(result);
            },
        },
    };
}
