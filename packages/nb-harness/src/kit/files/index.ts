/**
 * 宿主给套件的文件访问（docs/specs/harness/host-kit.md），经 `@notnotype/nb-harness/kit/files` 交出：接口类型、文字的解码规则、
 * 虚拟根的文字与内核资源接口的适配。浏览器会加载它（宿主的文件服务合同从这里转出 `decodeText`、`renderVirtual`），所以值导入
 * 只许 `typebox`，内核的类型只 `import type`。碰磁盘的本机实现在 `./kit/files/local`。
 *
 * 套件不认识任何地址方案：地址怎么改写、哪些根有特殊含义、写入记在谁名下，都在宿主的实现里。
 */

import type {Resources, ToolSessionContext} from "../../kernel/contracts.js";

/** 失败码是开放字符串：套件只按 `KNOWN_FILE_FAILURES` 里的码分支，宿主自己的码（例如没有主项目）原样交给模型。 */
export type FileFailure = {readonly ok: false; readonly code: string; readonly detail: string};
export type FileResult<T> = {readonly ok: true; readonly value: T} | FileFailure;

/** 含义固定的失败码（host-kit.md 的“失败与恢复”）。 */
export const KNOWN_FILE_FAILURES = ["not-found", "unknown-scheme", "unsupported-capability", "invalid-address", "protected-path", "outside-root", "not-a-file", "not-a-directory", "permission-denied", "conflict", "too-large", "cancelled"] as const;

/** 读到的内容的指纹：只用来原样交回给写的 `expect`，套件不解读。 */
export interface Baseline {
    readonly hash: string;
}
export type WriteExpect = Baseline | "absent" | "any";

/** 本机读路径：只用来读，往里写不经文件访问、不算这次会话的写。 */
export interface Located {
    readonly path: string;
    readonly kind: "file" | "directory" | "other";
}

/** 一层目录项。没有 `kind` 字段，靠它与虚拟根区分。 */
export interface DirectoryListing {
    readonly kind?: undefined;
    readonly entries: ReadonlyArray<{readonly name: string; readonly kind: string}>;
}

/** 虚拟根：条目带全局地址，读根本身得到 `renderVirtual` 的文字。 */
export interface VirtualListing {
    readonly kind: "virtual";
    readonly description: string;
    readonly entries: ReadonlyArray<{readonly address: string; readonly title?: string; readonly meta?: Readonly<Record<string, string>>}>;
}

