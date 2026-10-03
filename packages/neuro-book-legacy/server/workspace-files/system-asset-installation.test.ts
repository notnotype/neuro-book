import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, rename as fsRename, rm, rm as fsRm, symlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {
    applyLegacyAgentAssetMigration,
    getSystemAssetInstallPaths,
    planLegacyAgentAssetMigration,
    seedSystemAssets,
} from "nbook/server/workspace-files/system-asset-installation";

type LedgerFile = {assets: Array<{type: string; id: string; state: string; origin: {kind: string}; contentHash?: string; dirtyAt?: string}>};

async function writeLegacyFixture(root: string): Promise<{applicationRoot: string; stateRoot: string; installRoot: string; nbookRoot: string}> {
    const applicationRoot = path.join(root, "application");
    const stateRoot = path.join(root, "state");
    const installRoot = path.join(stateRoot, "workspace", ".nbook", "agent");
    const nbookRoot = path.join(stateRoot, "workspace", ".nbook");
    await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
    await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
    return {applicationRoot, stateRoot, installRoot, nbookRoot};
}

async function writeSeedSkill(applicationRoot: string, id: string, content: string): Promise<void> {
    const skillRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", id);
    await mkdir(skillRoot, {recursive: true});
    await writeFile(path.join(skillRoot, "SKILL.md"), content, "utf8");
}

function sha256(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

describe("缺失或损坏账本的启动重建", () => {
    const roots: string[] = [];

    afterEach(async () => {
        for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
    });

    it("旧投影 Install Root 无账本时按磁盘与 Seed 比对重建，bundled 与 local 各归其位且幂等", async () => {
        const root = testHostPath("tmp", "ledger-recovery-clean", crypto.randomUUID());
        roots.push(root);
        const {applicationRoot, stateRoot, installRoot} = await writeLegacyFixture(root);
        await writeSeedSkill(applicationRoot, "demo", "demo-v1");
        await mkdir(path.join(installRoot, "skills", "demo"), {recursive: true});
        await writeFile(path.join(installRoot, "skills", "demo", "SKILL.md"), "demo-v1", "utf8");
        await mkdir(path.join(installRoot, "skills", "mine"), {recursive: true});
        await writeFile(path.join(installRoot, "skills", "mine", "SKILL.md"), "mine", "utf8");

        const first = await seedSystemAssets({applicationRoot, stateRoot});
        expect(first.legacyAdoption).toMatchObject({reason: "账本文件缺失", bundled: 1, dirty: [], local: ["skill:mine"]});
        expect(first.seeded).toBe(true);
        const manifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        const demo = manifest.assets.find((entry) => entry.id === "demo");
        const mine = manifest.assets.find((entry) => entry.id === "mine");
        expect(demo).toMatchObject({origin: {kind: "bundled"}, state: "installed"});
        expect(demo?.dirtyAt).toBeUndefined();
        expect(mine).toMatchObject({origin: {kind: "local"}});

        const second = await seedSystemAssets({applicationRoot, stateRoot});
        expect(second.seeded).toBe(false);
        expect(second.legacyAdoption).toBeUndefined();
    });

    it("同 id 但内容不一致的包标 dirty，保留用户字节且不被后续 Seed 升级覆盖", async () => {
        const root = testHostPath("tmp", "ledger-recovery-dirty", crypto.randomUUID());
        roots.push(root);
        const {applicationRoot, stateRoot, installRoot} = await writeLegacyFixture(root);
        const skillPath = path.join(installRoot, "skills", "demo", "SKILL.md");
        await writeSeedSkill(applicationRoot, "demo", "seed-v1");
        await mkdir(path.join(installRoot, "skills", "demo"), {recursive: true});
        await writeFile(skillPath, "user-edit", "utf8");

        const first = await seedSystemAssets({applicationRoot, stateRoot});
        expect(first.legacyAdoption).toMatchObject({bundled: 0, dirty: ["skill:demo"], local: []});
        await expect(readFile(skillPath, "utf8")).resolves.toBe("user-edit");

        await writeSeedSkill(applicationRoot, "demo", "seed-v2");
        const second = await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(skillPath, "utf8")).resolves.toBe("user-edit");
        const manifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(manifest.assets.find((entry) => entry.id === "demo")?.dirtyAt).toEqual(expect.any(String));
        expect(second.seeded).toBe(false);
    });

    it("账本损坏为非法 JSON 时同样触发重建并在报告中给出读取失败诊断", async () => {
        const root = testHostPath("tmp", "ledger-recovery-corrupt", crypto.randomUUID());
        roots.push(root);
        const {applicationRoot, stateRoot, installRoot} = await writeLegacyFixture(root);
        await writeSeedSkill(applicationRoot, "demo", "demo-v1");
        await mkdir(path.join(installRoot, "skills", "demo"), {recursive: true});
        await writeFile(path.join(installRoot, "skills", "demo", "SKILL.md"), "demo-v1", "utf8");
        await mkdir(installRoot, {recursive: true});
        await writeFile(path.join(installRoot, "installed.json"), "{corrupted", "utf8");

        const result = await seedSystemAssets({applicationRoot, stateRoot});
        expect(result.legacyAdoption?.reason).toContain("账本读取失败");
        expect(result.legacyAdoption).toMatchObject({bundled: 1});
        await expect(readFile(path.join(installRoot, "installed.json"), "utf8")).resolves.toContain("system-asset-install/v2");
    });
});

