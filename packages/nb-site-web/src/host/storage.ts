/**
 * 浏览器端的存储（t10 计划 3.9；frontend.md“客户端持久化与存储分层”）：官方站只有两样东西要跨过去上游的整页跳转：
 * 社交注册跳去上游之前表单里填的内容（上游带着 `social_error` 回来时还原表单），与社交登录跳去上游之前登录页地址上的续接令牌
 * （`session/continue.ts`；回来时还原到地址，之后的密码登录与“去注册”照样回到授权请求）。本模块是站点里唯一碰 `sessionStorage` 的地方。
 *
 * - `sessionStorage` 而不是 `localStorage`：只在这个标签页里，关掉就没有。
 * - 读写都包 try/catch：隐私模式、存储被禁用、配额满时只是不暂存，打一条 `console.warn`。
 * - 只存一次：读出来就删（`take`）；超过 10 分钟的当没有并删掉，与上游跳转地址的有效期相同（`site.accounts` 的“时序与寿命”）。
 *   没人来读的不等着：站点启动时删掉过期的（`dropExpired`），登录之后删掉（`site.ts`）。
 * - 不存密码，连同关联上游时输入的当前密码（社交注册本来不设密码）。注册码要存（计划第 9 节 D5 的审定）。
 */

import {SOCIAL_PROVIDERS} from "@notnotype/nb-site-identity-contract/constants";
import type {SocialProvider} from "@notnotype/nb-site-identity-contract/constants";

const PREFIX = "nb-site.";
const SOCIAL_REGISTER_DRAFT_KEY = `${PREFIX}social-register-draft`;
const SOCIAL_LOGIN_CONTINUE_KEY = `${PREFIX}social-login-continue`;

/** 草稿与续接令牌的寿命：上游跳转地址的有效期（`site.accounts` 的“时序与寿命”）。 */
export const SOCIAL_REGISTER_DRAFT_TTL_MS = 10 * 60 * 1000;

/** 社交注册的表单草稿（计划 3.9“存什么”）。空着的项存空字符串，与表单的值一致。 */
export interface SocialRegisterDraft {
    readonly provider: SocialProvider;
    readonly username: string;
    readonly displayName: string;
    readonly inviteCode: string;
    readonly registrationCode: string;
    readonly consent: {readonly termsVersion: string; readonly overseas: boolean};
    /** 登录续接的令牌（`session/continue.ts`）：从授权请求来的人做社交注册、没成回到注册页时，跟着表单一起还原。没有就不出现。 */
    readonly continue?: string;
}

/** 落在存储里的样子：多一个格式版本与写入时刻（毫秒）。 */
interface StoredDraft extends SocialRegisterDraft {
    readonly v: 1;
    readonly savedAt: number;
}

interface StoredContinue {
    readonly v: 1;
    readonly savedAt: number;
    readonly continue: string;
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
    /** 社交登录的发起请求成功、拿到上游地址之后，`location.assign` 之前调用；登录页地址上没有令牌时不调用。 */
    saveSocialLoginContinue(token: string): void;
    /** 回到登录页且带 `social_error` 时调用：读出来并删掉；没有、过期或存坏了回 `undefined`。 */
    takeSocialLoginContinue(): string | undefined;
    /** 登录成功、不带 `social_error` 进登录页时调用。 */
    clearSocialLoginContinue(): void;
    /** 站点启动时调用：两样东西里过期、存坏了的删掉，还在有效期里的留着（他可能正从上游回来）。 */
    dropExpired(): void;
}

function isDraft(value: unknown): value is StoredDraft {
    if (typeof value !== "object" || value === null) return false;
    const draft = value as Partial<Record<keyof StoredDraft, unknown>>;
    const consent = draft.consent as {termsVersion?: unknown; overseas?: unknown} | null | undefined;
    return draft.v === 1
        && typeof draft.savedAt === "number"
        && (SOCIAL_PROVIDERS as readonly unknown[]).includes(draft.provider)
        && typeof draft.username === "string"
        && typeof draft.displayName === "string"
        && typeof draft.inviteCode === "string"
        && typeof draft.registrationCode === "string"
        && typeof consent === "object" && consent !== null
        && typeof consent.termsVersion === "string"
        && typeof consent.overseas === "boolean"
        && (draft.continue === undefined || typeof draft.continue === "string");
}

function isStoredContinue(value: unknown): value is StoredContinue {
    if (typeof value !== "object" || value === null) return false;
    const stored = value as Partial<Record<keyof StoredContinue, unknown>>;
    return stored.v === 1 && typeof stored.savedAt === "number" && typeof stored.continue === "string" && stored.continue !== "";
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

    /** 存着的原文能不能用：解析得出、形状对、在有效期里。不能用的回 `undefined`，存坏了的打一条警告。 */
    function valid<Stored extends {readonly savedAt: number}>(text: string, isStored: (value: unknown) => value is Stored, name: string): Stored | undefined {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            console.warn(`${name}不是合法 JSON，按没有处理`, error);
            return undefined;
        }
        if (!isStored(parsed)) {
            console.warn(`${name}的形状不对，按没有处理`);
            return undefined;
        }
        const age = options.now() - parsed.savedAt;
        if (age < 0 || age > SOCIAL_REGISTER_DRAFT_TTL_MS) return undefined;
        return parsed;
    }

    const validDraft = (text: string): StoredDraft | undefined => valid(text, isDraft, "注册草稿");
    const validContinue = (text: string): StoredContinue | undefined => valid(text, isStoredContinue, "社交登录的续接令牌");

    /** 读出来并删掉：只用一次。 */
    function take(key: string): string | null {
        const text = read(key);
        if (text !== null) remove(key);
        return text;
    }

    function dropIfInvalid(key: string, validate: (text: string) => unknown): void {
        const text = read(key);
        if (text !== null && validate(text) === undefined) remove(key);
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
                ...(draft.continue === undefined ? {} : {continue: draft.continue}),
            };
            write(SOCIAL_REGISTER_DRAFT_KEY, JSON.stringify(stored));
        },
        takeSocialRegisterDraft() {
            const text = take(SOCIAL_REGISTER_DRAFT_KEY);
            if (text === null) return undefined;
            const parsed = validDraft(text);
            if (parsed === undefined) return undefined;
            const {v: _version, savedAt: _savedAt, ...draft} = parsed;
            return draft;
        },
        clearSocialRegisterDraft() {
            remove(SOCIAL_REGISTER_DRAFT_KEY);
        },
        saveSocialLoginContinue(token) {
            write(SOCIAL_LOGIN_CONTINUE_KEY, JSON.stringify({v: 1, savedAt: options.now(), continue: token} satisfies StoredContinue));
        },
        takeSocialLoginContinue() {
            const text = take(SOCIAL_LOGIN_CONTINUE_KEY);
            return text === null ? undefined : validContinue(text)?.continue;
        },
        clearSocialLoginContinue() {
            remove(SOCIAL_LOGIN_CONTINUE_KEY);
        },
        dropExpired() {
            dropIfInvalid(SOCIAL_REGISTER_DRAFT_KEY, validDraft);
            dropIfInvalid(SOCIAL_LOGIN_CONTINUE_KEY, validContinue);
        },
    };
}
