/**
 * 资源管理器里的地址运算：树的键、展开集合、选择都用完整资源地址（`project://a/b`）。前缀判断按段边界，`a/b` 不是
 * `a/bc` 的前缀；方案根（路径为空）是同方案全部地址的前缀。
 */

import {formatResource, joinResource, parentOf, parseResource} from "nbook/plugins/files/shared/contracts";
import type {Resource, Scheme} from "nbook/plugins/files/shared/contracts";

export function rootAddress(scheme: Scheme): string {
    return formatResource({scheme, path: ""});
}

export function resourceOf(address: string): Resource {
    const parsed = parseResource(address);
    if (!parsed.ok) throw new RangeError(parsed.detail);
    return parsed.resource;
}

export function schemeOf(address: string): Scheme {
    return resourceOf(address).scheme;
}

export function addressOf(scheme: Scheme, path: string): string {
    return formatResource({scheme, path});
}

/** 父目录地址；方案根没有父目录。 */
export function parentAddress(address: string): string | null {
    const parent = parentOf(resourceOf(address));
    return parent === null ? null : formatResource(parent);
}

export function childAddress(directory: string, name: string): string {
    return formatResource(joinResource(resourceOf(directory), name));
}

export function nameOf(address: string): string {
    const {path} = resourceOf(address);
    return path.slice(path.lastIndexOf("/") + 1);
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
    const target = resourceOf(address);
    const base = resourceOf(from);
    const rest = target.path.slice(base.path.length);
    const next = resourceOf(to);
    const path = next.path === "" ? rest.replace(/^\//u, "") : `${next.path}${rest}`;
    return formatResource({scheme: next.scheme, path});
}
