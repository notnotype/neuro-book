/**
 * 资源地址 `方案://路径`（docs/specs/workspace/resources.md 的“输入与前置条件”）：浏览器与后端共用的纯函数。
 *
 * 路径是方案根下的相对路径，段之间用 `/`；地址里不出现服务端绝对路径。这里只做与平台无关的规则，Windows 宿主另拒绝的
 * 写法（含 `:` 的段、UNC、设备名）由提供者按宿主判定。
 */

/** 本应用已有提供者的方案；其它方案随各自的使用方加入。 */
export const SCHEMES = ["project", "user"] as const;
export type Scheme = (typeof SCHEMES)[number];

export interface Resource {
    readonly scheme: Scheme;
    /** 相对方案根，空字符串是根本身。 */
    readonly path: string;
}

export type ParsedResource = {readonly ok: true; readonly resource: Resource} | {readonly ok: false; readonly code: "invalid-address" | "unknown-scheme"; readonly detail: string};

/** 编码后路径的字节上限。 */
export const MAX_PATH_BYTES = 4096;

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/su;
/** 第一段像盘符（`C:`、`C:notes.md`）：在 Windows 上会被当作另一个盘的路径。 */
const DRIVE_PATTERN = /^[A-Za-z]:/u;

export function parseResource(address: string): ParsedResource {
    const match = SCHEME_PATTERN.exec(address);
    if (match === null) return invalid(`${address} 不是“方案://路径”形式的资源地址`);
    const scheme = match[1] as string;
    if (!isScheme(scheme)) return {ok: false, code: "unknown-scheme", detail: `没有方案 ${scheme}://`};
    const problem = pathProblem(match[2] as string);
    return problem === null ? {ok: true, resource: {scheme, path: match[2] as string}} : invalid(`${address}：${problem}`);
}

/** 相对路径不合法的原因；合法为 `null`。 */
export function pathProblem(path: string): string | null {
    if (path === "") return null;
    if (new TextEncoder().encode(path).length > MAX_PATH_BYTES) return `路径超过 ${String(MAX_PATH_BYTES)} 字节`;
    if (path.includes("\0")) return "路径含 NUL";
    if (path.includes("\\")) return "路径含反斜杠";
    const segments = path.split("/");
    if (segments.some((segment) => segment === "")) return "路径含空段（开头、结尾或连续的 /）";
    if (segments.some((segment) => segment === "." || segment === "..")) return "路径含 . 或 .. 段";
    if (DRIVE_PATTERN.test(segments[0] as string)) return "路径以盘符开头";
    return null;
}

export function formatResource(resource: Resource): string {
    return `${resource.scheme}://${resource.path}`;
}

/** 父目录；根的父目录是 `null`。 */
export function parentOf(resource: Resource): Resource | null {
    if (resource.path === "") return null;
    const slash = resource.path.lastIndexOf("/");
    return {scheme: resource.scheme, path: slash < 0 ? "" : resource.path.slice(0, slash)};
}

/** 最后一段名字；根是空字符串。 */
export function basenameOf(resource: Resource): string {
    return resource.path.slice(resource.path.lastIndexOf("/") + 1);
}

/** 在目录下接一个子项名；名字必须是单个合法的段。 */
export function joinResource(directory: Resource, name: string): Resource {
    const path = directory.path === "" ? name : `${directory.path}/${name}`;
    if (name === "" || name.includes("/") || pathProblem(path) !== null) throw new RangeError(`${JSON.stringify(name)} 不是 ${formatResource(directory)} 下的单个目录项名`);
    return {scheme: directory.scheme, path};
}

function isScheme(value: string): value is Scheme {
    return (SCHEMES as ReadonlyArray<string>).includes(value);
}

function invalid(detail: string): ParsedResource {
    return {ok: false, code: "invalid-address", detail};
}
