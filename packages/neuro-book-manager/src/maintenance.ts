import {randomUUID} from "node:crypto";
import {join} from "node:path";

export {doctor, installationStatus} from "#manager/installation-health";

import {mutateInstallation} from "#manager/installation-mutation";
import {writeInstallationManifest} from "#manager/manifest-store";
import {commitOperation, completeRuntimeWrapperSwitch, createOperation, pathCreateEffect, pathRetireEffect, prepareRuntimeWrapperSwitch, recoverFailedOperation, setOperationEffect, updateOperation} from "#manager/operation";
import {installationPaths} from "#manager/paths";
import {assertInstallationHostCompatible} from "#manager/platform";
import {parseInstallationManifest} from "#manager/schema";
import {assertManagerUpgrade, installManagerExecutable, installManagedBun, writeManagerWrapper, writeRuntimeWrapper} from "#manager/runtime";
import {installManagedTool, type ManagedToolName, writeManagedToolWrappers} from "#manager/tools";
import type {InstallationManifest, ManagedGitToolComponent, ManagedToolComponent} from "#manager/types";
import {MANAGER_VERSION} from "#manager/version-info";

/** 安装或更新托管 Bun，同时刷新 Manager/Application Runtime 与稳定 wrapper。 */
export async function maintainRuntime(root: string, managerExecutable: string, version?: string): Promise<InstallationManifest> {
    return mutateInstallation(root, async (mutation) => {
        root = mutation.root;
        const paths = installationPaths(root, mutation.manifest.roots);
        const current = mutation.manifest;
        assertInstallationHostCompatible(current);
        await assertManagerUpgrade(MANAGER_VERSION, current.managerVersion, current.components.manager.bundleSha256, managerExecutable);
        const createdPaths: string[] = [];
        const retiredPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, roots: current.roots, containerEngine: current.containerEngine, backupRoot: join(paths.backups, randomUUID()), previousManifest: current, nextManifest: null});
        try {
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "managed-assets"});
            const recordCreated = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path));
            };
            const recordCreatedApplied = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path, "applied"));
            };
            const recordRetired = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathRetireEffect(path));
            };
            const runtime = await installManagedBun(root, {
                requestedVersion: version,
                trustedIdentity: current.components.managerRuntime.provider === "managed" ? current.components.managerRuntime : undefined,
                createdPaths,
                recordCreated,
                recordCreatedApplied,
                retiredPaths,
                recordRetired,
            });
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths, recordCreated, recordCreatedApplied);
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "managed-assets"});
            const next: InstallationManifest = {...current, managerVersion: MANAGER_VERSION, components: {...current.components, manager, managerRuntime: runtime, applicationRuntime: current.components.applicationRuntime.provider === "container" ? current.components.applicationRuntime : runtime}, updatedAt: new Date().toISOString()};
            parseInstallationManifest(next);
            journal = await updateOperation(journal, "validated", {nextManifest: next});
            journal = await prepareRuntimeWrapperSwitch(journal);
            await writeRuntimeWrapper(root, runtime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, runtime);
            journal = await completeRuntimeWrapperSwitch(journal);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "planned", owner: "manifest"});
            await writeInstallationManifest(paths.manifest, next);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "applied", owner: "manifest"});
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverFailedOperation(root, error, current.roots);
            throw error;
        }
    });
}

/** 安装或更新托管工具，并更新固定 tools 组件。 */
export async function maintainTool(root: string, tool: ManagedToolName, managerExecutable: string): Promise<InstallationManifest> {
    return mutateInstallation(root, async (mutation) => {
        root = mutation.root;
        const paths = installationPaths(root, mutation.manifest.roots);
        const current = mutation.manifest;
        assertInstallationHostCompatible(current);
        if (current.profile === "ghcr" || current.profile === "source-docker") {
            throw new Error("GHCR/Source Docker 的应用工具由容器提供，不在宿主管理。");
        }
        await assertManagerUpgrade(MANAGER_VERSION, current.managerVersion, current.components.manager.bundleSha256, managerExecutable);
        const createdPaths: string[] = [];
        const retiredPaths: string[] = [];
        let journal = await createOperation({id: randomUUID(), action: "update", root, roots: current.roots, containerEngine: current.containerEngine, backupRoot: join(paths.backups, randomUUID()), previousManifest: current, nextManifest: null});
        try {
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "planned", owner: "managed-assets"});
            const recordCreated = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path));
            };
            const recordCreatedApplied = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathCreateEffect(path, "applied"));
            };
            const recordRetired = async (path: string): Promise<void> => {
                journal = await setOperationEffect(journal, pathRetireEffect(path));
            };
            let installed: ManagedToolComponent | ManagedGitToolComponent;
            const currentTool = current.components.tools[tool];
            const trustedIdentity = currentTool?.provider === "managed" ? currentTool : undefined;
            if (tool === "git") installed = await installManagedTool(root, "git", {trustedIdentity, createdPaths, recordCreated, recordCreatedApplied, retiredPaths, recordRetired});
            else installed = await installManagedTool(root, "rg", {trustedIdentity, createdPaths, recordCreated, recordCreatedApplied, retiredPaths, recordRetired});
            const manager = await installManagerExecutable(root, MANAGER_VERSION, managerExecutable, createdPaths, recordCreated, recordCreatedApplied);
            journal = await setOperationEffect(journal, {kind: "component-switch", state: "applied", owner: "managed-assets"});
            const next: InstallationManifest = {...current, managerVersion: MANAGER_VERSION, components: {...current.components, manager, tools: {...current.components.tools, [tool]: installed}}, updatedAt: new Date().toISOString()};
            parseInstallationManifest(next);
            journal = await updateOperation(journal, "validated", {nextManifest: next});
            journal = await prepareRuntimeWrapperSwitch(journal);
            if (next.components.managerRuntime.provider === "managed") await writeRuntimeWrapper(root, next.components.managerRuntime);
            await writeManagedToolWrappers(root, next.components.tools);
            await writeManagerWrapper(root, manager, next.components.managerRuntime);
            journal = await completeRuntimeWrapperSwitch(journal);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "planned", owner: "manifest"});
            await writeInstallationManifest(paths.manifest, next);
            journal = await setOperationEffect(journal, {kind: "manifest-switch", state: "applied", owner: "manifest"});
            await commitOperation(journal);
            return next;
        } catch (error) {
            await recoverFailedOperation(root, error, current.roots);
            throw error;
        }
    });
}
