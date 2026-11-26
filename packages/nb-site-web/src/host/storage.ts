/**
 * 浏览器端的存储（t10 计划 3.9；frontend.md“客户端持久化与存储分层”）：官方站只有一样东西要跨过整页跳转，
 * 就是社交注册跳去上游之前表单里填的内容（上游带着 `social_error` 回来时还原表单）。本模块是站点里唯一碰 `sessionStorage` 的地方。
 *
 * - `sessionStorage` 而不是 `localStorage`：只在这个标签页里，关掉就没有。
 * - 读写都包 try/catch：隐私模式、存储被禁用、配额满时只是不暂存，打一条 `console.warn`。
 * - 只存一次：读出来就删（`take`）；超过 10 分钟的当没有并删掉，与上游跳转地址的有效期相同（`site.accounts` 的“时序与寿命”）。
 * - 不存密码，连同关联上游时输入的当前密码（社交注册本来不设密码）。注册码要存（计划第 9 节 D5 的审定）。
 */

import type {SocialProvider} from "@notnotype/nb-site-identity-contract";

const PREFIX = "nb-site.";
const SOCIAL_REGISTER_DRAFT_KEY = `${PREFIX}social-register-draft`;

/** 草稿的寿命：上游跳转地址的有效期（`site.accounts` 的“时序与寿命”）。 */
export const SOCIAL_REGISTER_DRAFT_TTL_MS = 10 * 60 * 1000;

/** 社交注册的表单草稿（计划 3.9“存什么”）。空着的项存空字符串，与表单的值一致。 */
export interface SocialRegisterDraft {
    readonly provider: SocialProvider;
    readonly username: string;
    readonly displayName: string;
    readonly inviteCode: string;
    readonly registrationCode: string;
    readonly consent: {readonly termsVersion: string; readonly overseas: boolean};
}

/** 落在存储里的样子：多一个格式版本与写入时刻（毫秒）。 */
interface StoredDraft extends SocialRegisterDraft {
    readonly v: 1;
    readonly savedAt: number;
}

export interface SiteStorageOptions {
    /**
     * 取存储。产品里是 `() => window.sessionStorage`：访问这个属性本身就可能抛（存储被禁用时浏览器抛 `SecurityError`），
     * 所以给函数，在 try 里取。
     */
    readonly storage: () => Storage;
    readonly now: () => number;
}

export interface SiteStorage {
    /** 社交注册的发起请求成功、拿到上游地址之后，`location.assign` 之前调用。 */
    saveSocialRegisterDraft(draft: SocialRegisterDraft): void;
    /** 回到注册页且带 `social_error` 时调用：读出来并删掉；没有、过期或存坏了回 `undefined`。 */
    takeSocialRegisterDraft(): SocialRegisterDraft | undefined;
    /** 注册成功、登出、不带 `social_error` 进注册页时调用。 */
    clearSocialRegisterDraft(): void;
}

function isDraft(value: unknown): value is StoredDraft {
    if (typeof value !== "object" || value === null) return false;
    const draft = value as Partial<Record<keyof StoredDraft, unknown>>;
    const consent = draft.consent as {termsVersion?: unknown; overseas?: unknown} | null | undefined;
    return draft.v === 1
        && typeof draft.savedAt === "number"
        && (draft.provider === "google" || draft.provider === "github")
        && typeof draft.username === "string"
        && typeof draft.displayName === "string"
        && typeof draft.inviteCode === "string"
        && typeof draft.registrationCode === "string"
        && typeof consent === "object" && consent !== null
        && typeof consent.termsVersion === "string"
        && typeof consent.overseas === "boolean";
}

export function createSiteStorage(options: SiteStorageOptions): SiteStorage {
    function read(key: string): string | null {
        try {
            return options.storage().getItem(key);
        } catch (error) {
            console.warn(`读不了浏览器存储 ${key}，按没有处理`, error);
            return null;
        }
    }

    function write(key: string, value: string): void {
        try {
            options.storage().setItem(key, value);
        } catch (error) {
            console.warn(`存不了浏览器存储 ${key}，这次不暂存`, error);
        }
    }

    function remove(key: string): void {
        try {
            options.storage().removeItem(key);
        } catch (error) {
            console.warn(`删不了浏览器存储 ${key}`, error);
        }
    }

    return {
        saveSocialRegisterDraft(draft) {
            const stored: StoredDraft = {
                v: 1,
                savedAt: options.now(),
                provider: draft.provider,
                username: draft.username,
                displayName: draft.displayName,
                inviteCode: draft.inviteCode,
                registrationCode: draft.registrationCode,
                consent: {termsVersion: draft.consent.termsVersion, overseas: draft.consent.overseas},
            };
            write(SOCIAL_REGISTER_DRAFT_KEY, JSON.stringify(stored));
        },
        takeSocialRegisterDraft() {
            const text = read(SOCIAL_REGISTER_DRAFT_KEY);
            if (text === null) return undefined;
            remove(SOCIAL_REGISTER_DRAFT_KEY);
            let parsed: unknown;
            try {
                parsed = JSON.parse(text);
            } catch (error) {
                console.warn("注册草稿不是合法 JSON，按没有处理", error);
                return undefined;
            }
            if (!isDraft(parsed)) {
                console.warn("注册草稿的形状不对，按没有处理");
                return undefined;
            }
            const age = options.now() - parsed.savedAt;
            if (age < 0 || age > SOCIAL_REGISTER_DRAFT_TTL_MS) return undefined;
            const {v: _version, savedAt: _savedAt, ...draft} = parsed;
            return draft;
        },
        clearSocialRegisterDraft() {
            remove(SOCIAL_REGISTER_DRAFT_KEY);
        },
    };
}
