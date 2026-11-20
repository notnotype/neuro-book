/**
 * bot 的合同（docs/specs/bots/bots.md、main-conversation.md）：贡献点 `bots.presets`、远程服务 `nbook.bots/bots` 与主对话的持有状态。
 * 前后端共用，不引 Node。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import type {ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";

export const BOTS_PLUGIN = "nbook.bots";
export const PRESETS_POINT = "bots.presets";
/** 岗位 Profile（bots.md 输出 3）。 */
export const COMPANION_PROFILE = "nbook.bots.companion";
/** 缺省预设与缺省 bot（bots.md 输出 2、4）：第一版只有一个 bot，id 固定。 */
export const DEFAULT_PRESET = "nbook.bots.lyra";
export const DEFAULT_BOT = "lyra";

/** bot id（bots.md 输出 5）：记录、创建凭据与目录名都按它核对。 */
export const BOT_ID_PATTERN = "^[a-z0-9-]{1,40}$";
export const BOT_ID = new RegExp(BOT_ID_PATTERN, "u");
/** 主对话的 id 由 bot id 定（main-conversation.md 输出 1）。 */
export const mainSessionId = (botId: string): string => `bot-${botId}`;

/** 头像的地址（bots.md 的头像路由）：浏览器拿它当 `<img>` 的 `src`。 */
export const avatarUrl = (botId: string): string => `/api/${BOTS_PLUGIN}/avatar/${encodeURIComponent(botId)}`;

/** 预设文件的上限（bots.md“输入与前置条件”）。 */
export const PERSONA_MAX_BYTES = 256 * 1024;
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export const SEED_MAX_FILES = 200;
export const SEED_MAX_BYTES = 4 * 1024 * 1024;

/** `bots.presets` 的声明；贡献 id 就是预设 id。名字单行，1–40 个字符。 */
export const PresetDeclarationSchema = Type.Object({
    name: Type.String({minLength: 1, maxLength: 40, pattern: "^[^\\r\\n]*$"}),
    avatar: Type.String({minLength: 1}),
    profile: Type.String({minLength: 1}),
    persona: Type.String({minLength: 1}),
    memorySeed: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});
export type BotPresetDeclaration = Static<typeof PresetDeclarationSchema>;

/** 插件包里的相对路径：用 `/` 分段，没有空段、`.`、`..`，不以 `/` 开头，没有反斜杠与冒号（协议、盘符）。 */
export function presetPathProblem(field: string, path: string): string | null {
    if (path.startsWith("/") || path.includes("\\") || path.includes(":")) return `${field} 要写成插件包里的相对路径（用 / 分段，不带协议或盘符）：${path}`;
    if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return `${field} 不能有空段、. 或 ..：${path}`;
    return null;
}

export const presetsPoint: ContributionPointDefinition<BotPresetDeclaration> = {
    id: PRESETS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    schema: PresetDeclarationSchema,
    validate: ({declaration}) => {
        const paths: [string, string | undefined][] = [["avatar", declaration.avatar], ["persona", declaration.persona], ["memorySeed", declaration.memorySeed]];
        for (const [field, path] of paths) {
            const problem = path === undefined ? null : presetPathProblem(field, path);
            if (problem !== null) return problem;
        }
        return null;
    },
};

/** 主对话的持有状态（main-conversation.md 输出 3）。 */
export type MainState =
    | {readonly state: "none"}
    | {readonly state: "opening"}
    | {readonly state: "held"}
    | {readonly state: "failed"; readonly code: string};

const MainStateSchema = Type.Union([
    Type.Object({state: Type.Literal("none")}, {additionalProperties: false}),
    Type.Object({state: Type.Literal("opening")}, {additionalProperties: false}),
    Type.Object({state: Type.Literal("held")}, {additionalProperties: false}),
    Type.Object({state: Type.Literal("failed"), code: Type.String()}, {additionalProperties: false}),
]);

/**
 * `unread`：“看到”之后的计数消息数，还没数完（持有之后补数之前、没有持有）为 null；`latestSeq` 是最新一条计数消息的 seq，没有未读时
 * 等于 `seenSeq`；`seenSeq` 是“看到”的位置（main-conversation.md 的未读）。`last` 是最后一条计数消息的摘要与时间（bots.md 输出 7），
 * 没有持有、还没补完时只有补数期间到的，再往前找不到为 null。
 */
const BotLastSchema = Type.Object({text: Type.String(), at: Type.Number()}, {additionalProperties: false});
export type BotLast = Static<typeof BotLastSchema>;
const BotItemSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    main: MainStateSchema,
    unread: Type.Union([Type.Integer({minimum: 0}), Type.Null()]),
    latestSeq: Type.Integer({minimum: 0}),
    seenSeq: Type.Integer({minimum: 0}),
    last: Type.Union([BotLastSchema, Type.Null()]),
}, {additionalProperties: false});
export type BotItem = Static<typeof BotItemSchema>;

const NoDetail = Type.Object({}, {additionalProperties: false});
/** `ensureMain` 的失败：`header`、`create`、`hold` 交回的码带可选的详情（main-conversation.md“失败与恢复”）。 */
const AnyDetail = Type.Optional(Type.Record(Type.String(), Type.Unknown()));
const OpenDetail = Type.Object({detail: AnyDetail}, {additionalProperties: false});
const MAIN_CODES = ["session-busy", "log-corrupt", "log-broken", "needs-migration", "storage-failed", "session-not-found", "session-exists", "invalid-session-id", "unknown-profile", "open-failed", "profile-invalid", "invalid-initial", "invalid-owner", "extension-missing", "dependency-missing", "dependency-cycle"] as const;

/** 远程服务（bots.md 输出 7）：先订阅 `botsChanged` 再取 `list`，`onResync` 时重取。版本 2：`list` 的项多了必有的 `last`，版本 1 的客户端读不了。 */
export const botsContract = defineRemoteService({
    id: "nbook.bots/bots",
    version: 2,
    provider: "server",
    callers: ["browser"],
    methods: {
        list: {input: Type.Object({}, {additionalProperties: false}), output: Type.Array(BotItemSchema), effect: "read"},
        ensureMain: {
            input: Type.Object({botId: Type.String()}, {additionalProperties: false}),
            output: Type.Object({sessionId: Type.String()}, {additionalProperties: false}),
            effect: "write",
            errors: {
                "unknown-bot": NoDetail,
                "owner-mismatch": NoDetail,
                ...(Object.fromEntries(MAIN_CODES.map((code) => [code, OpenDetail])) as {readonly [Code in (typeof MAIN_CODES)[number]]: typeof OpenDetail}),
            },
        },
        /** 记“看到”（main-conversation.md 的未读）：`through` 截到最新的计数消息，小于已存的不动。 */
        markSeen: {
            input: Type.Object({botId: Type.String(), through: Type.Integer({minimum: 0})}, {additionalProperties: false}),
            output: Type.Object({seenSeq: Type.Integer({minimum: 0})}, {additionalProperties: false}),
            effect: "write",
            errors: {"unknown-bot": NoDetail, "storage-failed": Type.Object({detail: Type.String()}, {additionalProperties: false})},
        },
    },
    events: {
        botsChanged: {filter: Type.Object({}, {additionalProperties: false}), payload: Type.Array(BotItemSchema)},
    },
});
