/**
 * “搜索与网页”页在 Lab 与 DOM 测试里用的远程合同替身：密钥状态在内存里，写方法照服务端的语义改状态（docs/specs/web/tools.md
 * 输出 16 到 19 里页面看得到的部分）。页面与服务端的真实来回由 `web-tools/search-store.test.ts` 与 `e2e/web-settings.e2e.ts` 验。
 * 检测不发请求：按 `check` 给的结果作答，`"hang"` 一直挂着（看“检测中”），`"unknown"` 以结果未知结束（看“没检成”）。
 */

import {isWebProvider, WEB_PROVIDERS} from "nbook/plugins/web-tools/shared/contracts";
import type {WebCheckResult, WebKeyStatus, WebProviderId} from "nbook/plugins/web-tools/shared/contracts";
import type {WebSettingsRemote} from "nbook/plugins/web-tools/web/search-store";

export interface FakeWebRemoteOptions {
    /** DeepSeek 有没有密钥。 */
    readonly hasKey?: boolean;
    /** Tavily 有没有密钥。 */
    readonly hasTavilyKey?: boolean;
    /** 服务端入口没有运行：所有方法得 `unavailable`。 */
    readonly unavailable?: boolean;
    /** 密钥文件读不了：`status` 得 `credentials-unavailable`。 */
    readonly unreadable?: boolean;
    /** `status` 一直不答（看“读取中”）。 */
    readonly neverLoads?: boolean;
    /** 检测的结局：给定的结果，`"hang"` 一直挂着，`"unknown"` 结果未知，`"unavailable"` 只有检测时入口没在运行。 */
    readonly check?: WebCheckResult | "hang" | "unknown" | "unavailable";
}

/** 写方法失败的方式：密钥文件写不进去，或链路断了、结果未知；`null` 照常写。 */
export type FakeWriteFailure = "credentials-unavailable" | "unknown-outcome" | null;

export interface FakeWebRemote {
    readonly remote: WebSettingsRemote;
    /** 让写方法都以给定的码失败（看窗口通知）。 */
    failWrites(code: FakeWriteFailure): void;
    /** 各方法被调用的次数与写入的密钥（只给测试断言先后与次数）。 */
    readonly calls: Array<{readonly method: string; readonly provider?: string; readonly key?: string}>;
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export function createFakeWebRemote(options: FakeWebRemoteOptions = {}): FakeWebRemote {
    const keys = new Map<WebProviderId, string>();
    if (options.hasKey === true) keys.set("deepseek", "sk-lab-not-real");
    if (options.hasTavilyKey === true) keys.set("tavily", "tvly-lab-not-real");
    let failing: FakeWriteFailure = null;
    const calls: Array<{readonly method: string; readonly provider?: string; readonly key?: string}> = [];
    const status = (): WebKeyStatus => ({providers: Object.fromEntries(WEB_PROVIDERS.map((id) => [id, {hasKey: keys.has(id)}])) as WebKeyStatus["providers"]});
    const unavailable = {ok: false as const, code: "unavailable" as const, detail: "Lab 场景：网页工具没有运行"};
    const writeFailure = (code: Exclude<FakeWriteFailure, null>) => code === "unknown-outcome"
        ? {ok: false as const, code, detail: "Lab 场景：连接断了"}
        : {ok: false as const, code, detail: {detail: "Lab 场景：写不进去"}};
    const invalid = (detail: string) => ({ok: false as const, code: "invalid-value" as const, detail: {detail}});

    const remote = {
        status: async () => {
            calls.push({method: "status"});
            if (options.neverLoads === true) return never();
            if (options.unavailable === true) return unavailable;
            if (options.unreadable === true) return {ok: false as const, code: "credentials-unavailable" as const, detail: {detail: "Lab 场景：密钥文件坏了"}};
            return {ok: true as const, value: status()};
        },
        setKey: async (input: {readonly provider: string; readonly key: string}) => {
            calls.push({method: "setKey", provider: input.provider, key: input.key});
            if (options.unavailable === true) return unavailable;
            if (failing !== null) return writeFailure(failing);
            const value = input.key.trim();
            if (!isWebProvider(input.provider)) return invalid(`unknown provider ${input.provider}`);
            if (value === "" || value.startsWith("env:")) return invalid("the key is empty or an environment variable reference");
            keys.set(input.provider, value);
            return {ok: true as const, value: status()};
        },
        clearKey: async (input: {readonly provider: string}) => {
            calls.push({method: "clearKey", provider: input.provider});
            if (options.unavailable === true) return unavailable;
            if (failing !== null) return writeFailure(failing);
            if (isWebProvider(input.provider)) keys.delete(input.provider);
            return {ok: true as const, value: status()};
        },
        check: async (input: {readonly provider: string}) => {
            const key = isWebProvider(input.provider) ? (keys.get(input.provider) ?? null) : null;
            calls.push({method: "check", provider: input.provider, ...(key === null ? {} : {key})});
            if (options.unavailable === true) return unavailable;
            if (options.check === "hang") return never();
            if (options.check === "unknown") return {ok: false as const, code: "unknown-outcome" as const, detail: "Lab 场景：连接断了"};
            if (options.check === "unavailable") return unavailable;
            if (key === null) return {ok: true as const, value: {ok: false, code: "no-key"} satisfies WebCheckResult};
            return {ok: true as const, value: options.check ?? ({ok: true} satisfies WebCheckResult)};
        },
        events: {},
    };
    return {
        // 方法的形状照合同写，结果按合同的码表给；运行时码（unavailable 等）在合同的结果类型里，类型推不到这么细。
        remote: remote as unknown as WebSettingsRemote,
        failWrites: (code) => {
            failing = code;
        },
        calls,
    };
}
