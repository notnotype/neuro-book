/**
 * 方案注册表：贡献点 `files.schemes` 的接收者（docs/specs/workspace/resources.md 的“方案注册”）。一条贡献一个方案；
 * 不合格的（非内置插件、保留名、名字不合法、重复）只拒绝这一条并写诊断，不让贡献方的整个激活失败。
 */

import {join} from "node:path";

import type {RuntimeClock, Scope} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {RESERVED_SCHEMES} from "../shared/schemes";
import type {MountedSchemeSpec} from "../shared/schemes";
import {MountedScheme} from "./mounted";

const SCHEME_NAME = /^[a-z][a-z0-9+.-]*$/u;
/**
 * 第三方插件的 id 不能以 `nbook.` 开头（docs/specs/runtime/plugin-manifest.md 的“清单无效”），所以这个前缀就是内置插件。
 * 第三方注册方案随第一个插件方案（`plot://`）另定。
 */
const BUILTIN_PREFIX = "nbook.";

type Handle = ContributionHandle<Record<string, never>, MountedSchemeSpec>;
type Prepared = {readonly accepted: true} | {readonly accepted: false; readonly reason: string};

export interface SchemeRegistryOptions {
    readonly scope: Scope;
    readonly clock: RuntimeClock;
    /** 挂载点的保存锁放在 `<lockRoot>/<方案>/<挂载点>/`。 */
    readonly lockRoot: string;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown) => void;
}

export class SchemeRegistry {
    readonly #options: SchemeRegistryOptions;
    /** 已预占的方案名 → 预占它的句柄：两个插件同时注册同一个名字时只有先预占的那个生效。 */
    readonly #claimed = new Map<string, Handle>();
    readonly #schemes = new Map<string, {readonly handle: Handle; readonly scheme: MountedScheme}>();

    constructor(options: SchemeRegistryOptions) {
        this.#options = options;
    }

    get(scheme: string): MountedScheme | null {
        return this.#schemes.get(scheme)?.scheme ?? null;
    }

    readonly receiver: ContributionReceiver<Record<string, never>, MountedSchemeSpec, Prepared> = {
        prepare: (handle) => {
            const reason = !handle.plugin.startsWith(BUILTIN_PREFIX)
                ? "只接受内置插件注册方案"
                : RESERVED_SCHEMES.has(handle.id)
                    ? `${handle.id}:// 由文件服务自己提供`
                    : !SCHEME_NAME.test(handle.id)
                        ? `${handle.id} 不是合法的方案名`
                        : this.#claimed.has(handle.id)
                            ? `${handle.id}:// 已由 ${this.#claimed.get(handle.id)?.plugin ?? "别的插件"} 注册`
                            : null;
            if (reason !== null) {
                this.#options.record("warn", "files.scheme.rejected", `方案注册被拒：${reason}`, {scheme: handle.id, plugin: handle.plugin});
                return {accepted: false, reason};
            }
            this.#claimed.set(handle.id, handle);
            return {accepted: true};
        },
        published: (handle, prepared) => {
            if (!prepared.accepted) return;
            const scheme = new MountedScheme({
                scheme: handle.id,
                // 每次请求时取实现：撤回后取不到，请求按方案不存在结束（接收者不得缓存实现）。
                spec: () => handle.implementation(),
                scope: this.#options.scope,
                clock: this.#options.clock,
                lockRoot: join(this.#options.lockRoot, handle.id),
                record: this.#options.record,
            });
            this.#schemes.set(handle.id, {handle, scheme});
        },
        revoke: async (handle, prepared) => {
            if (!prepared.accepted || this.#claimed.get(handle.id) !== handle) return;
            this.#claimed.delete(handle.id);
            const registered = this.#schemes.get(handle.id);
            if (registered?.handle !== handle) return;
            this.#schemes.delete(handle.id);
            await registered.scheme.stop();
        },
    };

    /** 入口停止：全部方案拒新请求、等在途结算后关闭。 */
    async stop(): Promise<void> {
        const all = [...this.#schemes.values()];
        this.#schemes.clear();
        this.#claimed.clear();
        await Promise.all(all.map((item) => item.scheme.stop()));
    }
}
