import {describe, expect, it} from "vitest";
import {createSessionIdentity, deriveSessionIdentity, resolveSessionIdentity} from "nbook/server/agent/session/session-identity";
import type {SessionMetadata} from "nbook/server/agent/session/types";

const metadata = (sessionId: number): Omit<SessionMetadata, "sessionIdentity"> => ({
    schemaVersion: 2,
    sessionId,
    profileKey: "leader.default",
    initial: {},
    createdAt: 1,
    kind: "chat",
});

describe("Session identity", () => {
    it("新 Session 使用 UUID，旧 header 使用稳定 sha256", () => {
        expect(createSessionIdentity()).toMatch(/^[0-9a-f-]{36}$/u);
        const first = deriveSessionIdentity(metadata(1));
        const second = deriveSessionIdentity({...metadata(1), profileKey: "leader.default"});
        expect(first).toBe(second);
        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);
    });

    it("显式 identity 优先于旧 header 派生值", () => {
        const identity = createSessionIdentity();
        expect(resolveSessionIdentity({...metadata(1), sessionIdentity: identity})).toBe(identity);
    });
});
