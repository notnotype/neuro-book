/**
 * 表情包的合同（docs/specs/agent/stickers.md）：贡献点 `stickers.packs`、目录条目、浏览器目录的远程服务与服务端服务键。
 * 前后端共用，不引 Node。
 */

import {Type} from "typebox";
import type {Static, TSchema} from "typebox";

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
/**
 * 交给浏览器的目录与概要，序列化后合计至多这么多字节（输出 18）：远程调用的单条消息至多 1 MiB（nb-host 的 `RPC_MAX_MESSAGE_BYTES`），
 * 超了整个窗口断开；留出消息外壳的余量。个数的上限挡不住长 id、长文件名与长说明。
 */
export const BROWSER_BYTES_MAX = 768 * 1024;

/**
 * 表情包页的暂存与替换时挪开的旧包放在 `user://stickers/` 里、以这两个前缀开头的文件夹（以点开头的不是表情包）。暂存只装没提交的
 * 内容，打开目录时删掉；挪开的旧包是用户的数据，不删也不自动改回，只写诊断（docs/specs/agent/stickers.md 输出 36）。
 */
export const STAGING_PREFIX = ".nbook-stickers-tmp-";
export const REPLACED_PREFIX = ".nbook-stickers-replaced-";
/** 表情包详情里每类 extras 至多列这么多张（总数照实）。 */
export const EXTRAS_MAX = 500;

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
    | {readonly code: "manifest-too-large" | "manifest-unreadable" | "manifest-invalid" | "folder-unreadable" | "folder-name" | "symlink"; readonly detail?: string};

/** 一个有效的表情。 */
export interface StickerEntry {
    readonly name: string;
    /** 清单里这一项写的名字原样；省略名字时没有（页面据此精确定位清单项）。 */
    readonly raw?: string;
    readonly file: string;
    /** 给模型看的说明。 */
    readonly description?: string;
    readonly common: boolean;
    readonly width: number;
    readonly height: number;
    /** 文件的修改时间与大小算出的版本，进取图地址。 */
    readonly version: string;
    /** 文件的字节数（表情包页显示）。 */
    readonly bytes: number;
}

/**
 * 表情包页要显示、却不是表情的图（docs/specs/agent/stickers.md 输出 26）：字节是相符的图片，但名字当不了表情名（`name`；`raw` 是
 * 清单里写的原样，没写为 null），或有表情列表时文件夹里清单没列（`unlisted`）。
 */
export interface StickerExtra {
    readonly file: string;
    readonly reason: "name" | "unlisted";
    readonly raw: string | null;
    readonly width: number;
    readonly height: number;
    readonly version: string;
    readonly bytes: number;
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
    /** 有效的表情，按清单顺序；没有表情列表时按文件名的码元顺序。 */
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
    /** 认不出（名字当不了表情名）与没加进来的图的张数（表情包页左栏的提示）。 */
    unrecognized: Type.Integer({minimum: 0}),
    unlisted: Type.Integer({minimum: 0}),
}, {additionalProperties: false});
export type StickerPackSummary = Static<typeof PackSummarySchema>;

/** 一个表情包两类 extras 的总数（详情里的列表可能截过，总数照实）。 */
export interface ExtraCounts {
    readonly unrecognized: number;
    readonly unlisted: number;
}

export function packSummary(pack: StickerPackEntry, counts: ExtraCounts = {unrecognized: 0, unlisted: 0}): StickerPackSummary {
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
        unrecognized: counts.unrecognized,
        unlisted: counts.unlisted,
    };
}

const DetailStickerSchema = Type.Object({
    name: Type.String(),
    raw: Type.Optional(Type.String()),
    file: Type.String(),
    description: Type.Optional(Type.String()),
    common: Type.Boolean(),
    width: Type.Number(),
    height: Type.Number(),
    bytes: Type.Integer({minimum: 0}),
    url: Type.String(),
}, {additionalProperties: false});

const DetailExtraSchema = Type.Object({
    file: Type.String(),
    reason: Type.Union([Type.Literal("name"), Type.Literal("unlisted")]),
    raw: Type.Union([Type.String(), Type.Null()]),
    width: Type.Number(),
    height: Type.Number(),
    bytes: Type.Integer({minimum: 0}),
    url: Type.String(),
}, {additionalProperties: false});

/**
 * 表情包页的一个表情包（docs/specs/agent/stickers.md 输出 26、27）。`token` 是文件夹的身份令牌（用户的包才有），改包名、删除、
 * 替换时原样带回，文件夹被别处换掉了就不做。`extras` 每类至多 `EXTRAS_MAX` 张，序列化后整份至多 `BROWSER_BYTES_MAX` 字节，
 * 放不下从后面截；`unrecognized`、`unlisted` 是总数。
 */