describe("显式 legacy migration", () => {
    const roots: string[] = [];
    const ORPHAN_RELATIVE = "agent/skills/llmlint/src/legacy-import.ts";

    afterEach(async () => {
        for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
    });

    async function writeOrphanFixture(root: string): Promise<{applicationRoot: string; stateRoot: string; installRoot: string; nbookRoot: string; orphanPath: string}> {
        const fixture = await writeLegacyFixture(root);
        roots.push(root);
        await writeSeedSkill(fixture.applicationRoot, "llmlint", "lint-v1");
        const llmlintRoot = path.join(fixture.installRoot, "skills", "llmlint");
        await mkdir(llmlintRoot, {recursive: true});
        await writeFile(path.join(llmlintRoot, "SKILL.md"), "lint-v1", "utf8");
        const orphanPath = path.join(fixture.nbookRoot, ...ORPHAN_RELATIVE.split("/"));
        await mkdir(path.dirname(orphanPath), {recursive: true});
        const orphanContent = "old legacy import\n";
        await writeFile(orphanPath, orphanContent, "utf8");
        // 普通墓碑要求 sync-state 证明该文件自上次同步未被手改，迁移才会删除；
        // 同时模拟真实文件形状：profiles 数组 + 保留旧协议的 templates 条目。
        const syncState = JSON.stringify({
            profiles: [{fileName: "builtin/writer.profile.tsx", profileKey: "writer", upstreamHash: "upstream", lastSyncedUserHash: sha256("profile"), syncedAt: "2026-08-01"}],
            assets: [
                {assetPath: ORPHAN_RELATIVE, upstreamHash: "upstream", lastSyncedUserHash: sha256(orphanContent), syncedAt: "2026-08-01"},
                {assetPath: "templates/project-directory-templates/PROJECT-STATUS.md", upstreamHash: "tpl-upstream", lastSyncedUserHash: "tpl-user", syncedAt: "2026-08-01"},
            ],
        });
        await writeFile(path.join(fixture.nbookRoot, ".system-assets-sync-state.json"), syncState, "utf8");
        return {...fixture, orphanPath};
    }

    it("preflight 只报告不落盘，apply 清理墓碑孤儿并重建为 bundled，重复执行幂等", async () => {
        const root = testHostPath("tmp", "legacy-migration-apply", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot, orphanPath} = await writeOrphanFixture(root);

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan?.orphanRemovals).toEqual([ORPHAN_RELATIVE]);
        expect(plan?.dirty).toContain("skill:llmlint");
        await expect(async () => readFile(path.join(installRoot, "installed.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.removedOrphans).toEqual([ORPHAN_RELATIVE]);
        expect(result?.report.bundled).toBe(1);
        expect(result?.report.dirty).toEqual([]);
        expect(result?.syncStateCleaned).toBe(true);
        await expect(readFile(path.join(installRoot, "skills", "llmlint", "SKILL.md"), "utf8")).resolves.toBe("lint-v1");
        const manifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(manifest.assets.find((entry) => entry.id === "llmlint")).toMatchObject({origin: {kind: "bundled"}});

        const cleanedState = JSON.parse(await readFile(path.join(path.dirname(installRoot), ".system-assets-sync-state.json"), "utf8")) as {profiles: unknown[]; assets: Array<{assetPath: string}>};
        expect(cleanedState.profiles).toEqual([]);
        expect(cleanedState.assets.map((item) => item.assetPath)).toEqual(["templates/project-directory-templates/PROJECT-STATUS.md"]);

        await expect(applyLegacyAgentAssetMigration({applicationRoot, stateRoot})).resolves.toBeNull();
        await expect(planLegacyAgentAssetMigration({applicationRoot, stateRoot})).resolves.toBeNull();
    });

    it("账本有效而 sync-state 仍含三类条目时，迁移仅剥离 state 并保持幂等", async () => {
        const root = testHostPath("tmp", "legacy-migration-state-only", crypto.randomUUID());
        const {applicationRoot, stateRoot, nbookRoot} = await writeOrphanFixture(root);
        await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        await writeFile(path.join(nbookRoot, ".system-assets-sync-state.json"), `${JSON.stringify({
            profiles: [{fileName: "builtin/writer.profile.tsx", profileKey: "writer", upstreamHash: "u", lastSyncedUserHash: sha256("profile"), syncedAt: "2026-08-01"}],
            assets: [],
        })}\n`, "utf8");

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan?.syncStateCleanupPending).toBe(true);
        expect(plan?.orphanRemovals).toEqual([]);
        expect(plan?.dirty).toEqual([]);

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.syncStateCleaned).toBe(true);
        const cleaned = JSON.parse(await readFile(path.join(nbookRoot, ".system-assets-sync-state.json"), "utf8")) as {profiles: unknown[]; assets: unknown[]};
        expect(cleaned.profiles).toEqual([]);
        await expect(applyLegacyAgentAssetMigration({applicationRoot, stateRoot})).resolves.toBeNull();
    });

    it.each([
        ["assets 条目缺失 assetPath", `{"profiles": [], "assets": [{"lastSyncedUserHash": "x"}]}`],
        ["profiles 条目缺失 fileName", `{"profiles": [{}], "assets": []}`],
    ])("sync-state 条目畸形（%s）时 preflight 与 apply 均 fail closed 且不写账本", async (_label, brokenState) => {
        const root = testHostPath("tmp", "legacy-migration-item-shape", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot} = await writeOrphanFixture(root);
        await writeFile(path.join(path.dirname(installRoot), ".system-assets-sync-state.json"), `${brokenState}\n`, "utf8");

        await expect(planLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(applyLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(readFile(path.join(installRoot, "installed.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it.each([
        ["assets 键存在但非数组", `{"profiles": [], "assets": {}}`],
        ["profiles 键存在但非数组", `{"profiles": "x", "assets": []}`],
        ["两类键均缺失", `{}`],
    ])("sync-state 结构损坏（%s）时 preflight 与 apply 均 fail closed 且不写账本", async (_label, brokenState) => {
        const root = testHostPath("tmp", "legacy-migration-shape", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot} = await writeOrphanFixture(root);
        await writeFile(path.join(path.dirname(installRoot), ".system-assets-sync-state.json"), `${brokenState}\n`, "utf8");

        await expect(planLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(applyLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(readFile(path.join(installRoot, "installed.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("启动恢复已重建账本后，迁移仍能清理墓碑孤儿并解除 dirty 标记", async () => {
        const root = testHostPath("tmp", "legacy-migration-after-recovery", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot, orphanPath} = await writeOrphanFixture(root);

        const recovered = await seedSystemAssets({applicationRoot, stateRoot});
        expect(recovered.legacyAdoption?.dirty).toEqual(["skill:llmlint"]);
        const recoveredManifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(recoveredManifest.assets.find((entry) => entry.id === "llmlint")?.dirtyAt).toEqual(expect.any(String));

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan).not.toBeNull();
        expect(plan?.orphanRemovals).toEqual([ORPHAN_RELATIVE]);

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.removedOrphans).toEqual([ORPHAN_RELATIVE]);
        expect(result?.report.bundled).toBe(1);
        const migratedManifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(migratedManifest.assets.find((entry) => entry.id === "llmlint")?.dirtyAt).toBeUndefined();

        const after = await seedSystemAssets({applicationRoot, stateRoot});
        expect(after.seeded).toBe(false);
    });

    it("墓碑名单中当前 Seed 仍携带的路径不是孤儿，不删除也不影响 bundled 判定", async () => {
        const root = testHostPath("tmp", "legacy-migration-stale-list", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot} = await writeOrphanFixture(root);
        const staleRelative = "agent/skills/llmlint/rulesets/builtin/default/rules/cliche/baguwen.json";
        const seedRulePath = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", ...staleRelative.split("/"));
        const rootRulePath = path.join(installRoot, ...staleRelative.split("/"));
        await mkdir(path.dirname(seedRulePath), {recursive: true});
        await writeFile(seedRulePath, "{\"id\":\"baguwen\"}\n", "utf8");
        await mkdir(path.dirname(rootRulePath), {recursive: true});
        await writeFile(rootRulePath, "{\"id\":\"baguwen\"}\n", "utf8");

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan?.orphanRemovals).toEqual([ORPHAN_RELATIVE]);
        expect(plan?.orphanRemovals).not.toContain(staleRelative);

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.removedOrphans).toEqual([ORPHAN_RELATIVE]);
        await expect(readFile(rootRulePath, "utf8")).resolves.toBe("{\"id\":\"baguwen\"}\n");
    });

    it("hard-cut exact 名单中的受管包残留被删除，agent/scripts 等非受管路径不触碰", async () => {
        const root = testHostPath("tmp", "legacy-migration-hard-cut", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot, nbookRoot} = await writeOrphanFixture(root);
        const gitignorePath = path.join(nbookRoot, "agent", "skills", "llmlint", ".gitignore");
        const scriptPath = path.join(nbookRoot, "agent", "scripts", "profile.ts");
        await writeFile(gitignorePath, "node_modules\n", "utf8");
        await mkdir(path.dirname(scriptPath), {recursive: true});
        await writeFile(scriptPath, "// legacy cli script\n", "utf8");

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan?.orphanRemovals).toContain("agent/skills/llmlint/.gitignore");
        expect(plan?.orphanRemovals).not.toContain("agent/scripts/profile.ts");

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.removedOrphans).toContain("agent/skills/llmlint/.gitignore");
        await expect(readFile(gitignorePath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(scriptPath, "utf8")).resolves.toBe("// legacy cli script\n");
    });

    it("普通墓碑缺少 sync-state 证明时保留待人工处理，hard-cut 残留无需证明即可删除", async () => {
        const root = testHostPath("tmp", "legacy-migration-no-state", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot, nbookRoot, orphanPath} = await writeOrphanFixture(root);
        await rm(path.join(nbookRoot, ".system-assets-sync-state.json"));
        const gitignorePath = path.join(nbookRoot, "agent", "skills", "llmlint", ".gitignore");
        await writeFile(gitignorePath, "node_modules\n", "utf8");

        const plan = await planLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(plan?.preservedOrphans).toContain(ORPHAN_RELATIVE);
        expect(plan?.orphanRemovals).toContain("agent/skills/llmlint/.gitignore");
        expect(plan?.orphanRemovals).not.toContain(ORPHAN_RELATIVE);

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        await expect(readFile(orphanPath, "utf8")).resolves.toBe("old legacy import\n");
        await expect(readFile(gitignorePath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
        expect(result?.removedOrphans).toContain("agent/skills/llmlint/.gitignore");
        const manifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(manifest.assets.find((entry) => entry.id === "llmlint")?.dirtyAt).toEqual(expect.any(String));
    });

    it("sync-state 证明手改的墓碑孤儿保留并使对应包标 dirty", async () => {
        const root = testHostPath("tmp", "legacy-migration-preserve", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot, nbookRoot, orphanPath} = await writeOrphanFixture(root);
        await writeFile(orphanPath, "hand-edited import\n", "utf8");
        const syncState = JSON.stringify({assets: [{assetPath: ORPHAN_RELATIVE, upstreamHash: "upstream", lastSyncedUserHash: sha256("old legacy import\n")}]});
        await writeFile(path.join(nbookRoot, ".system-assets-sync-state.json"), syncState, "utf8");

        const result = await applyLegacyAgentAssetMigration({applicationRoot, stateRoot});
        expect(result?.preservedOrphans).toEqual([ORPHAN_RELATIVE]);
        expect(result?.removedOrphans).toEqual([]);
        await expect(readFile(orphanPath, "utf8")).resolves.toBe("hand-edited import\n");
        const manifest = JSON.parse(await readFile(path.join(installRoot, "installed.json"), "utf8")) as LedgerFile;
        expect(manifest.assets.find((entry) => entry.id === "llmlint")?.dirtyAt).toEqual(expect.any(String));
    });

    it("sync-state 损坏时 fail closed：preflight 与 apply 都拒绝执行且不写账本", async () => {
        const root = testHostPath("tmp", "legacy-migration-needs-review", crypto.randomUUID());
        const {applicationRoot, stateRoot, installRoot} = await writeOrphanFixture(root);
        await writeFile(path.join(path.dirname(installRoot), ".system-assets-sync-state.json"), "{broken json", "utf8");

        await expect(planLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(applyLegacyAgentAssetMigration({applicationRoot, stateRoot})).rejects.toThrow("需要人工核查（needs-review）");
        await expect(readFile(path.join(installRoot, "skills", "llmlint", "src", "legacy-import.ts"), "utf8")).resolves.toContain("old legacy import");
        await expect(readFile(path.join(installRoot, "installed.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });
});

describe("State Root system asset installation", () => {
    const roots: string[] = [];

    afterEach(async () => {
        for (const root of roots.splice(0)) {
            await import("node:fs/promises").then(({rm}) => rm(root, {recursive: true, force: true}));
        }
    });

    it("将 source seed 安装到隔离的 State Root install root，并重复执行幂等", async () => {
        const root = testHostPath("tmp", "system-asset-installation", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference", "agent"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles", "builtin.profile.tsx"), "profile", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "agent", "README.md"), "reference", "utf8");
        await mkdir(path.join(stateRoot, "workspace", ".nbook"), {recursive: true});
        await writeFile(path.join(stateRoot, "workspace", ".nbook", "user.txt"), "keep", "utf8");

        const first = await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        expect(first.seeded).toBe(true);
        expect(paths.installRoot).toBe(path.join(stateRoot, "workspace", ".nbook", "agent"));
        expect(paths.systemNbookRoot).toBe(path.join(stateRoot, "workspace", ".nbook"));
        expect(paths.systemReferenceRoot).toBe(path.join(stateRoot, "workspace", ".nbook", "reference"));
        expect(paths.manifestPath).toBe(path.join(paths.installRoot, "installed.json"));
        expect(paths.referenceManifestPath).toBe(path.join(paths.systemReferenceRoot, "reference-manifest.json"));
        await expect(readFile(path.join(paths.installRoot, "profiles", "builtin.profile.tsx"), "utf8")).resolves.toBe("profile");
        await expect(readFile(path.join(paths.systemReferenceRoot, "agent", "README.md"), "utf8")).resolves.toBe("reference");
        await expect(readFile(path.join(stateRoot, "workspace", ".nbook", "user.txt"), "utf8")).resolves.toBe("keep");

        const second = await seedSystemAssets({applicationRoot, stateRoot});
        expect(second.seeded).toBe(false);
        await expect(readFile(paths.manifestPath, "utf8")).resolves.toContain("system-asset-install/v2");
        await expect(readFile(paths.referenceManifestPath, "utf8")).resolves.toContain("system-reference-install/v1");
    });

    it("安装根被外部修改时拒绝覆盖并保持 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-conflict", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "conflict"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "conflict", "skill.md"), "seed", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");

        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        await writeFile(path.join(paths.installRoot, "skills", "conflict", "skill.md"), "edited", "utf8");
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system install package 内容已被修改");
        await expect(readFile(path.join(paths.installRoot, "skills", "conflict", "skill.md"), "utf8")).resolves.toBe("edited");
    });
    it("ledger 未记录的本地包不被同 id Seed 接管", async () => {
        const root = testHostPath("tmp", "system-asset-installation-local", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills");
        await mkdir(path.join(seedRoot, "bundled"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedRoot, "bundled", "skill.md"), "bundled", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        const paths = getSystemAssetInstallPaths(stateRoot);
        await mkdir(path.join(paths.installRoot, "skills", "local"), {recursive: true});
        await writeFile(path.join(paths.installRoot, "skills", "local", "skill.md"), "local", "utf8");
        const currentManifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<Record<string, unknown>>};
        currentManifest.assets = currentManifest.assets.filter((entry) => entry.id !== "local");
        await writeFile(paths.manifestPath, `${JSON.stringify(currentManifest)}\n`, "utf8");
        await mkdir(path.join(seedRoot, "local"), {recursive: true});
        await writeFile(path.join(seedRoot, "local", "skill.md"), "local", "utf8");

        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "local", "skill.md"), "utf8")).resolves.toBe("local");
        const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<{id: string; origin: {kind: string}}>};
        expect(manifest.assets.find((entry) => entry.id === "local")?.origin.kind).toBe("local");
    });

    it("Seed 删除 bundled 包时保留磁盘内容并写入 removed tombstone", async () => {
        const root = testHostPath("tmp", "system-asset-installation-tombstone", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedPackage = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "retired");
        await mkdir(seedPackage, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "retired", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);

        await fsRm(seedPackage, {recursive: true, force: true});
        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "retired", "skill.md"), "utf8")).resolves.toBe("retired");
        const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8")) as {assets: Array<{id: string; state: string}>};
        expect(manifest.assets.find((entry) => entry.id === "retired")?.state).toBe("removed");

        await mkdir(seedPackage, {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "new seed must not win", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        await expect(readFile(path.join(paths.installRoot, "skills", "retired", "skill.md"), "utf8")).resolves.toBe("retired");
    });
    it("State Install Root 删除 bundled package 时拒绝 Seed 静默复活", async () => {
        const root = testHostPath("tmp", "system-asset-installation-missing", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedPackage = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "deleted");
        await mkdir(seedPackage, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(seedPackage, "skill.md"), "seed", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        await rm(path.join(paths.installRoot, "skills", "deleted"), {recursive: true, force: true});
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system install bundled package 缺失或被删除");
    });
    it("提交前移动旧包失败时保留未触碰的 current 单元", async () => {
        const root = testHostPath("tmp", "system-asset-installation-preserve-current", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(seedRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        const seedProfile = path.join(seedRoot, "builtin.profile.tsx");
        await writeFile(seedProfile, "key: builtin\nv1", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        await writeFile(seedProfile, "key: builtin\nv2", "utf8");
        const paths = getSystemAssetInstallPaths(stateRoot);
        let blocked = false;
        await expect(seedSystemAssets({applicationRoot, stateRoot}, {
            rm: async (target, options) => {
                if (!blocked && path.resolve(target).startsWith(path.resolve(path.join(paths.installRoot, "profiles")))) {
                    blocked = true;
                    throw new Error("injected current removal failure");
                }
                await fsRm(target, options);
            },
        })).rejects.toThrow("system install root 安装失败");
        await expect(readFile(path.join(paths.installRoot, "profiles", "builtin.profile.tsx"), "utf8")).resolves.toContain("v1");
    });

    it("发布中途失败时恢复完整 previous 并保留事务残留诊断", async () => {
        const root = testHostPath("tmp", "system-asset-installation-recovery", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const seedRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(seedRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        const firstProfile = path.join(seedRoot, "first.profile.tsx");
        const secondProfile = path.join(seedRoot, "second.profile.tsx");
        await writeFile(firstProfile, "key: first\nv1", "utf8");
        await writeFile(secondProfile, "key: second\nv1", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await seedSystemAssets({applicationRoot, stateRoot});

        await writeFile(firstProfile, "key: first\nv2", "utf8");
        await writeFile(secondProfile, "key: second\nv2", "utf8");
        const paths = getSystemAssetInstallPaths(stateRoot);
        let moveCount = 0;
        await expect(seedSystemAssets({applicationRoot, stateRoot}, {
            rename: async (oldPath, newPath) => {
                if (oldPath.includes(".agent-assets.staging-") && path.resolve(newPath).startsWith(path.resolve(paths.installRoot))) {
                    moveCount += 1;
                    if (moveCount === 2) throw new Error("injected second package move failure");
                }
                await fsRename(oldPath, newPath);
            },
        })).rejects.toThrow("system install root 安装失败");

        await expect(readFile(path.join(paths.installRoot, "profiles", "first.profile.tsx"), "utf8")).resolves.toContain("v1");
        await expect(readFile(path.join(paths.installRoot, "profiles", "second.profile.tsx"), "utf8")).resolves.toContain("v1");
        const entriesAfterFailure = await readdir(paths.systemNbookRoot);
        expect(entriesAfterFailure.some((entry) => entry.startsWith(".agent-assets.previous-"))).toBe(true);

        const recovered = await seedSystemAssets({applicationRoot, stateRoot});
        expect(recovered.seeded).toBe(true);
        await expect(readFile(path.join(paths.installRoot, "profiles", "first.profile.tsx"), "utf8")).resolves.toContain("v2");
        await expect(readFile(path.join(paths.installRoot, "profiles", "second.profile.tsx"), "utf8")).resolves.toContain("v2");
    });

    it("Reference 事务与 Agent install root 使用兄弟路径和独立 manifest", async () => {
        const root = testHostPath("tmp", "system-asset-installation-reference", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "skill"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "skills", "skill", "skill.md"), "skill", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "book.md"), "book", "utf8");

        const result = await seedSystemAssets({applicationRoot, stateRoot});
        const paths = getSystemAssetInstallPaths(stateRoot);
        expect(result.referenceManifest.schema).toBe("system-reference-install/v1");
        expect(path.dirname(paths.systemReferenceRoot)).toBe(paths.systemNbookRoot);
        expect(path.dirname(paths.installRoot)).toBe(paths.systemNbookRoot);
        expect(paths.lockPath).toBe(path.join(paths.systemNbookRoot, ".agent-assets.install.lock"));
        await expect(readFile(path.join(paths.installRoot, "skills", "skill", "skill.md"), "utf8")).resolves.toBe("skill");
    });


    it.each([
        [null, "seed 必须是对象"],
        [[], "seed 必须是对象"],
        [{unknown: "x"}, "seed 包含未知字段：unknown"],
        [{seedNbookRoot: "  "}, "seed.seedNbookRoot 必须是非空字符串"],
        [{seedReferenceRoot: null}, "seed.seedReferenceRoot 必须是非空字符串"],
        [{kind: "bundled"}, "seed.kind 必须是 source 或 product"],
    ] as const)("拒绝非法 seed 输入 %#", async (seed, message) => {
        const root = testHostPath("tmp", "system-asset-installation-input", crypto.randomUUID());
        roots.push(root);
        await expect(seedSystemAssets({
            applicationRoot: path.join(root, "application"),
            stateRoot: path.join(root, "state"),
            seed: seed as never,
        })).rejects.toThrow(message);
    });
    it("缺少固定 workflow entry 的 Seed 立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-workflow-input", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        await mkdir(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "workflows", "broken"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(applicationRoot, "assets", "workspace", ".nbook", "agent", "workflows", "broken", "workflow.md"), "invalid", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets workflow package 缺少 workflow.ts");
    });
    it("Seed 中的 Agent package 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        await mkdir(path.join(agentRoot, "skills", "real"), {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(agentRoot, "skills", "real", "SKILL.md"), "real", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(path.join(agentRoot, "skills", "real"), path.join(agentRoot, "skills", "linked"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("不允许特殊文件或符号链接");
    });
    it("Seed 的 managed parent root 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-parent-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        const outsideRoot = path.join(root, "outside-skills");
        await mkdir(agentRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(outsideRoot, "SKILL.md"), "outside", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(outsideRoot, path.join(agentRoot, "skills"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets skills root 必须是真实目录");
    });
    it("Seed 的 profiles parent root 符号链接立即 fail-closed", async () => {
        const root = testHostPath("tmp", "system-asset-installation-profiles-symlink", crypto.randomUUID());
        roots.push(root);
        const applicationRoot = path.join(root, "application");
        const stateRoot = path.join(root, "state");
        const agentRoot = path.join(applicationRoot, "assets", "workspace", ".nbook", "agent");
        const outsideRoot = path.join(root, "outside-profiles");
        await mkdir(agentRoot, {recursive: true});
        await mkdir(outsideRoot, {recursive: true});
        await mkdir(path.join(applicationRoot, "assets", "reference"), {recursive: true});
        await writeFile(path.join(outsideRoot, "outside.profile.tsx"), "export default {};\n", "utf8");
        await writeFile(path.join(applicationRoot, "assets", "reference", "seed.md"), "reference", "utf8");
        try {
            await symlink(outsideRoot, path.join(agentRoot, "profiles"));
        } catch (error) {
            if (isSymlinkUnsupportedError(error)) return;
            throw error;
        }
        await expect(seedSystemAssets({applicationRoot, stateRoot})).rejects.toThrow("system assets profiles root 必须是真实目录");
    });

function isSymlinkUnsupportedError(error: unknown): boolean {
    return process.platform === "win32"
        && typeof error === "object"
        && error !== null
        && "code" in error
        && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code));
}
});
