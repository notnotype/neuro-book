/**
 * 方案注册与服务端文件服务的合同（docs/specs/workspace/resources.md 的“方案注册”“服务端文件服务”“挂载方案”）。
 *
 * 注册方经贡献点 `files.schemes` 交出声明式的挂载方案：根的说明与条目、挂载点、授权规则；真实目录的打开、读写与寿命都由
 * `nbook.files` 管理，注册方不碰文件。服务端插件经进程内服务 `serverFilesKey` 按全局地址访问 `user://`、`projects://` 与
 * 已注册的方案。这里不引 Node：类型要能被浏览器构建的共享代码引用。
 */

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteCause, RemoteFailureCode} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ConsumerIdentity, ServiceKey} from "@notnotype/nb-runtime/services";

import type {Baseline, FileText, FilesFailureCode, Listing, OperationDone, SavedText} from "./contracts";

export const SCHEMES_POINT = "files.schemes";

/**
 * 贡献 id 就是方案名（不加插件前缀）。`project`、`user`、`projects` 由 `nbook.files` 自己提供，注册被拒；只接受内置插件的
 * 注册，由接收者核对。
 */
export const schemesPoint: ContributionPointDefinition<Record<string, never>> = {id: SCHEMES_POINT, implementation: "required"};

/** `nbook.files` 自己提供、不接受注册的方案。 */
export const RESERVED_SCHEMES: ReadonlySet<string> = new Set(["project", "user", "projects"]);

export type SchemeCapability = "read" | "write" | "list" | "realPath";
/** 授权回调看到的操作：新建属于写能力。 */
export type SchemeOperation = "read" | "list" | "write" | "create" | "realPath";

/** 服务端的 `nbook.agent` 注明的会话（docs/specs/agent/resources.md）；Files 不核对真伪，由 `nbook.agent` 负责。 */
export interface AgentOnBehalf {
    readonly session: string;
    readonly profile: string;
}

export interface SchemeCaller {
    readonly consumer: ConsumerIdentity;
    /** 带了就是 Agent 会话；没带是服务端插件自己。 */
    readonly agent: AgentOnBehalf | null;
}

export interface VirtualEntry {
    readonly name: string;
    readonly title?: string;
    readonly meta?: Readonly<Record<string, string>>;
}

export interface SchemeRoot {
    readonly description: string;
    readonly entries: readonly VirtualEntry[];
}

export interface MountDeclaration {
    /** 挂载点的目录不存在时，第一次写、新建或取真实路径可以建它。 */
    readonly create: boolean;
    /** 挂载点里要随之建好的单段子目录（例如会话的 `home`）。 */
    readonly ensure?: readonly string[];
}

export type AuthorizeResult = true | "permission-denied" | "protected-path" | "not-found";

/** 声明式挂载方案：根是虚拟目录，根下第一段（挂载点）对应 `<container>/<挂载点>/`。 */
export interface MountedSchemeSpec {
    readonly capabilities: readonly SchemeCapability[];
    /** 挂载点所在的容器目录（服务端绝对路径），注册方在激活时建好；它必须是真实目录。 */
    readonly container: string;
    root(caller: SchemeCaller): SchemeRoot | Promise<SchemeRoot>;
    /** 与调用方无关：同一个挂载点的目录被所有调用方共用。不存在的挂载点为 `null`。 */
    mount(name: string): MountDeclaration | null | Promise<MountDeclaration | null>;
    /**
     * `path` 是挂载点内的路径（挂载点本身为空字符串）。Files 对地址里的路径与解析链接后的真实路径各调用一次，都通过才执行；
     * 列出的子项逐项按 `read` 调用。同步、不抛错：它在每个请求的热路径上。
     */
    authorize(caller: SchemeCaller, mount: string, operation: SchemeOperation, path: string): AuthorizeResult;
}

/** 列出虚拟根得到的值；条目的 `address` 是全局地址。 */
export interface VirtualListing {
    readonly kind: "virtual";
    readonly description: string;
    readonly entries: ReadonlyArray<VirtualEntry & {readonly address: string}>;
}

export type ServerFilesFailureCode = FilesFailureCode | "unsupported-capability" | "project-unavailable" | "invalid-input" | "cancelled";

export type ServerFilesResult<T> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: ServerFilesFailureCode | RemoteFailureCode; readonly detail: string; readonly current?: Baseline; readonly cause?: RemoteCause};

export interface ServerFilesOptions {
    readonly signal?: AbortSignal;
    /** 只接受服务端位置的 `nbook.agent`，别的调用方带了为 `invalid-input`。 */
    readonly as?: {readonly agent: AgentOnBehalf};
}

/** 服务端文件服务：按调用方门面，地址是全局地址。不提供批量、删除、改名。 */
export interface ServerFiles {
    list(address: string, options?: ServerFilesOptions): Promise<ServerFilesResult<Listing | VirtualListing>>;
    read(address: string, options?: ServerFilesOptions): Promise<ServerFilesResult<FileText>>;
    write(address: string, text: string, baseline: Baseline, options?: ServerFilesOptions): Promise<ServerFilesResult<SavedText>>;
    create(address: string, kind: "file" | "directory", options?: ServerFilesOptions): Promise<ServerFilesResult<OperationDone>>;
    realPath(address: string, options?: ServerFilesOptions): Promise<ServerFilesResult<{readonly path: string}>>;
}

export const serverFilesKey: ServiceKey<ServerFiles> = defineServiceKey<ServerFiles>("nbook.files/server");

/** 虚拟根的文字呈现：读根本身得到它（docs/specs/agent/resources.md 输出 5）。 */
export function renderVirtual(listing: VirtualListing): string {
    const lines = listing.entries.map((entry) => {
        const meta = Object.entries(entry.meta ?? {}).map(([key, value]) => `${key}: ${value}`).join("，");
        return `- ${entry.address}${entry.title === undefined ? "" : ` ${entry.title}`}${meta === "" ? "" : `（${meta}）`}`;
    });
    return [listing.description, ...(lines.length === 0 ? [] : ["", ...lines])].join("\n");
}
