import path from "node:path";
import {describe, expect, it} from "vitest";
import {SnapshotCache} from "@notnotype/file-snapshot-cache";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {
    plainFileIndexKey,
    projectFileIndexKey,
    workspaceFileIndexKeyId,
    type WorkspaceFileIndexKey,
} from "nbook/server/workspace-files/workspace-file-index-key";

describe("WorkspaceFileIndexKey", () => {
    it("相同物理 root 的 Project 与 plain Workspace 不共享 snapshot", async () => {
        const workspaceRoot = absoluteFsPath(path.resolve("workspace"));
        const projectRoot = absoluteFsPath(path.join(workspaceRoot, "novel-a"));
        const projectKey = projectFileIndexKey(createProjectWorkspaceKey(
            workspaceRoot,
            projectWorkspaceRef("novel-a"),
        ));
        const plainKey = plainFileIndexKey(projectRoot);
        let buildCount = 0;
        const cache = new SnapshotCache<WorkspaceFileIndexKey, string, never, never>({
            keyId: workspaceFileIndexKeyId,
            builder: {
                async build({key}) {
                    buildCount += 1;
                    return {
                        nodes: [key.kind],
                        issues: [],
                    };
                },
            },
        });

        try {
            const projectSnapshot = await cache.read(projectKey);
            const plainSnapshot = await cache.read(plainKey);

            expect(projectSnapshot.nodes).toEqual(["project"]);
            expect(plainSnapshot.nodes).toEqual(["plain-workspace"]);
            expect(buildCount).toBe(2);
            expect(cache.diagnostics().entryCount).toBe(2);
        } finally {
            await cache.closeAll();
        }
    });
});
