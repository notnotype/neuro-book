import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {access, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {Type} from "typebox";
import {afterEach, describe, expect, it} from "vitest";
import {fauxAssistantMessage, fauxText, fauxToolCall} from "@earendil-works/pi-ai";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {resolveProfileArtifactPathContext} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {createVariableDefinitionArtifactPathContextResolver} from "nbook/server/agent/variables/definition-artifact";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {createFauxModels, writeFauxProviderConfig} from "nbook/server/agent/test-utils/faux-models";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {openProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

describe("Agent State Root工具链", () => {
    const cleanupRoots: string[] = [];
    let harness: NeuroAgentHarness | undefined;

    afterEach(async () => {
        if (harness) {
            await harness.dispose();
            harness = undefined;
        }
        await closeProjectForTest("alpha").catch(() => undefined);
        setWorkspaceRuntimeRootContextForTest(null);
        await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("绕过类型系统时也拒绝隐式使用进程State Root", () => {
        expect(() => new NeuroAgentHarness({} as never)).toThrow(
            "Agent Harness必须显式提供隔离Repository或RuntimePaths",
        );
    });

    it("session保存workspace逻辑引用时，write/apply_patch/bash只写入Portable data/workspace", async () => {
        const installationRoot = testHostPath(`agent-state-root-${randomUUID()}`);
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(installationRoot),
            stateRoot: absoluteFsPath(join(installationRoot, "data")),
        });
        const workspaceFsRoot = runtimePaths.workspaceRoot;
        cleanupRoots.push(installationRoot);
        await mkdir(workspaceFsRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: workspaceFsRoot});

        const faux = createFauxModels({models: [{id: "state-root-faux", contextWindow: 32_000, maxTokens: 4_000}]});
        await writeFauxProviderConfig(workspaceFsRoot, faux);
        harness = new NeuroAgentHarness({
            runtimePaths,
            repo: new JsonlSessionRepository(workspaceFsRoot),
            profiles: new AgentProfileCatalog(
                join(installationRoot, "missing-system"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, installationRoot),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(installationRoot),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.state-root", name: "State Root"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys(["write", "apply_patch", "bash", "report_result"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("write", {path: ".nbook/write-marker.txt", content: "write-ok"}, {id: "write-1"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("apply_patch", {patch: [
                "*** Begin Patch",
                "*** Add File: patch-marker.txt",
                "+patch-ok",
                "*** End Patch",
            ].join("\n")}, {id: "patch-1"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("bash", {command: "printf 'bash-ok' > bash-marker.txt"}, {id: "bash-1"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxText("done"), fauxToolCall("report_result", {result: "ok"}, {id: "report-1"})], {stopReason: "toolUse"}),
        ]);

        const created = await harness.createAgent({profileKey: "test.state-root", initial: {}});
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "run"}});

        expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
        expect(harness.workspaceRoot).toBe(runtimePaths.workspaceRoot);
        expect((await harness.repo.readSession(created.sessionId)).metadata.currentProjectRoot).toBeUndefined();
        await expect(readFile(join(workspaceFsRoot, ".nbook", "write-marker.txt"), "utf8")).resolves.toBe("write-ok");
        await expect(readFile(join(workspaceFsRoot, "patch-marker.txt"), "utf8")).resolves.toBe("patch-ok\n");
        await expect(readFile(join(workspaceFsRoot, "bash-marker.txt"), "utf8")).resolves.toBe("bash-ok");

        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("write", {path: ".nbook/user-assets-marker.txt", content: "user-assets-ok"}, {id: "write-user-assets"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("report_result", {result: "ok"}, {id: "report-user-assets"})], {stopReason: "toolUse"}),
        ]);
        const userAssets = await harness.createAgent({profileKey: "test.state-root", initial: {}});
        await harness.invokeAgent({sessionId: userAssets.sessionId, mode: "prompt", message: {text: "run"}});
        await expect(readFile(join(workspaceFsRoot, ".nbook", "user-assets-marker.txt"), "utf8")).resolves.toBe("user-assets-ok");
        await expect(access(join(installationRoot, "workspace"))).rejects.toThrow();
    }, 30_000);

    it("生产RuntimePaths与显式Session Repository Root不一致时立即拒绝", () => {
        const installationRoot = testHostPath(`agent-runtime-root-mismatch-${randomUUID()}`);
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(installationRoot),
            stateRoot: absoluteFsPath(join(installationRoot, "data")),
        });
        const unrelatedWorkspaceRoot = join(installationRoot, "unrelated-workspace");
        cleanupRoots.push(installationRoot);

        expect(() => new NeuroAgentHarness({
            runtimePaths,
            repo: new JsonlSessionRepository(unrelatedWorkspaceRoot),
        })).toThrow("Agent Harness repo与RuntimePaths.workspaceRoot不一致");
    });

    it("Project-bound session的文件工具与bash共用Portable内Project Workspace File Scope", async () => {
        const installationRoot = testHostPath(`agent-project-scope-${randomUUID()}`);
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(installationRoot),
            stateRoot: absoluteFsPath(join(installationRoot, "data")),
        });
        const workspaceRoot = runtimePaths.workspaceRoot;
        const projectRoot = join(workspaceRoot, "alpha");
        cleanupRoots.push(installationRoot);
        await mkdir(join(projectRoot, ".nbook"), {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: ''\n", "utf8");
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});

        const faux = createFauxModels({models: [{id: "project-scope-faux", contextWindow: 32_000, maxTokens: 4_000}]});
        await writeFauxProviderConfig(runtimePaths.workspaceRoot, faux);
        harness = new NeuroAgentHarness({
            runtimePaths,
            repo: new JsonlSessionRepository(workspaceRoot),
            profiles: new AgentProfileCatalog(
                join(installationRoot, "missing-system"),
                undefined,
                undefined,
                undefined,
                (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, installationRoot),
                {install: "workspace/.nbook/agent/profiles"},
            ),
            definitionArtifactPathContextProvider: createVariableDefinitionArtifactPathContextResolver(installationRoot),
            modelResolver: () => faux.getModel(),
            runtimeResolver: () => faux.runtime,
            enableSessionSummarizer: false,
        });
        harness.profiles.register(defineAgentProfile({
            manifest: {key: "test.project-scope", name: "Project Scope"},
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys(["write", "apply_patch", "bash", "report_result"]),
            prepare() {
                return {};
            },
        }), false);
        faux.setResponses([
            fauxAssistantMessage([fauxToolCall("write", {path: "lorebook/write-marker.txt", content: "write-ok"}, {id: "project-write"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("apply_patch", {patch: [
                "*** Begin Patch",
                "*** Add File: manuscript/patch-marker.txt",
                "+patch-ok",
                "*** End Patch",
            ].join("\n")}, {id: "project-patch"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxToolCall("bash", {command: "mkdir -p .agent && printf 'bash-ok' > .agent/bash-marker.txt"}, {id: "project-bash"})], {stopReason: "toolUse"}),
            fauxAssistantMessage([fauxText("done"), fauxToolCall("report_result", {result: "ok"}, {id: "project-report"})], {stopReason: "toolUse"}),
        ]);

        await openProject(projectWorkspaceRef("alpha"), {kind: "job", source: "state-root-test"}, workspaceRoot);
        const created = await harness.createAgent({
            profileKey: "test.project-scope",
            initial: {},
            currentProjectRoot: "alpha",
        });
        const result = await harness.invokeAgent({sessionId: created.sessionId, mode: "prompt", message: {text: "run"}});

        expect(result.status, result.error ?? result.errorInfo?.message).toBe("completed");
        await expect(readFile(join(projectRoot, "lorebook", "write-marker.txt"), "utf8")).resolves.toBe("write-ok");
        await expect(readFile(join(projectRoot, "manuscript", "patch-marker.txt"), "utf8")).resolves.toBe("patch-ok\n");
        await expect(readFile(join(projectRoot, ".agent", "bash-marker.txt"), "utf8")).resolves.toBe("bash-ok");
        await expect(access(join(workspaceRoot, "lorebook"))).rejects.toThrow();
        await expect(access(join(installationRoot, "workspace"))).rejects.toThrow();
    }, 30_000);
});
