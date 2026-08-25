import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, effectScope, nextTick, ref, watch} from "vue";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import type {InlineEditorAgentControllerServices} from "nbook/app/composables/useInlineEditorAgentController";
import type {AgentSessionRecoveryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

describe("useInlineEditorAgentController", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.watch = watch;
        globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
    });

    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("IDE 模式不挂载 Agent Chat Surface 也能创建并调用 Inline Session", async () => {
        const {useInlineEditorAgentController} = await import("nbook/app/composables/useInlineEditorAgentController");
        const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
        const active = ref(false);
        const projectReadyRevision = ref<number | null>(7);
        const selectedFilePath = ref("manuscript/chapter-01.md");
        const store = useNovelIdeStore();
        store.workspaceKind = "novel";
        store.currentProjectRoot = "book-a";

        let summaries: AgentSessionSummaryDto[] = [];
        const listSessions = vi.fn(async () => ({
            items: summaries,
            total: summaries.length,
            offset: 0,
            limit: 50,
            hasMore: false,
        }));
        const createSession = vi.fn(async () => {
            summaries = [summary(41)];
            return {sessionId: 41, profileKey: "inline.editor"};
        });
        const getSessionRecovery = vi.fn(async (sessionId: number) => recovery(sessionId));
        const invokeSession = vi.fn(async () => ({
            sessionId: 41,
            invocationId: "invocation-1",
            status: "completed" as const,
            finalMessage: "完成",
            acceptance: {
                state: "persisted" as const,
                clientMessageId: "client-message-1",
                entryId: "entry-1",
            },
        }));
        const stream = {
            ensure: vi.fn(async () => {}),
            start: vi.fn(async () => {}),
            stop: vi.fn(),
            syncRecovery: vi.fn(async () => true),
        };
        const services: InlineEditorAgentControllerServices = {
            api: {
                abortSession: vi.fn(async () => ({sessionId: 41, status: "aborted" as const})),
                createSession,
                getSessionRecovery,
                invokeSession,
                listSessions,
                runCommand: vi.fn(),
                subscribeSessionEvents: vi.fn(async () => {}),
            },
            createStream: vi.fn(() => stream),
            loadSelectableModels: vi.fn(async () => []),
            acknowledgeClientPatch: vi.fn(async () => {}),
            buildClientState: vi.fn(() => ({})),
            notifyError: vi.fn(),
            storage: memoryStorage(),
            translate: (key) => key,
            createClientMessageId: () => "client-message-1",
        };

        const scope = effectScope();
        const controller = scope.run(() => useInlineEditorAgentController({
            active,
            projectReadyRevision,
            selectedFilePath,
        }, services))!;

        active.value = true;
        await nextTick();
        await controller.whenReady();

        const result = await controller.sendPrompt({
            version: 1,
            task: "rewrite",
            targetPath: "manuscript/chapter-01.md",
            instruction: "收紧这段文字",
            references: [],
        }, "收紧这段文字");

        expect(result).toEqual({status: "current", value: undefined});
        expect(createSession).toHaveBeenCalledWith({
            profileKey: "inline.editor",
            initial: {},
            currentProjectRoot: "book-a",
        });
        expect(getSessionRecovery).toHaveBeenCalledWith(41);
        expect(stream.ensure).toHaveBeenCalledOnce();
        expect(invokeSession).toHaveBeenCalledWith(41, expect.objectContaining({
            mode: "prompt",
            clientMessageId: "client-message-1",
            message: {text: "收紧这段文字"},
            input: expect.objectContaining({
                targetPath: "manuscript/chapter-01.md",
            }),
        }));
        expect(controller.sessionId.value).toBe(41);
        expect(controller.resultText.value).toBe("完成");
        scope.stop();
    });
});

function summary(sessionId: number): AgentSessionSummaryDto {
    return {
        sessionId,
        profileKey: "inline.editor",
        sessionIdentity: "sha256:" + "0".repeat(64),
        status: "idle",
        updatedAt: 1,
        archived: false,    };
}

function recovery(sessionId: number): AgentSessionRecoveryDto {
    return {
        kind: "recovery",
        eventCursor: {eventEpoch: "epoch-1", after: 0},
        summary: summary(sessionId),
        activeLeafId: null,
        activePathRevision: "revision-1",
        history: {entries: [], previousCursor: null},
        tree: [],
        linkedAgents: [],
        linkedByAgents: [],
        pendingUserInputs: [],
        steerQueue: {items: [], omittedItems: 0},
        followUpQueue: {status: "ready", items: [], omittedItems: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode: "normal",
    };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
    const values = new Map<string, string>();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}
