/**
 * 资源地址的解析与拼接（docs/specs/workspace/resources.md 的“输入与前置条件”，与 nbook.files 的 parseResource 同一套规则）。
 * 只做与平台无关的规则；Windows 宿主另拒绝的写法由提供者判。
 */

import type {FilesResult, ResourceAddress} from "./types";

const ADDRESS = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/su;
/** 第一段像盘符（`C:`、`C:notes.md`）：在 Windows 上会被当作另一个盘的路径。 */
const DRIVE = /^[A-Za-z]:/u;
export const MAX_ADDRESS_PATH_BYTES = 4096;
const encoder = new TextEncoder();

/** 路径不合法的原因；合法为 `null`。根（空路径）合法。 */
export function addressPathProblem(path: string): string | null {
    if (path === "") return null;
    if (encoder.encode(path).length > MAX_ADDRESS_PATH_BYTES) return `路径超过 ${String(MAX_ADDRESS_PATH_BYTES)} 字节`;
    if (path.includes("\0")) return "路径含 NUL";
    if (path.includes("\\")) return "路径含反斜杠";
    const segments = path.split("/");
    if (segments.some((segment) => segment === "")) return "路径含空段（开头、结尾或连续的 /）";
    if (segments.some((segment) => segment === "." || segment === "..")) return "路径含 . 或 .. 段";
    if (DRIVE.test(segments[0]!)) return "路径以盘符开头";
    return null;
}

export function parseAddress(address: string): FilesResult<ResourceAddress> {
    const match = ADDRESS.exec(address);
    if (match === null) return {ok: false, code: "invalid-address", detail: `${address} 不是“方案://路径”形式的资源地址`};
    const problem = addressPathProblem(match[2]!);
    if (problem !== null) return {ok: false, code: "invalid-address", detail: `${address}：${problem}`};
    return {ok: true, value: {scheme: match[1]!, path: match[2]!}};
}

export function formatAddress(address: ResourceAddress): string {
    return `${address.scheme}://${address.path}`;
}
