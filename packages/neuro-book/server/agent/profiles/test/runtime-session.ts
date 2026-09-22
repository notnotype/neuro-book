import {resolve} from "node:path";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

type TestRuntimeSessionInput = Partial<NeuroSessionContext> & {
    workspaceRoot?: AbsoluteFsPath;
    currentProject?: ReadyProjectSessionRef | null;
};

/**
 * 创建遵守正式逻辑引用与物理root分离合同的Profile测试session。
 *
 * 测试默认managed Workspace Root是当前测试进程的`workspace/`；需要隔离State
 * Root的测试必须显式传入第二个参数，不能让fixture自行从session字符串猜cwd。
 */
export function createTestRuntimeSession(
    input: TestRuntimeSessionInput = {},
    managedWorkspaceRoot: AbsoluteFsPath = absoluteFsPath(resolve("workspace")),
): RuntimeSessionFacade {
    const workspaceRoot = input.workspaceRoot ?? managedWorkspaceRoot;
    const currentProjectRoot = input.currentProjectRoot ?? input.currentProject?.workspace.ref.projectRoot;
    const currentProject = input.currentProject ?? (currentProjectRoot
        ? createTestReadyProject(workspaceRoot, currentProjectRoot)
        : null);
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        customState: {},
        linkedAgents: [],
        archived: false,
        agentMode: "normal",
        ...input,
        workspaceRoot,
        currentProjectRoot,
        currentProject,
        async read() {
            return {
                snapshot: {
                    metadata: {
                        schemaVersion: 2,
                        sessionId: -1,
                        profileKey: session.profileKey,
                        initial: {},
                        currentProjectRoot: session.currentProjectRoot,
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return session;
}

/** 从单段Current Project root构造Profile测试使用的exact ready generation。 */
function createTestReadyProject(workspaceRoot: AbsoluteFsPath, projectRoot: string): ReadyProjectSessionRef {
    const ref = projectWorkspaceRef(projectRoot);
    return Object.freeze({
        workspace: resolvedProjectWorkspace(
            ref,
            absoluteFsPath(resolve(workspaceRoot, projectRoot)),
            createProjectWorkspaceKey(workspaceRoot, ref),
        ),
        publicId: `test-runtime:${projectRoot}`,
        generation: 1,
    });
}
