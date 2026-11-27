/**
 * 浏览器端的存储（t10 计划 3.9）：用 happy-dom 真的 `sessionStorage`，时刻由测试给定。
 */

import {afterEach, describe, expect, it} from "vitest";

import {createSiteStorage, SOCIAL_REGISTER_DRAFT_TTL_MS} from "./storage";
import type {SocialRegisterDraft} from "./storage";

const DRAFT: SocialRegisterDraft = {
    provider: "github",
    username: "alice",
    displayName: "Alice",
    inviteCode: "",
    registrationCode: "REG-123",
    consent: {termsVersion: "2026-11-01", overseas: true},
};

function setup(start = 1_000_000) {
    let now = start;
    const storage = createSiteStorage({storage: () => window.sessionStorage, now: () => now});
    return {
        storage,
        advance(ms: number) {
            now += ms;
        },
        setNow(ms: number) {
            now = ms;
        },
    };
}

afterEach(() => {
    window.sessionStorage.clear();
});

describe("社交注册的草稿", () => {
    it("存下的草稿原样读回，只存在 sessionStorage 的一个键里", () => {
        const {storage} = setup();
        storage.saveSocialRegisterDraft(DRAFT);
        expect(window.sessionStorage.length).toBe(1);
        expect(window.localStorage.length).toBe(0);
        expect(storage.takeSocialRegisterDraft()).toEqual(DRAFT);
    });

    it("读一次就删：第二次读不到", () => {
        const {storage} = setup();
        storage.saveSocialRegisterDraft(DRAFT);
        expect(storage.takeSocialRegisterDraft()).toEqual(DRAFT);
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
        expect(window.sessionStorage.length).toBe(0);
    });

    it("十分钟以内读得到，超过就当没有，也删掉", () => {
        const within = setup();
        within.storage.saveSocialRegisterDraft(DRAFT);
        within.advance(SOCIAL_REGISTER_DRAFT_TTL_MS);
        expect(within.storage.takeSocialRegisterDraft()).toEqual(DRAFT);

        const expired = setup();
        expired.storage.saveSocialRegisterDraft(DRAFT);
        expired.advance(SOCIAL_REGISTER_DRAFT_TTL_MS + 1);
        expect(expired.storage.takeSocialRegisterDraft()).toBeUndefined();
        expect(window.sessionStorage.length).toBe(0);
    });

    it("写入时刻在现在之后（时钟被往回拨）的当没有", () => {
        const {storage, setNow} = setup(5_000_000);
        storage.saveSocialRegisterDraft(DRAFT);
        setNow(4_000_000);
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
    });

    it("删过期的：过期与存坏了的删掉，没过期的留着、之后照样读得到", () => {
        const fresh = setup();
        fresh.storage.saveSocialRegisterDraft(DRAFT);
        fresh.advance(SOCIAL_REGISTER_DRAFT_TTL_MS);
        fresh.storage.dropExpired();
        expect(fresh.storage.takeSocialRegisterDraft()).toEqual(DRAFT);

        const expired = setup();
        expired.storage.saveSocialRegisterDraft(DRAFT);
        expired.advance(SOCIAL_REGISTER_DRAFT_TTL_MS + 1);
        expired.storage.dropExpired();
        expect(window.sessionStorage.length).toBe(0);

        const broken = setup();
        broken.storage.saveSocialRegisterDraft(DRAFT);
        window.sessionStorage.setItem(window.sessionStorage.key(0)!, "{不是 JSON");
        broken.storage.dropExpired();
        expect(window.sessionStorage.length).toBe(0);
    });

    it("清掉之后读不到", () => {
        const {storage} = setup();
        storage.saveSocialRegisterDraft(DRAFT);
        storage.clearSocialRegisterDraft();
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
    });

    it("存坏了（不是 JSON、形状不对、版本不认识）的当没有，也删掉", () => {
        const {storage} = setup();
        storage.saveSocialRegisterDraft(DRAFT);
        const key = window.sessionStorage.key(0)!;
        const stored = JSON.parse(window.sessionStorage.getItem(key)!) as Record<string, unknown>;
        const broken = [
            "{不是 JSON",
            JSON.stringify(null),
            JSON.stringify({...stored, v: 2}),
            JSON.stringify({...stored, provider: "facebook"}),
            JSON.stringify({...stored, consent: {termsVersion: "x"}}),
            JSON.stringify({...stored, savedAt: "昨天"}),
        ];
        for (const text of broken) {
            window.sessionStorage.setItem(key, text);
            expect({text, draft: storage.takeSocialRegisterDraft()}).toEqual({text, draft: undefined});
            expect(window.sessionStorage.length).toBe(0);
        }
    });

    it("存储不可用（取存储本身就抛）时存、读、清都不抛，读到的是没有", () => {
        const storage = createSiteStorage({
            storage: () => {
                throw new DOMException("The operation is insecure.", "SecurityError");
            },
            now: () => 0,
        });
        expect(() => storage.saveSocialRegisterDraft(DRAFT)).not.toThrow();
        expect(storage.takeSocialRegisterDraft()).toBeUndefined();
        expect(() => storage.clearSocialRegisterDraft()).not.toThrow();
        expect(() => storage.dropExpired()).not.toThrow();
    });
});

describe("社交登录的续接令牌", () => {
    it("存进去、读出来是原样；读一次就删", () => {
        const {storage} = setup();
        storage.saveSocialLoginContinue("ct_123");
        expect(storage.takeSocialLoginContinue()).toBe("ct_123");
        expect(storage.takeSocialLoginContinue()).toBeUndefined();
        expect(window.sessionStorage.length).toBe(0);
    });

    it("与注册草稿同样的寿命：到期那一刻还在，过了就没有；启动时删掉过期与存坏了的，没过期的留着", () => {
        const fresh = setup();
        fresh.storage.saveSocialLoginContinue("ct_123");
        fresh.advance(SOCIAL_REGISTER_DRAFT_TTL_MS);
        fresh.storage.dropExpired();
        expect(fresh.storage.takeSocialLoginContinue()).toBe("ct_123");

        const expired = setup();
        expired.storage.saveSocialLoginContinue("ct_123");
        expired.advance(SOCIAL_REGISTER_DRAFT_TTL_MS + 1);
        expired.storage.dropExpired();
        expect(window.sessionStorage.length).toBe(0);

        const broken = setup();
        broken.storage.saveSocialLoginContinue("ct_123");
        window.sessionStorage.setItem(window.sessionStorage.key(0)!, JSON.stringify({v: 1, savedAt: 1_000_000, continue: 7}));
        broken.storage.dropExpired();
        expect(window.sessionStorage.length).toBe(0);
    });

    it("与注册草稿互不影响：清掉一样，另一样还在", () => {
        const {storage} = setup();
        storage.saveSocialRegisterDraft(DRAFT);
        storage.saveSocialLoginContinue("ct_123");
        storage.clearSocialRegisterDraft();
        expect(storage.takeSocialLoginContinue()).toBe("ct_123");
        storage.saveSocialLoginContinue("ct_456");
        storage.saveSocialRegisterDraft(DRAFT);
        storage.clearSocialLoginContinue();
        expect(storage.takeSocialLoginContinue()).toBeUndefined();
        expect(storage.takeSocialRegisterDraft()).toEqual(DRAFT);
    });
});
