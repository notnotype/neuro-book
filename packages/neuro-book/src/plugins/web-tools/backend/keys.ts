/**
 * 密钥文件（docs/specs/web/tools.md 输出 13、15、21）：`<状态根>/web/keys.json`，明文，只有本用户可读写。
 *
 * 不缓存：每次用到时读文件，写在锁里读改写、原子替换，替换完成才返回。所以入口激活时不碰文件（内置插件的入口在启动时激活，
 * 文件坏了也不能让应用起不来），设置页写完之后开始的工具调用就读到新值，入口停止时也没有要关的句柄。
 */

import {mkdir, readFile} from "node:fs/promises";
import {dirname} from "node:path";

import {replaceLocked} from "@notnotype/nb-file-lock";

import {WEB_PROVIDERS} from "../shared/contracts";
import type {WebKeyStatus, WebProviderId} from "../shared/contracts";

const FORMAT_VERSION = 1;

export type KeyRead = {readonly ok: true; readonly key: string | null} | {readonly ok: false; readonly detail: string};
export type StatusRead = {readonly ok: true; readonly status: WebKeyStatus} | {readonly ok: false; readonly detail: string};

export interface KeyStore {
    /** 这一家的密钥；没有为 `null`。文件读不了或解析不了时失败（调用方报 `credentials-unavailable`）。 */
    read(provider: WebProviderId): Promise<KeyRead>;
    status(): Promise<StatusRead>;
    /** 写入成功时交回写后的状态。文件损坏时照常覆盖，并经 `record` 记一条 `web.keys-file-replaced`。 */
    set(provider: WebProviderId, key: string): Promise<StatusRead>;
    clear(provider: WebProviderId): Promise<StatusRead>;
}

/** 诊断出口：不带密钥与文件内容。 */
export type KeyStoreRecord = (level: "info" | "warn", event: string, message: string, data: Readonly<Record<string, unknown>>) => void;

type Keys = Readonly<Record<string, string>>;
type Parsed = {readonly ok: true; readonly keys: Keys} | {readonly ok: false; readonly detail: string};

function parse(text: string): Parsed {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return {ok: false, detail: "keys file is not valid JSON"};
    }
    if (typeof value !== "object" || value === null) return {ok: false, detail: "keys file is not an object"};
    const {version, keys} = value as {version?: unknown; keys?: unknown};
    // 不把文件里的值带进详情：坏文件的内容不进诊断与响应（输出 14）。
    if (version !== FORMAT_VERSION) return {ok: false, detail: "keys file has an unsupported version"};
    if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return {ok: false, detail: "keys file has no keys object"};
    for (const entry of Object.values(keys)) if (typeof entry !== "string") return {ok: false, detail: "keys file has a non-string key"};
    return {ok: true, keys: keys as Keys};
}

/** 每家有没有密钥；文件里不认识的服务的项（例如更新的版本写进来的）不进状态，写入时照原样留着。 */
const statusOf = (keys: Keys): WebKeyStatus => ({providers: Object.fromEntries(WEB_PROVIDERS.map((id) => [id, {hasKey: typeof keys[id] === "string"}])) as WebKeyStatus["providers"]});
const serialize = (keys: Keys): string => `${JSON.stringify({version: FORMAT_VERSION, keys}, null, 4)}\n`;

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

export function createKeyStore(path: string, record: KeyStoreRecord): KeyStore {
    const load = async (): Promise<Parsed> => {
        let text: string;
        try {
            text = await readFile(path, "utf8");
        } catch (error) {
            if (errorCode(error) === "ENOENT") return {ok: true, keys: {}};
            return {ok: false, detail: `cannot read keys file (${errorCode(error) ?? "unknown error"})`};
        }
        return parse(text);
    };

    const loaded = async (): Promise<Parsed> => {
        const parsed = await load();
        if (!parsed.ok) record("warn", "web.keys-file-unreadable", "the web keys file cannot be read", {path, detail: parsed.detail});
        return parsed;
    };

    const write = async (change: (keys: Keys) => Keys): Promise<StatusRead> => {
        try {
            await mkdir(dirname(path), {recursive: true, mode: 0o700});
        } catch (error) {
            return {ok: false, detail: `cannot create the keys directory (${errorCode(error) ?? "unknown error"})`};
        }
        // `decide` 每次重做都重算，所以这两个值随最后一次决定。
        let replacedBroken = false;
        let next: Keys = {};
        const result = await replaceLocked<never, string>(path, {
            lockPath: `${path}.lock`,
            // 每次写都设成只有本用户可读写，临时文件从建出来起就是：手工建的或从备份恢复的宽权限文件也在下一次写入时收紧。
            mode: 0o600,
            report: (event, error) => record("warn", `web.keys-${event}`, "a secondary step of writing the keys file failed", {path, code: errorCode(error) ?? null}),
            decide: (current) => {
                const parsed = current === null ? ({ok: true, keys: {}} as Parsed) : parse(new TextDecoder().decode(current.bytes));
                replacedBroken = !parsed.ok;
                next = change(parsed.ok ? parsed.keys : {});
                return {write: serialize(next)};
            },
        });
        if (!result.ok) return {ok: false, detail: `cannot write keys file (${result.reason}: ${result.detail})`};
        if (replacedBroken) record("warn", "web.keys-file-replaced", "an unreadable web keys file was replaced by a write", {path});
        return {ok: true, status: statusOf(next)};
    };

    return {
        read: async (provider) => {
            const parsed = await loaded();
            return parsed.ok ? {ok: true, key: parsed.keys[provider] ?? null} : {ok: false, detail: parsed.detail};
        },
        status: async () => {
            const parsed = await loaded();
            return parsed.ok ? {ok: true, status: statusOf(parsed.keys)} : {ok: false, detail: parsed.detail};
        },
        set: (provider, key) => write((keys) => ({...keys, [provider]: key})),
        clear: (provider) => write((keys) => {
            const rest: Record<string, string> = {...keys};
            delete rest[provider];
            return rest;
        }),
    };
}
