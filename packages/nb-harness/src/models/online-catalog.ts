/**
 * OMP 的在线目录（stencil 的 models.dev 精简副本，docs/specs/models/service.md“模型来源”）：自己取（ETag、字节上限、不跟随重定向），
 * 只复用 pi-catalog 的映射函数与 `buildModel`。不用它的 `fetchWellKnownModels`：那个按进程内会话缓存、失败时悄悄沿用上一份、没有
 * 字节上限，我们要的是“验证成功才一起提交正文与 ETag”。
 *
 * 用法：调用方取到字节（`fetchOnlineCatalog`）→ `parseOnlineCatalog` 成功 → 才把字节与 ETag 落盘、换进目录视图。
 */

import {zstdDecompressSync} from "node:zlib";

import {mapModelsDevToModels, MODELS_DEV_PROVIDER_DESCRIPTORS, type Model} from "@oh-my-pi/pi-catalog";
import {buildModel} from "@oh-my-pi/pi-catalog/build";

import type {NetworkRoute} from "../kernel/index.js";
import {DIRECT_ROUTE} from "./target.js";

export const ONLINE_CATALOG_URL = "https://catalog.stencil.so/models.json.zstd";

/** 传输与解压后的上限：2026-11 时分别约 230 KB 与 3.4 MiB。 */
export const ONLINE_CATALOG_LIMITS = {transferBytes: 8 * 1024 * 1024, decodedBytes: 32 * 1024 * 1024} as const;

/** zstd 帧的魔数（小端）：按它判断，不信 content-type（同 OMP）。 */
const ZSTD_MAGIC = 0xfd2fb528;

export interface OnlineCatalogRow {
    readonly model: Model;
    /** 原文里有没有价目（`cost` 字段在不在）：在而全为 0 是免费，不在是未知。 */
    readonly priced: boolean;
}

/** 解析好的在线目录：按 OMP 的服务商 id 分组的模型（各种类的都在，调用方按对话类与线协议筛）。 */
export interface OnlineCatalog {
    readonly providers: ReadonlyMap<string, readonly OnlineCatalogRow[]>;
}

export class OnlineCatalogError extends Error {
    constructor(readonly reason: "too-large" | "malformed", message: string) {
        super(message);
    }
}

/** 解析取到的字节；不合格（解不开、超限、不是目录）抛 `OnlineCatalogError`，调用方保留旧的那份。 */
export function parseOnlineCatalog(bytes: Uint8Array): OnlineCatalog {
    const zstd = bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === ZSTD_MAGIC;
    let raw: Uint8Array;
    try {
        raw = zstd ? zstdDecompressSync(bytes, {maxOutputLength: ONLINE_CATALOG_LIMITS.decodedBytes}) : bytes;
    } catch (error) {
        if (error instanceof RangeError) throw new OnlineCatalogError("too-large", `the catalog is larger than ${String(ONLINE_CATALOG_LIMITS.decodedBytes)} bytes when decompressed`);
        throw new OnlineCatalogError("malformed", "the catalog could not be decompressed");
    }
    if (raw.byteLength > ONLINE_CATALOG_LIMITS.decodedBytes) throw new OnlineCatalogError("too-large", "the catalog is too large");
    let payload: unknown;
    try {
        payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
        throw new OnlineCatalogError("malformed", "the catalog is not JSON");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new OnlineCatalogError("malformed", "the catalog is not an object");
    const data = payload as Record<string, unknown>;
    const providers = new Map<string, OnlineCatalogRow[]>();
    for (const spec of mapModelsDevToModels(data, MODELS_DEV_PROVIDER_DESCRIPTORS)) {
        const descriptor = MODELS_DEV_PROVIDER_DESCRIPTORS.find((item) => item.providerId === spec.provider);
        const rawRow = descriptor === undefined ? undefined : rawModel(data, descriptor.modelsDevKey, spec.id);
        // OMP 的映射是容错的：缺的字段补默认、价目不是数字时当 0、窗口不要求整数。这里逐行验，不合格的行丢掉（不让一行坏数据变成
        // “已知免费”或页面上放不下的窗口），其余照收。
        if (!rowValid(spec, rawRow)) continue;
        const model = buildModel({...spec, name: [...spec.name].slice(0, NAME_LIMIT).join("")}) as Model;
        const rows = providers.get(spec.provider) ?? [];
        rows.push({model, priced: rawRow !== undefined && typeof rawRow.cost === "object" && rawRow.cost !== null});
        providers.set(spec.provider, rows);
    }
    if (providers.size === 0) throw new OnlineCatalogError("malformed", "the catalog has no providers");
    return {providers};
}

/** 显示名的上限（同列表请求）：一行要能放进一帧 RPC。 */
const NAME_LIMIT = 200;
const positiveInteger = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value > 0;
const price = (value: unknown): boolean => value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);

