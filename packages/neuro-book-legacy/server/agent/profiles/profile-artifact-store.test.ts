import {mkdir, mkdtemp, readdir, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_DIR_NAME,
    type ProfileArtifactManifestItem,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {ProfileArtifactStore, ProfileArtifactStoreError} from "nbook/server/agent/profiles/profile-artifact-store";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 在临时 profile root 里写一个 `.compiled/artifacts/<sha>.mjs`，返回 root 与 manifest item。 */
async function seedArtifact(source: string): Promise<{profileRoot: string; item: ProfileArtifactManifestItem}> {
    const profileRoot = await mkdtemp(testHostPath("nbook-artifact-store-"));
    roots.push(profileRoot);
    const sha = `sha${roots.length}${Date.now()}`;
    const artifactFileName = `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${sha}.mjs`;
    const artifactPath = join(profileRoot, PROFILE_COMPILED_DIR_NAME, ...artifactFileName.split("/"));
    await mkdir(join(profileRoot, PROFILE_COMPILED_DIR_NAME, PROFILE_COMPILED_ARTIFACTS_DIR_NAME), {recursive: true});
    await writeFile(artifactPath, source, "utf8");
    return {
        profileRoot,
        item: {
            status: "loaded",
            fileName: "builtin/probe.profile.tsx",
            profileKey: "probe",
            sourceSha256: "source",
            sourceBytes: 1,
            dependencyHash: "dep",
            artifactFileName,
            artifactSha256: sha,
            artifactBytes: Buffer.byteLength(source, "utf-8"),
            dependencies: [],
        },
    };
}

const VALID_PROFILE_SOURCE = `export default {
    manifest: {key: "probe", name: "Probe"},
    initialSchema: {},
    tools: {},
    prepare: () => ({}),
};
`;

describe("ProfileArtifactStore", () => {
    it("直接从 published 路径加载 profile，不建立任何物理副本", async () => {
        const {profileRoot, item} = await seedArtifact(VALID_PROFILE_SOURCE);

        const profile = await new ProfileArtifactStore().importProfile(profileRoot, item);

        expect(profile.manifest.key).toBe("probe");
        expect(profile.rootToolKeys).toEqual([]);
        expect(profile.runtime?.hooks.map((hook) => hook.name)).toEqual([
            "builtin.profilePrompt",
            "builtin.sessionContext",
            "builtin.transcriptPersistence",
            "builtin.reportResult",
        ]);
        // published artifact 的落盘名已经是内容寻址 sha，路径随内容变化，
        // 再复制一份物理副本零信息量。这条断言守住「不要把 import cache 加回来」。
        expect((await readdir(join(profileRoot, PROFILE_COMPILED_DIR_NAME))).sort()).toEqual([PROFILE_COMPILED_ARTIFACTS_DIR_NAME]);
        expect(await readdir(profileRoot)).toEqual([PROFILE_COMPILED_DIR_NAME]);
    });

    it("默认导出不是有效 profile 时抛出可分类错误", async () => {
        const {profileRoot, item} = await seedArtifact("export default {nope: true};\n");

        await expect(new ProfileArtifactStore().importProfile(profileRoot, item))
            .rejects.toBeInstanceOf(ProfileArtifactStoreError);
    });
});
