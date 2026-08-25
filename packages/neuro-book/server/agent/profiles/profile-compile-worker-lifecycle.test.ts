import {randomUUID} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {describe, expect, it} from "vitest";
import {ProfileCompileWorkerService} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile} from "nbook/server/agent/profiles/profile-compile-worker-runtime";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {ProjectNotOpenError} from "nbook/server/workspace-files/project-session-service";
import {withIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/test-workspace-fixture";

const PROFILE_FILE_NAME = "custom/lifecycle-home.profile.tsx";
const PROFILE_KEY = "test.lifecycle-home";
const PROFILE_SOURCE = `
    import {Type, defineAgentProfile, defineProfileHome, toolset} from "nbook/profile-sdk";

    export const profileManifest = {key: "${PROFILE_KEY}", name: "Lifecycle Home"} as const;
    export default defineAgentProfile({
        manifest: profileManifest,
        initialSchema: Type.Object({}),
        tools: toolset(),
        home: defineProfileHome({
            async init(ctx) {
                await ctx.home.writeText("initialized.txt", "initialized");
            },
        }),
        prepare() {
            return {systemPrompt: "lifecycle"};
        },
    });
`;

describe("profile compile worker Project lifecycle", () => {
    it("worker runtime 将 Session lifecycle error 返回为内部字段", async () => {
        await withLifecycleProfile(async (assets) => {
            const source = await readFile(profilePath(assets, PROFILE_FILE_NAME), "utf8");

            const result = await runProfileCompile({
                fileName: PROFILE_FILE_NAME,
                source,
                dryRun: true,
                preview: true,
                sessionId: "999999",
                userProfileRoot: assets.userProfileRoot,
            });

            expect(result.lifecycleError).toEqual({
                code: "SESSION_NOT_FOUND",
                sessionId: 999_999,
            });
            expect(result.issues).toEqual([]);
        });
    }, 120_000);

    it("worker service 将 Session lifecycle error 重新抛为领域错误", async () => {
        await withLifecycleProfile(async (assets) => {
            const source = await readFile(profilePath(assets, PROFILE_FILE_NAME), "utf8");
            const worker = new ProfileCompileWorkerService("test-session-lifecycle-error", 1, undefined, assets.userProfileRoot);
            try {
                await expect(worker.compile({
                    fileName: PROFILE_FILE_NAME,
                    source,
                    dryRun: true,
                    preview: true,
                    sessionId: "999999",
                })).rejects.toMatchObject({
                    name: "AgentSessionNotFoundError",
                    code: "SESSION_NOT_FOUND",
                    sessionId: 999_999,
                });
            } finally {
                worker.dispose();
            }
        });
    }, 120_000);

    it("worker runtime 将 Project lifecycle error 返回为内部字段", async () => {
        await withLifecycleProfile(async (assets) => {
            const {projectRoot, projectWorkspaceRoot, sessionId} = await createUnopenedProjectSession(assets);
            const fileName = PROFILE_FILE_NAME;
            const source = await readFile(profilePath(assets, fileName), "utf8");

            const result = await runProfileCompile({
                fileName,
                source,
                dryRun: true,
                preview: true,
                sessionId: String(sessionId),
                profileRoot: assets.userProfileRoot,
                runtimePaths: createRuntimePaths({
                    applicationRoot: absoluteFsPath(assets.applicationRoot),
                    stateRoot: absoluteFsPath(assets.root),
                }),
            });

            expect(result.lifecycleError).toEqual({
                code: "PROJECT_NOT_OPEN",
                projectRoot,
            });
            expect(result.issues).toEqual([]);
            await expect(readFile(join(
                projectWorkspaceRoot,
                "agents",
                PROFILE_KEY,
                "home.json",
            ), "utf8")).rejects.toMatchObject({code: "ENOENT"});
        });
    }, 120_000);
    it("worker service 将 Project lifecycle error 重新抛为 ProjectNotOpenError", async () => {
        await withLifecycleProfile(async (assets) => {
            const {projectRoot, sessionId} = await createUnopenedProjectSession(assets);
            const fileName = PROFILE_FILE_NAME;
            const source = await readFile(profilePath(assets, fileName), "utf8");
            const worker = new ProfileCompileWorkerService("test-project-lifecycle-error", 1, undefined, assets.userProfileRoot, "workspace/.nbook/agent/profiles", createRuntimePaths({
                applicationRoot: absoluteFsPath(assets.applicationRoot),
                stateRoot: absoluteFsPath(assets.root),
            }));
            try {
                await worker.compile({
                    fileName,
                    source,
                    dryRun: true,
                    preview: true,
                    sessionId: String(sessionId),
                });
                throw new Error("Expected ProjectNotOpenError");
            } catch (error) {
                expect(error).toBeInstanceOf(ProjectNotOpenError);
                expect(error).toMatchObject({projectRoot});
            } finally {
                worker.dispose();
            }
        });
    }, 120_000);
});

/** 使用隔离Workspace Root和最小Profile Home源码运行生命周期测试。 */
async function withLifecycleProfile(run: (assets: IsolatedWorkspaceAssets) => Promise<void>): Promise<void> {
    await withIsolatedWorkspaceAssets({useAsCwd: true}, async (assets) => {
        const previousApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
        const previousStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
        process.env.NEURO_BOOK_APPLICATION_ROOT = assets.applicationRoot;
        process.env.NEURO_BOOK_STATE_ROOT = assets.root;
        try {
            const target = resolve(assets.userProfileRoot, PROFILE_FILE_NAME);
            await mkdir(dirname(target), {recursive: true});
            await writeFile(target, PROFILE_SOURCE, "utf8");
            await run(assets);
        } finally {
            restoreEnv("NEURO_BOOK_APPLICATION_ROOT", previousApplicationRoot);
            restoreEnv("NEURO_BOOK_STATE_ROOT", previousStateRoot);
        }
    });
}

function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

/** 创建未打开的Project-bound session。 */
async function createUnopenedProjectSession(assets: IsolatedWorkspaceAssets): Promise<{
    projectRoot: string;
    projectWorkspaceRoot: string;
    sessionId: number;
}> {
    const projectRoot = `profile-lifecycle-${randomUUID()}`;
    const projectWorkspaceRoot = join(assets.workspaceContainerRoot, projectRoot);
    await mkdir(projectWorkspaceRoot, {recursive: true});
    await writeFile(join(projectWorkspaceRoot, "project.yaml"), "kind: novel\ntitle: Profile Lifecycle\nsummary: ''\n", "utf8");
    const snapshot = await new JsonlSessionRepository(assets.workspaceContainerRoot).createSession({
        profileKey: PROFILE_KEY,
        initial: {},
        currentProjectRoot: projectRoot,
    });
    return {projectRoot, projectWorkspaceRoot, sessionId: snapshot.metadata.sessionId};
}

/** 返回隔离用户Profile的物理路径。 */
function profilePath(assets: IsolatedWorkspaceAssets, fileName: string): string {
    return resolve(assets.userProfileRoot, ...fileName.split("/"));
}
