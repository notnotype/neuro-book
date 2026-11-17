/**
 * 表情包的合同（docs/specs/agent/stickers.md）：贡献点 `stickers.packs`、目录条目、浏览器目录的远程服务与服务端服务键。
 * 前后端共用，不引 Node。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {StickerResolver} from "@notnotype/nb-markdown";
import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export const STICKERS_PLUGIN = "nbook.stickers";
export const STICKERS_POINT = "stickers.packs";
export const STICKERS_SCHEME = "stickers";
export const STICKERS_ROUTE_PREFIX = `/api/${STICKERS_PLUGIN}`;

/** 输入与前置条件的上限。 */
export const MANIFEST_FILE = "stickers.json";
export const MANIFEST_MAX_BYTES = 256 * 1024;
export const STICKERS_PER_PACK_MAX = 500;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 1024;
export const TEXT_MAX = 200;
/** 浏览器目录合计至多这么多个表情（输出 18）。 */
export const BROWSER_STICKERS_MAX = 5000;

/** 文件夹名：1–64 个小写字母、数字与连字符，不以连字符开头或结尾，没有连续的连字符。 */
export const FOLDER_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** 扩展名（小写）→ 按字节判定应得的类型。 */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {png: "image/png", gif: "image/gif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg"};

/** `stickers.packs` 的声明：插件包里一个目录，里面每个子文件夹是一个表情包。 */
export const PacksDeclarationSchema = Type.Object({directory: Type.String({minLength: 1})}, {additionalProperties: false});
export type StickerPacksDeclaration = Static<typeof PacksDeclarationSchema>;

/** 声明的目录写成插件包里的相对路径，用 `/` 分段，规则同 `agent.skills`。 */
export function packsDirectoryProblem(directory: string): string | null {
    if (directory.startsWith("/") || directory.includes("\\") || directory.includes(":")) return `表情包目录 ${directory} 要写成插件包里的相对路径（用 / 分段，不带协议或盘符）`;
    if (directory.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return `表情包目录 ${directory} 不能有空段、. 或 ..`;
    return null;
}

export const packsPoint: ContributionPointDefinition<StickerPacksDeclaration> = {
    id: STICKERS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    schema: PacksDeclarationSchema,
    validate: (descriptor) => packsDirectoryProblem(descriptor.declaration.directory),
};

export type StickerSource = "user" | "plugin";

export type StickerPackProblem =
    | {readonly code: "manifest-missing" | "manifest-too-large" | "manifest-unreadable" | "manifest-invalid" | "folder-name" | "symlink"; readonly detail?: string};

/** 一个有效的表情。 */
export interface StickerEntry {
    readonly name: string;
    readonly file: string;
    readonly when?: string;
    readonly common: boolean;
    readonly width: number;
    readonly height: number;
    /** 文件的修改时间与大小算出的版本，进取图地址。 */
    readonly version: string;
}

export interface StickerPackEntry {
    /** `user.<文件夹名>` 或 `<插件 id>.<文件夹名>`。 */
    readonly id: string;
    readonly folder: string;
    readonly source: StickerSource;
    /** 插件来源的插件 id 与显示名。 */
    readonly plugin?: {readonly id: string; readonly title: string | null};
    readonly title: string;
    readonly description?: string;
    readonly status: "ok" | "invalid";
    readonly problem?: StickerPackProblem;
    /** 有效的表情，按清单顺序。 */
    readonly stickers: readonly StickerEntry[];
}

export const packId = (prefix: string, folder: string): string => `${prefix}.${folder}`;

/** 取图地址（相对应用的源）。 */
export const stickerImageUrl = (pack: string, sticker: Pick<StickerEntry, "file" | "version">): string => `${STICKERS_ROUTE_PREFIX}/image/${encodeURIComponent(pack)}/${encodeURIComponent(sticker.file)}?v=${encodeURIComponent(sticker.version)}`;

/** 服务端给别的插件（`nbook.agent` 的槽）的服务。 */
export interface StickersService {
    /** 全部表情包（含无效的），按 id 的码元顺序。 */
    list(): readonly StickerPackEntry[];
    onChanged(listener: () => void): () => void;
}

export const stickersServiceKey: ServiceKey<StickersService> = defineServiceKey<StickersService>("nbook.stickers/catalog");

/** 浏览器一侧给 `nbook.markdown` 的服务：按写法查表情（nb-markdown 的宿主端口 `stickers`）。 */
export const stickerResolverKey: ServiceKey<StickerResolver> = defineServiceKey<StickerResolver>("nbook.stickers/resolver");

const BrowserStickerSchema = Type.Object({name: Type.String(), width: Type.Number(), height: Type.Number(), url: Type.String()}, {additionalProperties: false});
const BrowserPackSchema = Type.Object({id: Type.String(), folder: Type.String(), stickers: Type.Array(BrowserStickerSchema)}, {additionalProperties: false});
export type BrowserStickerPack = Static<typeof BrowserPackSchema>;

/** 设置页用的表情包概要（输出 19）：每个表情包一行，带第一个常用表情的缩略图地址（没有常用的取第一个，没有表情为 null）。 */
const PackSummarySchema = Type.Object({
    id: Type.String(),
    folder: Type.String(),
    source: Type.Union([Type.Literal("user"), Type.Literal("plugin")]),
    plugin: Type.Optional(Type.Object({id: Type.String(), title: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false})),
    title: Type.String(),
    description: Type.Optional(Type.String()),
    status: Type.Union([Type.Literal("ok"), Type.Literal("invalid")]),
    problem: Type.Optional(Type.String()),
    count: Type.Integer({minimum: 0}),
    thumbnail: Type.Union([Type.String(), Type.Null()]),
}, {additionalProperties: false});
export type StickerPackSummary = Static<typeof PackSummarySchema>;

export function packSummary(pack: StickerPackEntry): StickerPackSummary {
    const first = pack.stickers.find((sticker) => sticker.common) ?? pack.stickers[0];
    return {
        id: pack.id,
        folder: pack.folder,
        source: pack.source,
        ...(pack.plugin === undefined ? {} : {plugin: pack.plugin}),
        title: pack.title,
        ...(pack.description === undefined ? {} : {description: pack.description}),
        status: pack.status,
        ...(pack.problem === undefined ? {} : {problem: pack.problem.code}),
        count: pack.stickers.length,
        thumbnail: first === undefined ? null : stickerImageUrl(pack.id, first),
    };
}

/** 浏览器目录（输出 18）：先订阅 `changed` 再取。 */
export const stickersCatalogContract = defineRemoteService({
    id: "nbook.stickers/catalog",
    version: 1,
    provider: "server",
    callers: ["browser"],
    methods: {
        catalog: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(BrowserPackSchema), effect: "read"},
        /** 设置页的表情包列表（含无效的）。 */
        packs: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(PackSummarySchema), effect: "read"},
    },
    events: {
        changed: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Object({}, {additionalProperties: false})},
    },
});
