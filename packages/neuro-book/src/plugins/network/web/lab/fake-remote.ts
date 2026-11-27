/**
 * 网络页在 Lab 与 DOM 测试里用的 `nbook.network/settings` 替身：说明按配置服务里此刻的代理方式与地址现算（规则是真实出口的一个
 * 子集：跟随系统用场景给的系统代理，自定义的空地址是 `proxy-invalid`），测试按场景给的结局作答。真实的选路与测试由
 * `nb-host` 的 `network/egress.test.ts` 与 `plugins/network/network.test.ts` 验。
 */

import type {EgressSummaryView, EgressTestView} from "nbook/plugins/network/shared/contracts";
import type {NetworkRemote} from "nbook/plugins/network/web/network-store";

export interface FakeNetworkOptions {
    /** 此刻的代理方式与自定义地址（夹具从配置服务读）。 */
    readonly setting: () => {readonly mode: "system" | "custom" | "direct"; readonly url: string};
    /** 跟随系统时系统给的：代理（含来源）、没设、不支持（自动配置脚本）、读不到。缺省是环境变量里的代理。 */
    readonly system?: "env" | "none" | "unsupported" | "unreadable";
    /** 测试的结局：缺省通了；`"hang"` 一直挂着（看“正在测试…”）。 */
    readonly test?: "ok" | "bypassed" | "unreachable" | "hang";
    /** 说明一直不答（看“正在读取…”）。 */
    readonly describeHangs?: boolean;
    /** 说明的远程调用失败（看“无法读取当前使用的代理”）。 */
    readonly describeFails?: boolean;
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
const ok = <T>(value: T) => ({ok: true as const, value});

export function createFakeNetworkRemote(options: FakeNetworkOptions): NetworkRemote {
    const summary = (): EgressSummaryView => {
        const {mode, url} = options.setting();
        const base = {mode, origin: null, hasCredentials: false, error: null};
        if (mode === "direct") return {...base, route: "direct", source: {kind: "direct"}};
        if (mode === "custom") {
            if (url.trim() === "") return {...base, route: "direct", source: {kind: "setting"}, error: {code: "proxy-invalid", message: "the custom proxy has no address"}};
            return {...base, route: options.test === "bypassed" ? "bypassed" : "proxy", source: {kind: "setting"}, origin: new URL(url).origin};
        }
        switch (options.system ?? "env") {
            case "env":
                return {...base, route: "proxy", source: {kind: "env", name: "HTTPS_PROXY"}, origin: "http://127.0.0.1:7890"};
            case "none":
                return {...base, route: "direct", source: {kind: "system", name: "gnome"}};
            case "unsupported":
                return {...base, route: "direct", source: {kind: "system", name: "windows"}, error: {code: "proxy-unsupported", message: "the system proxy uses an automatic configuration script"}};
            case "unreadable":
                return {...base, route: "direct", source: {kind: "system", name: "macos"}, error: {code: "proxy-unreadable", message: "scutil did not answer within 2000 ms"}};
        }
    };
    const testResult = (): EgressTestView => {
        const shown = summary();
        if (shown.error !== null) return {ok: false, summary: shown, reason: shown.error.code, status: null, message: shown.error.message};
        if (options.test === "unreachable") return {ok: false, summary: shown, reason: "unreachable", status: null, message: "Unable to connect. Is the computer able to access the url?"};
        return {ok: true, summary: shown, ip: "203.0.113.7", elapsedMs: 286};
    };
    const remote = {
        describe: async () => (options.describeHangs === true ? never() : options.describeFails === true ? {ok: false, code: "unavailable", detail: "Lab 场景：网络服务没有运行"} : ok(summary())),
        test: async (_input: unknown, call?: {readonly signal?: AbortSignal}) => {
            if (options.test === "hang") {
                return new Promise((resolve) => call?.signal?.addEventListener("abort", () => resolve({ok: false, code: "cancelled", detail: "cancelled"}), {once: true}));
            }
            return ok(testResult());
        },
    };
    return remote as unknown as NetworkRemote;
}