export interface FileCalls {
    read(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<{readonly bytes: Uint8Array; readonly baseline: Baseline}>>;
    /** 写整份内容，字符串按 UTF-8 编码。 */
    write(address: string, content: Uint8Array | string, options: {readonly expect: WriteExpect; readonly createParents?: boolean; readonly signal?: AbortSignal}): Promise<FileResult<{readonly baseline: Baseline}>>;
}

/**
 * 一个会话看到的文件。地址可以是单数写法，进来先改写。宿主按调用时的会话上下文现建，不按会话缓存：换 Profile 或主项目之后
 * 要按新上下文重新取。
 */
export interface SessionFiles extends FileCalls {
    readonly layout: SessionLayout;
    /** 单数地址改写成全局地址，全局地址原样通过（幂等）；同步、不碰磁盘。 */
    expand(address: string): {readonly ok: true; readonly address: string} | FileFailure;
    /** 写这个地址要不要另外问用户：`ask` 时别的规则放行也问。 */
    classify(address: string): {readonly write: "allowed" | "ask" | "denied"} | FileFailure;
    /** 本机读路径（按宿主的读授权）。方案没登记为 `unknown-scheme`，虚拟根为 `unsupported-capability`。 */
    readPath(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<Located>>;
    list(address: string, options?: {readonly signal?: AbortSignal}): Promise<FileResult<DirectoryListing | VirtualListing>>;
    /**
     * 绑定一次工具调用：经它的写入在宿主的记录里属于这次调用，调用的 `signal` 合进每次读写。工具每次执行只调一次，复用交回的
     * 对象。
     */
    call(call: {readonly callId: string; readonly signal: AbortSignal}, info?: {readonly title?: string}): FileCalls;
}

/** 这个会话的地址布局：套件不写死任何方案。只放与文件访问和判定有关的；计划文件、日志、项目根由用到它的块各自的选项给。 */
export interface SessionLayout {
    /** `shell` 的工作目录，`grep`、`glob` 不给根时的缺省根（可以写单数地址）。 */
    readonly working: string;
    /** 模式闸门的草稿根：写只落在这些根下时算“只写草稿”。 */
    readonly scratch: readonly string[];
    /** `auto` 审批模式下不问审批者的写的根。 */
    readonly localWrites: readonly string[];
    /** `shell` 的环境变量：名 → 地址；定位不到本机路径的不设。 */
    readonly shellEnv: Readonly<Record<string, string>>;
    /** 以这个全局地址为根搜索时不进的子目录（以 `/` 开头）。只省下无谓的读，授权仍以 `readPath` 为准。 */
    searchExcludes(root: string): readonly string[];
}

/** 宿主身份保存大结果的全文：会话经 `SessionFiles` 写不了那里，所以与它分开。 */
export interface ArtifactStore {
    /** `label` 只收单段；写入函数正常结束即提交，交回全局地址。 */
    save(label: string, write: (sink: {write(chunk: Uint8Array): Promise<void>}) => Promise<void>): Promise<FileResult<{readonly address: string}>>;
}

/** 工具工厂拿到的服务。 */
export interface KitServices {
    readonly files: SessionFiles;
    readonly artifacts: ArtifactStore;
}

/** 审批、放回、内核资源接口用的工厂。`owner` 是用它的工具 id，作写入分组的缺省标题；不属于哪个工具时为 null。 */
export type SessionFilesFactory = (context: ToolSessionContext, owner: string | null) => SessionFiles;

/**
 * 文字的解码规则（docs/specs/workspace/files.md 的“读取与保存”）：宿主的文件服务读文字、写入接口的 `update` 与内核的资源接口
 * 共用，同一份字节在各处得到同一个结论。只接受 UTF-8；BOM 留在文字里（保存时原样写回），含 NUL 的视为二进制。
 */
export function decodeText(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
    } catch {
        // 非法 UTF-8：TextDecoder 只给 TypeError，没有更多可记的信息。
        return null;
    }
}

/** 虚拟根的文字呈现：读根本身得到它（docs/specs/agent/resources.md 输出 5）。 */
export function renderVirtual(listing: VirtualListing): string {
    const lines = listing.entries.map((entry) => {
        const meta = Object.entries(entry.meta ?? {}).map(([key, value]) => `${key}: ${value}`).join("，");
        return `- ${entry.address}${entry.title === undefined ? "" : ` ${entry.title}`}${meta === "" ? "" : `（${meta}）`}`;
    });
    return [listing.description, ...(lines.length === 0 ? [] : ["", ...lines])].join("\n");
}

/** 内核的 `Resources.read` 只有文字或抛出：调用方要分辨失败时按 `code`（docs/specs/agent/resources.md 输出 9）。 */
export class ResourceReadError extends Error {
    constructor(readonly code: string, uri: string, detail: string) {
        super(`读不了 ${uri}：${code}（${detail}）`);
        this.name = "ResourceReadError";
    }
}

/** 内核的资源接口：`resolve` 交回全局地址（改写不了的原样交回）；`read` 只在不存在时为空，其它失败抛出。 */
export function kernelResources(files: Pick<SessionFiles, "expand" | "read">): Resources {
    return {
        resolve: (uri) => {
            const expanded = files.expand(uri);
            return expanded.ok ? expanded.address : uri;
        },
        read: async (uri) => {
            const read = await files.read(uri);
            if (!read.ok) {
                if (read.code === "not-found") return undefined;
                throw new ResourceReadError(read.code, uri, read.detail);
            }
            // 与文件服务读文字同一规则：严格 UTF-8、BOM 留在文字里、含 NUL 的不是文字。
            const text = decodeText(read.value.bytes);
            if (text === null) throw new ResourceReadError("not-text", uri, "不是 UTF-8 文本");
            return text;
        },
    };
}