export const PackDetailSchema = Type.Object({
    summary: PackSummarySchema,
    listed: Type.Boolean(),
    token: Type.Union([Type.String(), Type.Null()]),
    stickers: Type.Array(DetailStickerSchema),
    extras: Type.Array(DetailExtraSchema),
}, {additionalProperties: false});
export type StickerPackDetail = Static<typeof PackDetailSchema>;

/**
 * 表情包页写入的失败码（docs/specs/agent/stickers.md 输出 28 到 34 与失败表）：文件服务的失败映射过来，不透传；`detail` 是给人看的
 * 原因（不含宿主路径）。
 */
export const EDIT_CODES = [
    "not-user-pack", "pack-missing", "pack-exists", "pack-changed", "folder-invalid", "name-invalid", "name-duplicate",
    "description-invalid", "sticker-missing", "manifest-full", "too-large", "permission-denied", "write-failed", "refresh-failed", "busy", "request-aborted",
] as const;
export type EditCode = (typeof EDIT_CODES)[number];
/** 加图、导入、导出另有的码（只经 HTTP 路由交回，不在远程方法里）。 */
export const ARCHIVE_CODES = ["image-rejected", "import-invalid", "import-conflict", "export-too-large", "export-empty", "export-conflict", "pack-invalid"] as const;
export type ArchiveCode = (typeof ARCHIVE_CODES)[number];

const EditDetail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const editErrors = Object.fromEntries(EDIT_CODES.map((code) => [code, EditDetail])) as {readonly [Code in EditCode]: typeof EditDetail};
const Empty = Type.Object({}, {additionalProperties: false});
const Id = Type.String();
const Created = Type.Object({id: Type.String()}, {additionalProperties: false});
const Text = Type.Optional(Type.Union([Type.String(), Type.Null()]));
/** 表情的定位：文件名加名字（清单里写的或推出来的；没写名字的认不出的图为 null）。 */
const Target = {file: Type.String(), name: Type.Union([Type.String(), Type.Null()])};
const write = <I extends TSchema, O extends TSchema>(input: I, output: O) => ({input, output, effect: "write" as const, errors: editErrors});

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
        /** 表情包页的一个表情包。 */
        pack: {input: Type.Object({id: Type.String()}, {additionalProperties: false}), output: PackDetailSchema, effect: "read", errors: {"pack-missing": Type.Object({}, {additionalProperties: false})}},
        /** 用系统的文件管理器打开这个表情包的文件夹（输出 37）；`no-desktop`、`open-failed` 带路径，界面写进通知。 */
        revealPack: {
            input: Type.Object({id: Type.String()}, {additionalProperties: false}),
            output: Type.Object({}, {additionalProperties: false}),
            effect: "write",
            errors: {
                "pack-missing": Type.Object({}, {additionalProperties: false}),
                "no-desktop": Type.Object({path: Type.String()}, {additionalProperties: false}),
                "open-failed": Type.Object({path: Type.String(), detail: Type.String()}, {additionalProperties: false}),
            },
        },
        /** 表情包页的写入（输出 28 到 34）：返回时目录已是写完的样子；建、改名、复制交回结果包的 id。 */
        createPack: write(Type.Object({folder: Type.String(), title: Text}, {additionalProperties: false}), Created),
        updatePack: write(Type.Object({id: Id, title: Text, description: Text}, {additionalProperties: false}), Empty),
        renamePack: write(Type.Object({id: Id, folder: Type.String(), token: Type.String()}, {additionalProperties: false}), Created),
        deletePack: write(Type.Object({id: Id, token: Type.String()}, {additionalProperties: false}), Empty),
        updateSticker: write(Type.Object({id: Id, ...Target, change: Type.Object({name: Text, description: Text, common: Type.Optional(Type.Boolean())}, {additionalProperties: false})}, {additionalProperties: false}), Empty),
        deleteSticker: write(Type.Object({id: Id, ...Target}, {additionalProperties: false}), Empty),
        listFiles: write(Type.Object({id: Id, files: Type.Union([Type.Array(Type.String(), {maxItems: 1000}), Type.Literal("all")])}, {additionalProperties: false}), Type.Object({added: Type.Integer({minimum: 0})}, {additionalProperties: false})),
        deleteFile: write(Type.Object({id: Id, file: Type.String()}, {additionalProperties: false}), Empty),
        copyPack: write(Type.Object({id: Id}, {additionalProperties: false}), Created),
    },
    events: {
        changed: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Object({}, {additionalProperties: false})},
    },
});