/** 一行能不能收：id 有界；窗口与上限是正整数或没有；原文的价目字段都是非负的有限数。 */
function rowValid(spec: {id: unknown; contextWindow?: unknown; maxTokens?: unknown}, raw: Record<string, unknown> | undefined): boolean {
    if (typeof spec.id !== "string" || spec.id === "" || spec.id.length > 256) return false;
    for (const value of [spec.contextWindow, spec.maxTokens]) if (value !== null && value !== undefined && !positiveInteger(value)) return false;
    const cost = raw?.cost;
    if (cost !== undefined && (typeof cost !== "object" || cost === null)) return false;
    if (cost !== undefined) {
        const fields = cost as Record<string, unknown>;
        if (![fields.input, fields.output, fields.cache_read, fields.cache_write].every(price)) return false;
    }
    return true;
}

function rawModel(data: Record<string, unknown>, key: string, id: string): Record<string, unknown> | undefined {
    const provider = data[key];
    if (typeof provider !== "object" || provider === null) return undefined;
    const models = (provider as Record<string, unknown>).models;
    if (typeof models !== "object" || models === null) return undefined;
    const row = (models as Record<string, unknown>)[id];
    return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : undefined;
}

export type OnlineCatalogFetch =
    | {readonly status: 200; readonly bytes: Uint8Array; readonly etag: string | null}
    | {readonly status: 304}
    | {readonly status: "failed"; readonly reason: "unreachable" | "bad-response" | "too-large" | "cancelled" | "proxy"; readonly message: string};

export interface FetchOnlineCatalogOptions {
    /** 上一次成功时的 ETag；给了才发条件请求，`304` 才成立。 */
    readonly etag: string | null;
    readonly signal: AbortSignal;
    /** 缺省是 stencil 的地址。 */
    readonly url?: string;
    /** 网络出口；不给时直连。选不出路时以 `proxy` 失败，请求不发。 */
    readonly route?: NetworkRoute;
}

/** 取一次：不解析、不落盘。截止由 `signal` 定（覆盖连接与读体）。 */
export async function fetchOnlineCatalog(options: FetchOnlineCatalogOptions): Promise<OnlineCatalogFetch> {
    const headers: Record<string, string> = {accept: "application/zstd, application/json"};
    if (options.etag !== null) headers["if-none-match"] = options.etag;
    const url = new URL(options.url ?? ONLINE_CATALOG_URL);
    const route = await (options.route ?? DIRECT_ROUTE)(url);
    if (!route.ok) return {status: "failed", reason: "proxy", message: route.message};
    let response: Response;
    try {
        // `proxy: false` 是 Bun 的按次直连（1.4.3 起），类型声明里没有 `false` 这一项。
        response = await fetch(url, {method: "GET", headers, redirect: "manual", signal: options.signal, proxy: route.proxy as string});
    } catch (error) {
        return failed(options.signal, error);
    }
    if (response.status === 304 && options.etag !== null) {
        await response.body?.cancel();
        return {status: 304};
    }
    if (response.status !== 200) {
        await response.body?.cancel();
        return {status: "failed", reason: "bad-response", message: `the catalog server answered ${String(response.status)}`};
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            if (reader === undefined) break;
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > ONLINE_CATALOG_LIMITS.transferBytes) {
                await reader.cancel();
                return {status: "failed", reason: "too-large", message: `the catalog is larger than ${String(ONLINE_CATALOG_LIMITS.transferBytes)} bytes`};
            }
            chunks.push(value);
        }
    } catch (error) {
        return failed(options.signal, error);
    }
    return {status: 200, bytes: new Uint8Array(Buffer.concat(chunks)), etag: response.headers.get("etag")};
}

function failed(signal: AbortSignal, error: unknown): OnlineCatalogFetch {
    if (signal.aborted) return {status: "failed", reason: "cancelled", message: "the request was cancelled"};
    return {status: "failed", reason: "unreachable", message: error instanceof Error ? error.message : String(error)};
}
