import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import type {ReadyAgentSessionStore} from "nbook/server/agent/session/agent-session-store";

type RuntimeEntry = {
    rootWorkspace: string;
    active: {
        readonly ready: ReadyAgentSessionStore;
        release(): Promise<void>;
    } | null;
    phase: "idle" | "starting" | "active" | "closing" | "compromised";
    transition: Promise<void>;
};

type SharedLeaseEntry = {
    refs: number;
    physicalLease: Promise<() => Promise<void>>;
    phase: "open" | "releasing" | "release_failed";
    releasePromise: Promise<void> | null;
};

type HmrGlobals = {
    __nbookAgentSessionStoreRuntimesV3?: Map<string, RuntimeEntry>;
    __nbookAgentSessionStoreRuntimesV4?: Map<string, RuntimeEntry>;
    __nbookAgentSessionStoreRuntimeLeasesV1?: Map<string, SharedLeaseEntry>;
    __nbookAgentSessionStoreRuntimeLeasesV2?: Map<string, SharedLeaseEntry>;
};

const hmrGlobals = globalThis as unknown as HmrGlobals;

describe("Agent Session Store HMR registry", () => {
    afterEach(() => {
        delete hmrGlobals.__nbookAgentSessionStoreRuntimesV3;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimesV4;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV1;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV2;
        vi.resetModules();
    });

    it("旧runtime registry升级后fail closed并保留同一Map", async () => {
        const root = testHostPath("tmp", `hmr-runtime-${randomUUID()}`);
        const key = runtimeKey(root);
        const ready = {schemaVersion: 2, rootWorkspace: root} as unknown as ReadyAgentSessionStore;
        const release = vi.fn(async () => undefined);
        const transition = Promise.resolve();
        const entry: RuntimeEntry = {
            rootWorkspace: root,
            active: {ready, release},
            phase: "active",
            transition,
        };
        const previous = new Map([[key, entry]]);
        hmrGlobals.__nbookAgentSessionStoreRuntimesV3 = previous;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimesV4;

        const runtime = await import("nbook/server/agent/session/agent-session-store-runtime");

        const upgradedRuntimes = hmrGlobals.__nbookAgentSessionStoreRuntimesV4 as unknown as Map<string, RuntimeEntry>;
        expect(upgradedRuntimes).toBe(previous);
        expect(upgradedRuntimes.get(key)).toBe(entry);
        expect(entry.transition).toBe(transition);
        expect(() => runtime.requireReadyAgentSessionStore(root)).toThrow(
            "Agent Session Store runtime lease已失去所有权",
        );
        await expect(runtime.observeAgentSessionStoreRuntimeCompromised(root)).resolves.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
        });

        await runtime.stopAgentSessionStoreRuntime(root);
        expect(release).not.toHaveBeenCalled();
        await expect(runtime.startAgentSessionStoreRuntime(root)).rejects.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
        });
    });

    it("HMR重载期间starting transition完成前不重复取得runtime lease", async () => {
        const root = testHostPath("tmp", `hmr-starting-${randomUUID()}`);
        const ready = {schemaVersion: 2, rootWorkspace: root} as unknown as ReadyAgentSessionStore;
        const release = vi.fn(async () => undefined);
        const active = {
            ready,
            release,
            assertHealthy: vi.fn(),
            compromised: new Promise<never>(() => undefined),
        };
        let entry!: RuntimeEntry;
        let finishTransition!: () => void;
        const transition = new Promise<void>((resolvePromise) => {
            finishTransition = () => {
                entry.active = active;
                entry.phase = "active";
                resolvePromise();
            };
        });
        entry = {
            rootWorkspace: root,
            active: null,
            phase: "starting",
            transition,
        };
        const previous = new Map([[runtimeKey(root), entry]]);
        hmrGlobals.__nbookAgentSessionStoreRuntimesV4 = previous;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimesV3;

        const runtime = await import("nbook/server/agent/session/agent-session-store-runtime");
        const starting = runtime.startAgentSessionStoreRuntime(root);
        let settled = false;
        void starting.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(entry.phase).toBe("starting");

        finishTransition();
        await expect(starting).resolves.toBe(ready);
        expect(active.assertHealthy).toHaveBeenCalledOnce();
    });

    it("HMR重载期间closing transition完成前不提前释放或改变runtime", async () => {
        const root = testHostPath("tmp", `hmr-closing-${randomUUID()}`);
        const ready = {schemaVersion: 2, rootWorkspace: root} as unknown as ReadyAgentSessionStore;
        const release = vi.fn(async () => undefined);
        const active = {
            ready,
            release,
            assertHealthy: vi.fn(),
            compromised: new Promise<never>(() => undefined),
        };
        let entry!: RuntimeEntry;
        let finishTransition!: () => void;
        const transition = new Promise<void>((resolvePromise) => {
            finishTransition = () => {
                entry.active = null;
                entry.phase = "idle";
                resolvePromise();
            };
        });
        entry = {
            rootWorkspace: root,
            active,
            phase: "closing",
            transition,
        } as unknown as RuntimeEntry;
        const previous = new Map([[runtimeKey(root), entry]]);
        hmrGlobals.__nbookAgentSessionStoreRuntimesV4 = previous;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimesV3;

        const runtime = await import("nbook/server/agent/session/agent-session-store-runtime");
        const stopping = runtime.stopAgentSessionStoreRuntime(root);
        let settled = false;
        void stopping.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(release).not.toHaveBeenCalled();
        expect(entry.phase).toBe("closing");

        finishTransition();
        await stopping;
        expect(release).not.toHaveBeenCalled();
        expect(entry.active).toBeNull();
        expect(entry.phase).toBe("idle");
    });

    it("旧shared runtime lease升级后release为no-op并保留失效信号", async () => {
        const root = testHostPath("tmp", `hmr-lease-${randomUUID()}`);
        const key = runtimeKey(root);
        const release = vi.fn(async () => undefined);
        const entry: SharedLeaseEntry = {
            refs: 1,
            physicalLease: Promise.resolve(release),
            phase: "open",
            releasePromise: null,
        };
        const previous = new Map([[key, entry]]);
        hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV1 = previous;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV2;

        await import("nbook/server/agent/session/agent-session-store");

        const upgradedLeases = hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV2 as unknown as Map<string, SharedLeaseEntry>;
        expect(upgradedLeases).toBe(previous);
        expect(upgradedLeases.get(key)).toBe(entry);
        const handle = await entry.physicalLease as unknown as {
            release(): Promise<void>;
            assertHealthy(): void;
            compromised: Promise<unknown>;
        };
        expect(handle.release).toBe(handle);
        expect(handle.assertHealthy).toBeTypeOf("function");
        expect(() => handle.assertHealthy()).toThrow("Agent Session Store runtime lease已失去所有权");
        await expect(handle.compromised).resolves.toMatchObject({
            code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
        });
        await handle.release();
        expect(release).not.toHaveBeenCalled();
    });

    it("旧shared runtime lease的rejected Promise迁移后不会产生未处理rejection", async () => {
        const root = testHostPath("tmp", `hmr-rejected-lease-${randomUUID()}`);
        const key = runtimeKey(root);
        const physicalFailure = new Error("old physical lease acquisition failed");
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);
        const entry: SharedLeaseEntry = {
            refs: 1,
            physicalLease: Promise.reject(physicalFailure),
            phase: "open",
            releasePromise: null,
        };
        const previous = new Map([[key, entry]]);
        hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV1 = previous;
        delete hmrGlobals.__nbookAgentSessionStoreRuntimeLeasesV2;

        try {
            await import("nbook/server/agent/session/agent-session-store");
            const handle = await entry.physicalLease as unknown as {
                release(): Promise<void>;
                assertHealthy(): void;
                compromised: Promise<unknown>;
            };

            expect(() => handle.assertHealthy()).toThrow("Agent Session Store runtime lease已失去所有权");
            await expect(handle.compromised).resolves.toMatchObject({
                code: "AGENT_SESSION_STORE_LEASE_COMPROMISED",
            });
            await handle.release();
            await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
            expect(unhandled).toEqual([]);
        } finally {
            process.removeListener("unhandledRejection", onUnhandled);
        }
    });
});

function runtimeKey(root: string): string {
    const resolved = resolve(root);
    return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}
