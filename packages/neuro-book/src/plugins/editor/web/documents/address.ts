/**
 * 文档地址的运算：前缀按段边界判断，`a/b` 不是 `a/bc` 的前缀；方案根（路径为空）是同方案全部地址的前缀。
 */

import {formatResource, parseResource} from "nbook/plugins/files/shared/contracts";
import type {Resource, Scheme} from "nbook/plugins/files/shared/contracts";

export function resourceOf(address: string): Resource {
    const parsed = parseResource(address);
    if (!parsed.ok) throw new RangeError(parsed.detail);
    return parsed.resource;
}

export function schemeOf(address: string): Scheme {
    return resourceOf(address).scheme;
}

/** `address` 是 `prefix` 本身或它的后代。 */
export function isWithin(address: string, prefix: string): boolean {
    const target = resourceOf(address);
    const base = resourceOf(prefix);
    if (target.scheme !== base.scheme) return false;
    return base.path === "" || target.path === base.path || target.path.startsWith(`${base.path}/`);
}

/** 把 `address` 里的 `from` 前缀换成 `to`；不在 `from` 之下时原样返回。 */
export function rebase(address: string, from: string, to: string): string {
    if (!isWithin(address, from)) return address;
    const rest = resourceOf(address).path.slice(resourceOf(from).path.length);
    const next = resourceOf(to);
    return formatResource({scheme: next.scheme, path: next.path === "" ? rest.replace(/^\//u, "") : `${next.path}${rest}`});
}

/** 正文按 UTF-8 编码后的 SHA-256（十六进制），与 Files 的磁盘基线同一算法。 */
export async function textHash(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
