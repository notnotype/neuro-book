import {mkdtemp, readFile, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    compromise: null as ((error: Error) => void) | null,
    compromiseDuringWrite: null as (() => void) | null,
    release: vi.fn(async () => undefined),
}));

vi.mock("proper-lockfile", () => ({
    lock: vi.fn(async (_path: string, options?: {onCompromised?: (error: Error) => void}) => {
        mocks.compromise = options?.onCompromised ?? null;
        return mocks.release;
    }),
    lockSync: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const writeFile = vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
        mocks.compromiseDuringWrite?.();
        mocks.compromiseDuringWrite = null;
        return actual.writeFile(...args);
    });
    return {...actual, writeFile};
});

import {
    acquireAgentSessionStoreLease,
    agentSessionStoreLeasePath,
} from "nbook/server/agent/session/agent-session-store-lease";

describe("Agent Session Store lease compromise during acquisition", () => {
    const roots: string[] = [];

    beforeEach(() => {
        mocks.compromise = null;
        mocks.compromiseDuringWrite = null;
        mocks.release.mockClear();
    });

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("owner metadata写入期间失效时保留typed cause且不调用旧release", async () => {
        const root = await mkdtemp(testHostPath("nbook-session-lease-compromise-"));
        roots.push(root);
        const cause = new Error("heartbeat lost while writing owner metadata");
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);
        mocks.compromiseDuringWrite = () => mocks.compromise?.(cause);

        try {
            await expect(acquireAgentSessionStoreLease(root, "runtime")).rejects.toMatchObject({
                code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
                leasePath: agentSessionStoreLeasePath(root),
                cause,
            });
            await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }

        expect(mocks.release).not.toHaveBeenCalled();
        expect(JSON.parse(await readFile(agentSessionStoreLeasePath(root), "utf8"))).toMatchObject({kind: "runtime"});
    });
});
