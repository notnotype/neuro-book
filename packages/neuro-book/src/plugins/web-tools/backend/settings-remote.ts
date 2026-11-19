/**
 * 远程合同 `nbook.web-tools/settings` 的实现（docs/specs/web/tools.md 输出 16 到 19）。密钥只进不出：响应里只有“有没有”。
 */

import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";

import {WEB_PROVIDERS} from "../shared/contracts";
import type {WebCheckResult, WebProviderId, webSettingsContract} from "../shared/contracts";
import type {KeyStore} from "./keys";
import type {WebProvider} from "./providers/types";
import {SEARCH_DEADLINE_MS} from "./tools";

const isProvider = (value: string): value is WebProviderId => (WEB_PROVIDERS as readonly string[]).includes(value);

/** 检测用的查询：一次 `count: 1` 的搜索（输出 19）。 */
const CHECK_QUERY = "DeepSeek";

export function webSettingsRemote(keys: KeyStore, provider: () => WebProvider, now: () => number): RemoteImplementation<typeof webSettingsContract> {
    return {
        methods: {
            status: async (_input, context) => {
                const status = await keys.status();
                return status.ok ? context.ok(status.status) : context.fail("credentials-unavailable", {detail: status.detail});
            },
            setKey: async (input, context) => {
                if (!isProvider(input.provider)) return context.fail("invalid-value", {detail: `unknown provider ${input.provider}`});
                const key = input.key.trim();
                if (key === "") return context.fail("invalid-value", {detail: "the key is empty"});
                if (key.startsWith("env:")) return context.fail("invalid-value", {detail: "environment variable references are not supported"});
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
                const read = await keys.read(input.provider);
                if (!read.ok) return context.ok({ok: false, code: "credentials-unavailable"} satisfies WebCheckResult);
                if (read.key === null) return context.ok({ok: false, code: "no-key"} satisfies WebCheckResult);
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), SEARCH_DEADLINE_MS);
                const forward = (): void => controller.abort();
                context.signal.addEventListener("abort", forward, {once: true});
                try {
                    const outcome = await provider().search({query: CHECK_QUERY, count: 1}, read.key, {signal: controller.signal, deadline: now() + SEARCH_DEADLINE_MS, retry: false});
                    const result: WebCheckResult = outcome.ok ? {ok: true} : {ok: false, code: outcome.code, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})};
                    return context.ok(result);
                } finally {
                    clearTimeout(timer);
                    context.signal.removeEventListener("abort", forward);
                }
            },
        },
    };
}
