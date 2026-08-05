import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";
import {valid} from "semver";
import {isAbsolute, join, resolve} from "node:path";

import {PRODUCT_ASSET_NAMES} from "#manager/platform";
import {
    PRODUCT_PLATFORMS,
    type InstallationManifest,
    type InstallationRootLocators,
    type OperationJournal,
    type ReleaseManifest,
} from "#manager/types";
import {assertAbsolutePathWithin, installationRelativePath} from "#manager/installation-path";
import {
    INSTALLED_WINDOWS_ROOT_LOCATORS,
    INSTALLED_MACOS_ROOT_LOCATORS,
    INSTALLATION_SCOPED_ROOT_LOCATORS,
    PORTABLE_ROOT_LOCATORS,
    resolveInstallationRoots,
    rootLocatorsEqual,
} from "#manager/root-locators";
import {sourceDockerImageName, sourceDockerImageSuffix} from "#manager/source-docker-image";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

const SHA256_PATTERN = "^[a-fA-F0-9]{64}$";
const REVISION_PATTERN = "^[a-f0-9]{40}$";
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$";

const InstallProfileSchema = Type.Union([
    Type.Literal("source-dev"),
    Type.Literal("source-product"),
    Type.Literal("product-bun"),
    Type.Literal("windows-portable"),
    Type.Literal("source-docker"),
    Type.Literal("ghcr"),
]);
const ReleaseChannelSchema = Type.Union([Type.Literal("stable"), Type.Literal("canary")]);
const ContainerEngineSchema = Type.Union([Type.Literal("docker"), Type.Literal("podman")]);
const ProductPlatformSchema = Type.Union(PRODUCT_PLATFORMS.map((platform) => Type.Literal(platform)));
const RootLocatorSchema = Type.Object({
    base: Type.Union([
        Type.Literal("installation-root"),
        Type.Literal("local-app-data"),
        Type.Literal("user-app-data"),
        Type.Literal("user-cache"),
    ]),
    path: Type.String({minLength: 1}),
}, {additionalProperties: false});
const InstallationRootLocatorsSchema = Type.Object({
    state: RootLocatorSchema,
    cache: RootLocatorSchema,
    desktop: RootLocatorSchema,
    webview: RootLocatorSchema,
}, {additionalProperties: false});
const RevisionSchema = Type.String({pattern: REVISION_PATTERN});
const ChecksumSchema = Type.String({pattern: SHA256_PATTERN});
const RuntimeImageDigestSchema = Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"});
const RelativePathSchema = Type.String({minLength: 1});

/** Runtime Image 身份必须按 Builder manifest 原样随组件流转。 */
const ProductRuntimeImageIdentitySchema = {
    imageId: RuntimeImageDigestSchema,
    sourceDigest: RuntimeImageDigestSchema,
    lockfileSha256: RuntimeImageDigestSchema,
    builderContractVersion: Type.String({minLength: 1}),
};

const GitSourceSchema = Type.Object({
    provider: Type.Literal("git"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("."),
    repository: Type.String({minLength: 1}),
    branch: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ReleaseSourceSchema = Type.Object({
    provider: Type.Literal("release"),
    buildId: RuntimeImageDigestSchema,
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("."),
    files: Type.Array(RelativePathSchema),
    archiveSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ContainerSourceSchema = Type.Object({
    provider: Type.Literal("container"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal("/app"),
}, {additionalProperties: false});
const SourceSchema = Type.Union([GitSourceSchema, ReleaseSourceSchema, ContainerSourceSchema]);

const GitProductSchema = Type.Object({
    provider: Type.Literal("git"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal(".output"),
    platform: ProductPlatformSchema,
    ...ProductRuntimeImageIdentitySchema,
}, {additionalProperties: false});
const ReleaseProductSchema = Type.Object({
    provider: Type.Literal("release"),
    buildId: RuntimeImageDigestSchema,
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    path: Type.Literal(".output"),
    platform: ProductPlatformSchema,
    archiveSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
    ...ProductRuntimeImageIdentitySchema,
}, {additionalProperties: false});
const ContainerProductSchema = Type.Object({
    provider: Type.Literal("container"),
    version: Type.String({minLength: 1}),
    revision: RevisionSchema,
    image: Type.String({minLength: 1}),
    digest: Type.Optional(Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"})),
    containerImageId: Type.Optional(Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"})),
    imageId: Type.Optional(RuntimeImageDigestSchema),
    sourceDigest: Type.Optional(RuntimeImageDigestSchema),
    lockfileSha256: Type.Optional(RuntimeImageDigestSchema),
    builderContractVersion: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});
const ProductSchema = Type.Union([GitProductSchema, ReleaseProductSchema, ContainerProductSchema]);

const ManagerSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    bundleSha256: ChecksumSchema,
}, {additionalProperties: false});
const SystemRuntimeSchema = Type.Object({
    provider: Type.Literal("system"),
    version: Type.String({minLength: 1}),
    executable: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ManagedRuntimeSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    archiveSha256: ChecksumSchema,
    executableSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ManagerRuntimeSchema = Type.Union([SystemRuntimeSchema, ManagedRuntimeSchema]);
const ApplicationRuntimeSchema = Type.Union([
    SystemRuntimeSchema,
    ManagedRuntimeSchema,
    Type.Object({provider: Type.Literal("container"), version: Type.String({minLength: 1})}, {additionalProperties: false}),
]);

const SystemToolSchema = SystemRuntimeSchema;
const ManagedToolSchema = ManagedRuntimeSchema;
const ManagedGitToolSchema = Type.Object({
    provider: Type.Literal("managed"),
    version: Type.String({minLength: 1}),
    path: RelativePathSchema,
    bashPath: RelativePathSchema,
    distribution: Type.Literal("PortableGit"),
    archiveSha256: ChecksumSchema,
    gitSha256: ChecksumSchema,
    bashSha256: ChecksumSchema,
    sourceUrl: Type.String({minLength: 1}),
    license: Type.String({minLength: 1}),
    redistribution: Type.String({minLength: 1}),
}, {additionalProperties: false});
const ContainerToolSchema = Type.Object({provider: Type.Literal("container"), version: Type.String({minLength: 1})}, {additionalProperties: false});
const ToolComponentsSchema = Type.Object({
    rg: Type.Optional(Type.Union([SystemToolSchema, ManagedToolSchema, ContainerToolSchema])),
    git: Type.Optional(Type.Union([SystemToolSchema, ManagedGitToolSchema, ContainerToolSchema])),
    python: Type.Optional(Type.Union([SystemToolSchema, ContainerToolSchema])),
}, {additionalProperties: false});

export const InstallationManifestSchema = Type.Object({
    schemaVersion: Type.Literal(5),
    profile: InstallProfileSchema,
    containerEngine: Type.Union([ContainerEngineSchema, Type.Null()]),
    managerVersion: Type.String({minLength: 1}),
    appVersion: Type.String({minLength: 1}),
    channel: ReleaseChannelSchema,
    sourceRevision: RevisionSchema,
    roots: InstallationRootLocatorsSchema,
    components: Type.Object({
        source: SourceSchema,
        product: Type.Optional(ProductSchema),
        manager: ManagerSchema,
        managerRuntime: ManagerRuntimeSchema,
        applicationRuntime: ApplicationRuntimeSchema,
        tools: ToolComponentsSchema,
    }, {additionalProperties: false}),
    installedAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

const OperationPhaseSchema = Type.Union([
    Type.Literal("planned"),
    Type.Literal("staged"),
    Type.Literal("validated"),
    Type.Literal("switched"),
    Type.Literal("migrated"),
    Type.Literal("healthy"),
    Type.Literal("committed"),
]);

const OperationEffectStateSchema = Type.Union([Type.Literal("planned"), Type.Literal("applied")]);
const OperationEffectSchema = Type.Union([
    Type.Object({
        kind: Type.Literal("path-create"),
        state: OperationEffectStateSchema,
        owner: Type.Union([
            Type.Literal("staging"), Type.Literal("backup"), Type.Literal("source"), Type.Literal("runtime"), Type.Literal("tool"),
            Type.Literal("manager"), Type.Literal("wrapper"), Type.Literal("state"), Type.Literal("portable-launcher"),
        ]),
        path: RelativePathSchema,
        cleanupError: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("path-retire"),
        state: OperationEffectStateSchema,
        owner: Type.Union([Type.Literal("runtime"), Type.Literal("tool")]),
        path: RelativePathSchema,
        cleanupError: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("component-switch"),
        state: OperationEffectStateSchema,
        owner: Type.Union([Type.Literal("source"), Type.Literal("product"), Type.Literal("managed-assets")]),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("wrapper-switch"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("wrapper"),
        previousState: Type.Union([Type.Literal("present"), Type.Literal("missing")]),
        backupPath: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("manifest-switch"), state: OperationEffectStateSchema, owner: Type.Literal("manifest")}, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("receipt-switch"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("receipt"),
        path: Type.Literal(".deploy/product-runtime-receipt.json"),
        previousState: Type.Union([Type.Literal("present"), Type.Literal("missing")]),
        backupPath: Type.Optional(Type.String({minLength: 1})),
        cleanupError: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("git-checkout"), state: OperationEffectStateSchema, owner: Type.Literal("source")}, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("git-fast-forward"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("source"),
        previousRevision: RevisionSchema,
        targetRevision: RevisionSchema,
        dependenciesInstalled: Type.Optional(Type.Boolean()),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("docker-image"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("product"),
        image: Type.String({minLength: 1}),
        previousImage: Type.Optional(Type.String({minLength: 1})),
        previousImageRetired: Type.Optional(Type.Boolean()),
        cleanupError: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("compose"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("compose"),
        previousState: Type.Union([Type.Literal("running"), Type.Literal("stopped"), Type.Literal("missing")]),
        stopped: Type.Boolean(),
        previousCompose: Type.Optional(Type.String({minLength: 1})),
        created: Type.Boolean(),
        previousImage: Type.Optional(Type.String({minLength: 1})),
        targetImage: Type.Optional(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("candidate-container"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("application"),
        containerId: Type.Optional(Type.String({pattern: "^[a-f0-9]{12,64}$"})),
        stopped: Type.Boolean(),
    }, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("sqlite-backup"),
        state: OperationEffectStateSchema,
        owner: Type.Literal("app-sqlite"),
        configuredUrl: Type.String({minLength: 1}),
        stateRoot: Type.String({minLength: 1}),
        hostPath: Type.String({minLength: 1}),
        backupPath: Type.String({minLength: 1}),
        checkpoint: Type.Object({
            busy: Type.Integer({minimum: 0}),
            log: Type.Integer({minimum: -1}),
            checkpointed: Type.Integer({minimum: -1}),
        }, {additionalProperties: false}),
    }, {additionalProperties: false}),
]);

export const OperationJournalSchema = Type.Object({
    schemaVersion: Type.Literal(5),
    id: Type.String({minLength: 1}),
    action: Type.Union([Type.Literal("install"), Type.Literal("update"), Type.Literal("start")]),
    phase: OperationPhaseSchema,
    root: Type.String({minLength: 1}),
    containerEngine: Type.Union([ContainerEngineSchema, Type.Null()]),
    effects: Type.Array(OperationEffectSchema),
    backupRoot: Type.String({minLength: 1}),
    previousManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    nextManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    migrationRoot: Type.Optional(Type.String({minLength: 1})),
    applicationStateMigration: Type.Optional(Type.Object({
        runId: Type.String({pattern: "^[A-Za-z0-9_-]+$"}),
        state: Type.Union([
            Type.Literal("planned"),
            Type.Literal("applying"),
            Type.Literal("applied"),
            Type.Literal("rolled_back"),
        ]),
    }, {additionalProperties: false})),
    outcome: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("rolled-back")])),
    createdAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

/** v4 已使用统一 Application State operation，但尚未表达 start action。 */
const OperationJournalV4Schema = Type.Object({
    schemaVersion: Type.Literal(4),
    id: Type.String({minLength: 1}),
    action: Type.Union([Type.Literal("install"), Type.Literal("update")]),
    phase: OperationPhaseSchema,
    root: Type.String({minLength: 1}),
    containerEngine: Type.Union([ContainerEngineSchema, Type.Null()]),
    effects: Type.Array(OperationEffectSchema),
    backupRoot: Type.String({minLength: 1}),
    previousManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    nextManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    migrationRoot: Type.Optional(Type.String({minLength: 1})),
    applicationStateMigration: Type.Optional(Type.Object({
        runId: Type.String({pattern: "^[A-Za-z0-9_-]+$"}),
        state: Type.Union([Type.Literal("planned"), Type.Literal("applying"), Type.Literal("applied"), Type.Literal("rolled_back")]),
    }, {additionalProperties: false})),
    outcome: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("rolled-back")])),
    createdAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

/** v3 只用于 Manager 首次读取时转换旧 Attachment 专用 operation。 */
const OperationJournalV3Schema = Type.Object({
    schemaVersion: Type.Literal(3),
    id: Type.String({minLength: 1}),
    action: Type.Union([Type.Literal("install"), Type.Literal("update")]),
    phase: OperationPhaseSchema,
    root: Type.String({minLength: 1}),
    containerEngine: Type.Union([ContainerEngineSchema, Type.Null()]),
    effects: Type.Array(OperationEffectSchema),
    backupRoot: Type.String({minLength: 1}),
    previousManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    nextManifest: Type.Union([InstallationManifestSchema, Type.Null()]),
    migrationRoot: Type.Optional(Type.String({minLength: 1})),
    attachmentMigration: Type.Optional(Type.Object({
        runId: Type.String({pattern: "^[A-Za-z0-9_-]+-attachment$"}),
        state: Type.Union([Type.Literal("planned"), Type.Literal("applied"), Type.Literal("rolled_back")]),
        migratedSessions: Type.Integer({minimum: 1}),
        sessions: Type.Array(Type.Object({
            sessionId: Type.Union([Type.Integer(), Type.Null()]),
            sourcePath: Type.String({minLength: 1}),
            sourceHash: Type.String({pattern: "^[a-f0-9]{64}$"}),
            targetHash: Type.String({pattern: "^[a-f0-9]{64}$"}),
            backupPath: Type.Optional(Type.String({minLength: 1})),
        }, {additionalProperties: false}), {minItems: 1}),
    }, {additionalProperties: false})),
    outcome: Type.Optional(Type.Union([Type.Literal("success"), Type.Literal("rolled-back")])),
    createdAt: Type.String({pattern: ISO_DATE_PATTERN}),
    updatedAt: Type.String({pattern: ISO_DATE_PATTERN}),
}, {additionalProperties: false});

const ReleaseAssetSchema = Type.Object({
    url: Type.String({minLength: 1}),
    sha256: ChecksumSchema,
    bytes: Type.Integer({minimum: 0}),
}, {additionalProperties: false});
const ProductReleaseAssetSchema = Type.Object({
    url: Type.String({minLength: 1}),
    sha256: ChecksumSchema,
    bytes: Type.Integer({minimum: 0}),
    platform: ProductPlatformSchema,
    sourceRevision: RevisionSchema,
    ...ProductRuntimeImageIdentitySchema,
}, {additionalProperties: false});
const ReleaseImageSchema = Type.Object({
    ref: Type.String({minLength: 1}),
    digest: Type.String({pattern: "^sha256:[a-fA-F0-9]{64}$"}),
    sourceRevision: RevisionSchema,
}, {additionalProperties: false});

export const ReleaseStateMigrationSchema = Type.Object({
    policy: Type.Union([Type.Literal("none"), Type.Literal("automatic"), Type.Literal("manual")]),
    steps: Type.Array(Type.String({pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"})),
    guide: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

export const ReleaseManifestSchema = Type.Object({
    schemaVersion: Type.Literal(5),
    buildId: RuntimeImageDigestSchema,
    version: Type.String({minLength: 1}),
    channel: ReleaseChannelSchema,
    sourceRevision: RevisionSchema,
    minManagerVersion: Type.String({minLength: 1}),
    source: ReleaseAssetSchema,
    products: Type.Array(ProductReleaseAssetSchema, {minItems: 1}),
    windowsPortable: ReleaseAssetSchema,
    ghcr: ReleaseImageSchema,
    stateMigration: ReleaseStateMigrationSchema,
}, {additionalProperties: false});

const ReleaseManifestEnvelopeSchema = Type.Object({
    schemaVersion: Type.Integer({minimum: 1}),
    minManagerVersion: Type.String({minLength: 1}),
}, {additionalProperties: true});

export type InstallationManifestValue = Static<typeof InstallationManifestSchema>;
export type OperationJournalValue = Static<typeof OperationJournalSchema>;
export type ReleaseManifestValue = Static<typeof ReleaseManifestSchema>;

/** 严格解析并执行 Profile/组件语义校验。 */
export function parseInstallationManifest(value: unknown): InstallationManifest {
    assertSchema(
        InstallationManifestSchema,
        value,
        "installation.json 不符合 NeuroBook Manager schema v5；旧版安装必须重新安装，Windows Portable 只复用完整 data/。",
    );
    const manifest = value as InstallationManifest;
    assertSemVer(manifest.managerVersion, "managerVersion");
    assertSemVer(manifest.appVersion, "appVersion");
    assertInstallationSemantics(manifest);
    assertComponentPaths(manifest);
    return manifest;
}

/** 严格解析崩溃恢复账本，禁止未经校验的路径和 Manifest 进入回滚流程。 */
export function parseOperationJournal(value: unknown, path: string): OperationJournal {
    assertSchema(OperationJournalSchema, value, `Operation journal 不符合 schema：${path}`);
    const journal = value as OperationJournal;
    if (!isAbsolute(journal.root)) {
        throw new Error(`Operation root必须是绝对路径：${journal.root}`);
    }
    const journalRoot = resolve(journal.root);
    assertAbsolutePathWithin(join(journalRoot, ".deploy", "backups"), journal.backupRoot, "Operation backupRoot");
    if (journal.previousManifest) parseInstallationManifest(journal.previousManifest);
    if (journal.nextManifest) parseInstallationManifest(journal.nextManifest);
    const effectIdentities = new Set<string>();
    for (const effect of journal.effects) {
        assertOperationEffect(journal, effect, path);
        const identity = operationEffectIdentity(effect);
        if (effectIdentities.has(identity)) throw new Error(`Operation effect重复：${identity}`);
        effectIdentities.add(identity);
    }
    if (journal.nextManifest) {
        const referencedPaths = componentPaths(journal.nextManifest);
        for (const effect of journal.effects) {
            if (effect.kind !== "path-retire") continue;
            const normalized = effect.path.replaceAll("\\", "/").replace(/\/$/u, "");
            if (referencedPaths.some((componentPath) => componentPath === normalized || componentPath.startsWith(`${normalized}/`))) {
                throw new Error(`Operation path-retire仍包含nextManifest引用的组件目录：${effect.path}`);
            }
        }
    }
    if (journal.applicationStateMigration && !journal.nextManifest) {
        throw new Error(`Application State migration Operation journal缺少nextManifest：${path}`);
    }
    if (journal.migrationRoot) {
        assertAbsolutePathWithin(journalRoot, journal.migrationRoot, "Operation migrationRoot", {allowRoot: true});
    }
    for (const manifest of [journal.previousManifest, journal.nextManifest]) {
        if (manifest && manifest.containerEngine !== journal.containerEngine) {
            throw new Error(`Operation journal与Installation Manifest的Container Engine不一致：${path}`);
        }
    }
    const containerState = journal.effects.some((effect) => effect.kind === "compose" || effect.kind === "docker-image")
        || [journal.previousManifest, journal.nextManifest].some((manifest) => manifest?.profile === "ghcr" || manifest?.profile === "source-docker");
    if (containerState && !journal.containerEngine) {
        throw new Error(`包含容器状态的Operation journal缺少Container Engine：${path}`);
    }
    return journal;
}

/** 验证单条Effect的ownership、路径布局和恢复所需字段。 */
function assertOperationEffect(journal: OperationJournal, effect: OperationJournal["effects"][number], journalPath: string): void {
    if (effect.kind === "path-create" || effect.kind === "path-retire") {
        const relativePath = installationRelativePath(effect.path);
        assertOwnedEffectPath(journal, effect.owner, relativePath, effect.kind);
    }
    if (effect.kind === "wrapper-switch" && effect.backupPath) {
        assertAbsolutePathWithin(journal.backupRoot, effect.backupPath, "Manager wrapper backup");
    }
    if (effect.kind === "wrapper-switch" && effect.previousState === "present" && !effect.backupPath) {
        throw new Error(`已有Manager wrapper的切换Effect必须预先记录backupPath：${journalPath}`);
    }
    if (effect.kind === "wrapper-switch" && effect.previousState === "missing" && effect.backupPath) {
        throw new Error(`原本不存在Manager wrapper时不能记录backupPath：${journalPath}`);
    }
    if (effect.kind === "receipt-switch") {
        const committedBackupAlreadyRemoved = journal.phase === "committed"
            && effect.state === "applied"
            && !effect.cleanupError;
        if (effect.previousState === "present" && !effect.backupPath && !committedBackupAlreadyRemoved) {
            throw new Error(`已有Product回执的切换Effect必须预先记录backupPath：${journalPath}`);
        }
        if (effect.previousState === "missing" && effect.backupPath) {
            throw new Error(`原本不存在Product回执时不能记录backupPath：${journalPath}`);
        }
        if (effect.backupPath) assertAbsolutePathWithin(journal.backupRoot, effect.backupPath, "Product receipt backup");
    }
    if (effect.kind === "compose" && effect.previousCompose) {
        assertAbsolutePathWithin(journal.backupRoot, effect.previousCompose, "Docker previousCompose");
    }
    if (effect.kind === "candidate-container") {
        if (effect.state === "planned" && effect.containerId) {
            throw new Error(`planned candidate-container不能提前声明容器ID：${journalPath}`);
        }
        if (effect.state === "applied" && !effect.containerId) {
            throw new Error(`applied candidate-container缺少容器ID：${journalPath}`);
        }
        if (effect.state === "planned" && effect.stopped) {
            throw new Error(`未确认身份的candidate-container不能标记为已停止：${journalPath}`);
        }
        const manifest = journal.nextManifest ?? journal.previousManifest;
        if (!manifest || manifest.profile !== "ghcr" && manifest.profile !== "source-docker") {
            throw new Error(`candidate-container只能用于容器Profile：${journalPath}`);
        }
    }
    if (effect.kind === "sqlite-backup") {
        if (!isAbsolute(effect.stateRoot) || !isAbsolute(effect.hostPath)) {
            throw new Error(`App SQLite effect必须保存绝对stateRoot/hostPath：${journalPath}`);
        }
        assertAbsolutePathWithin(journal.backupRoot, effect.backupPath, "App SQLite backup");
        const manifest = journal.previousManifest ?? journal.nextManifest;
        if (!manifest) throw new Error(`App SQLite Operation journal缺少Manifest身份：${journalPath}`);
        const expectedStateRoot = resolveInstallationRoots(journal.root, manifest.roots).state;
        if (resolve(effect.stateRoot) !== expectedStateRoot) {
            throw new Error(`App SQLite effect的stateRoot与Manifest不一致：${effect.stateRoot}`);
        }
        const location = resolveAppSqliteLocation(effect.configuredUrl, effect.stateRoot);
        if (resolve(location.hostPath) !== resolve(effect.hostPath)) {
            throw new Error(`App SQLite configuredUrl与物理path不一致：${effect.configuredUrl} / ${effect.hostPath}`);
        }
        if ((manifest.profile === "ghcr" || manifest.profile === "source-docker") && location.scope !== "state-root") {
            throw new Error(`Docker Profile的App SQLite必须位于State Root内：${effect.hostPath}`);
        }
    }
    if (effect.kind === "docker-image") {
        const operationSuffix = `-${sourceDockerImageSuffix(journal.id)}`;
        if (!effect.image.startsWith("neuro-book-source:") || !effect.image.endsWith(operationSuffix)) {
            throw new Error(`Source Docker镜像不属于当前Operation：${effect.image}`);
        }
        const product = journal.nextManifest?.components.product;
        if (journal.nextManifest?.profile === "source-docker" && product?.provider === "container"
            && effect.image !== sourceDockerImageName(journal.nextManifest.sourceRevision, journal.id)) {
            throw new Error(`Source Docker镜像与nextManifest revision不一致：${effect.image}`);
        }
        const previousProduct = journal.previousManifest?.components.product;
        if (effect.previousImage && (journal.previousManifest?.profile !== "source-docker"
            || previousProduct?.provider !== "container" || previousProduct.image !== effect.previousImage)) {
            throw new Error(`Source Docker previousImage不属于previousManifest：${effect.previousImage}`);
        }
        if (effect.previousImage === effect.image) {
            throw new Error(`Source Docker新旧镜像代次不能相同：${effect.image}`);
        }
        if (effect.previousImageRetired && !effect.previousImage) {
            throw new Error(`Source Docker镜像没有previousImage却标记为已退役：${journalPath}`);
        }
    }
}

/** owner决定Effect可触达的固定Installation Root布局。 */
function assertOwnedEffectPath(journal: OperationJournal, owner: string, input: string, kind: "path-create" | "path-retire"): void {
    const path = input.replaceAll("\\", "/");
    if (owner === "staging" && path.startsWith(".deploy/staging/")) return;
    if (owner === "backup" && path.startsWith(".deploy/backups/")) return;
    if (owner === "source" && path === "node_modules") return;
    if (owner === "runtime" && path.startsWith(".runtime/bun/")) return;
    if (owner === "tool" && path.startsWith(".runtime/tools/")) return;
    if (owner === "manager" && path.startsWith(".runtime/manager/")) return;
    if (owner === "wrapper" && path === ".runtime/bin") return;
    if (owner === "portable-launcher" && new Set([
        "Start Neuro Book.cmd", "Start Neuro Book.ps1",
        "Update Neuro Book.cmd", "Update Neuro Book.ps1",
        "Create Admin.cmd", "Create Admin.ps1",
    ]).has(path)) return;
    if (owner === "state" && kind === "path-create") {
        const manifest = journal.nextManifest ?? journal.previousManifest;
        const stateLocator = manifest?.roots.state;
        const statePrefix = stateLocator?.base === "installation-root" ? `${stateLocator.path.replaceAll("\\", "/")}/` : null;
        if (statePrefix && new Set([
            `${statePrefix}workspace`, `${statePrefix}logs`, `${statePrefix}.env`, `${statePrefix}config.yaml`,
            `${statePrefix}workspace/.nbook/config.json`,
        ]).has(path)) return;
    }
    throw new Error(`Operation ${kind}的${owner} owner不拥有路径：${input}`);
}

/** Effect identity用于防止同一物理动作在Journal中出现互相矛盾的重复状态。 */
function operationEffectIdentity(effect: OperationJournal["effects"][number]): string {
    if (effect.kind === "path-create" || effect.kind === "path-retire") return `${effect.kind}:${effect.path}`;
    if (effect.kind === "component-switch") return `${effect.kind}:${effect.owner}`;
    return effect.kind;
}

/** 在严格解析前读取稳定Release envelope，用于优先提示Manager升级。 */
export function parseReleaseManifestEnvelope(value: unknown): {schemaVersion: number; minManagerVersion: string} {
    assertSchema(ReleaseManifestEnvelopeSchema, value, "release-manifest.json缺少有效的schemaVersion/minManagerVersion envelope。");
    const envelope = value as {schemaVersion: number; minManagerVersion: string};
    assertSemVer(envelope.minManagerVersion, "minManagerVersion");
    return {schemaVersion: envelope.schemaVersion, minManagerVersion: envelope.minManagerVersion};
}

/** 严格解析并执行 Release revision/platform 语义校验。 */
export function parseReleaseManifest(value: unknown): ReleaseManifest {
    assertSchema(ReleaseManifestSchema, value, "release-manifest.json 不符合 NeuroBook Release schema v5。");
    const manifest = value as ReleaseManifest;
    assertSemVer(manifest.version, "version");
    assertSemVer(manifest.minManagerVersion, "minManagerVersion");
    const platforms = new Set<string>();
    for (const product of manifest.products) {
        if (product.sourceRevision !== manifest.sourceRevision) {
            throw new Error(`Product ${product.platform} sourceRevision 与 Release Source 不一致。`);
        }
        if (platforms.has(product.platform)) {
            throw new Error(`Release Manifest 包含重复 Product 平台：${product.platform}`);
        }
        let filename: string;
        try {
            filename = new URL(product.url).pathname.split("/").at(-1) ?? "";
        } catch {
            throw new Error(`Product ${product.platform} URL非法：${product.url}`);
        }
        if (filename !== PRODUCT_ASSET_NAMES[product.platform]) {
            throw new Error(`Product ${product.platform}资产名非法：${filename}`);
        }
        platforms.add(product.platform);
    }
    const missingPlatforms = PRODUCT_PLATFORMS.filter((platform) => !platforms.has(platform));
    if (missingPlatforms.length > 0 || platforms.size !== PRODUCT_PLATFORMS.length) {
        throw new Error(`Release Manifest必须完整包含五个平台，缺少：${missingPlatforms.join(", ") || "<unknown>"}`);
    }
    if (manifest.ghcr.sourceRevision !== manifest.sourceRevision) {
        throw new Error("GHCR sourceRevision 与 Release Source 不一致。");
    }
    if (!manifest.ghcr.ref.endsWith(`@${manifest.ghcr.digest}`)) {
        throw new Error("GHCR ref 必须使用 Release Manifest 声明的不可变 digest。");
    }
    assertReleaseStateMigrationSemantics(manifest.stateMigration);
    return manifest;
}

/** 独立校验仓库级 Release state migration 声明，供资产构建器 fail-fast 使用。 */
export function parseReleaseStateMigration(value: unknown): ReleaseManifest["stateMigration"] {
    assertSchema(ReleaseStateMigrationSchema, value, "Release state migration 声明不符合 schema。");
    const declaration = value as ReleaseManifest["stateMigration"];
    assertReleaseStateMigrationSemantics(declaration);
    return declaration;
}

function assertReleaseStateMigrationSemantics(stateMigration: ReleaseManifest["stateMigration"]): void {
    if (stateMigration.policy === "none" && stateMigration.steps.length > 0) {
        throw new Error("stateMigration.policy=none 时 steps 必须为空。");
    }
    if (stateMigration.policy === "automatic" && stateMigration.steps.length === 0) {
        throw new Error("stateMigration.policy=automatic 时必须声明至少一个 step。");
    }
    if (stateMigration.policy === "automatic") {
        if (new Set(stateMigration.steps).size !== stateMigration.steps.length) {
            throw new Error("stateMigration.steps不能包含重复step。");
        }
    }
    if (stateMigration.policy === "manual" && !stateMigration.guide) {
        throw new Error("stateMigration.policy=manual 时必须提供 guide。");
    }
}

/** 把旧 Attachment 专用 journal 一次性转换为 Product-owned operation 记录。 */
export function migrateOperationJournal(value: unknown, path: string): OperationJournal {
    if (typeof value !== "object" || value === null || !("schemaVersion" in value)) {
        return parseOperationJournal(value, path);
    }
    if (value.schemaVersion === 4) {
        assertSchema(OperationJournalV4Schema, value, `Operation journal v4 不符合可迁移 schema：${path}`);
        return parseOperationJournal({...value, schemaVersion: 5}, path);
    }
    if (value.schemaVersion !== 3) return parseOperationJournal(value, path);
    assertSchema(OperationJournalV3Schema, value, `Operation journal v3 不符合可迁移 schema：${path}`);
    const legacy = value as Static<typeof OperationJournalV3Schema>;
    const {attachmentMigration, ...base} = legacy;
    const converted: OperationJournal = {
        ...base,
        schemaVersion: 5,
        ...(attachmentMigration ? {
            applicationStateMigration: {
                runId: attachmentMigration.runId.slice(0, -"-attachment".length),
                state: attachmentMigration.state,
            },
        } : {}),
    };
    return parseOperationJournal(converted, path);
}

function assertInstallationSemantics(manifest: InstallationManifest): void {
    const {source, product, applicationRuntime, tools} = manifest.components;
    if (source.revision !== manifest.sourceRevision || product && product.revision !== manifest.sourceRevision) {
        throw new Error("Installation Source/Product revision 与 sourceRevision 不一致。");
    }
    assertRootLocatorsSemantics(manifest.profile, manifest.roots);
    const expected = profileContract(manifest.profile);
    const containerProfile = manifest.profile === "ghcr" || manifest.profile === "source-docker";
    if (containerProfile !== (manifest.containerEngine !== null)) {
        throw new Error(`Profile ${manifest.profile}的Container Engine记录非法。`);
    }
    if (source.provider !== expected.source || (product?.provider ?? "none") !== expected.product || !expected.runtimes.includes(applicationRuntime.provider)) {
        throw new Error(`Profile ${manifest.profile} 的 Source/Product/Application Runtime 组件组合非法。`);
    }
    if (manifest.profile === "windows-portable") {
        if (tools.rg?.provider !== "managed" || tools.git?.provider !== "managed" || !("bashPath" in tools.git)) {
            throw new Error("Windows Portable 必须包含 managed rg 和提供 bash 的 PortableGit。" );
        }
    }
    if (manifest.profile === "ghcr" || manifest.profile === "source-docker") {
        if (tools.rg?.provider !== "container" || tools.git?.provider !== "container" || tools.python?.provider !== "container") {
            throw new Error(`${manifest.profile} 的应用工具必须由 container provider 提供。`);
        }
    }
    if (manifest.profile === "ghcr" && (!product || product.provider !== "container" || !product.digest)) {
        throw new Error("GHCR Product 必须记录不可变 image digest。");
    }
    if (manifest.profile === "ghcr" && product?.provider === "container" && product.containerImageId) {
        throw new Error("GHCR Product 使用 OCI digest，不记录本地 Container Engine image ID。");
    }
    if (manifest.profile === "source-docker" && product?.provider === "container" && product.digest) {
        throw new Error("Source Docker 使用本地 revision image，不记录 GHCR digest。");
    }
    if (manifest.profile === "source-docker" && product?.provider === "container" && !product.containerImageId) {
        throw new Error("Source Docker Product 必须记录本次 build 的 Container Engine image ID。");
    }
    if (manifest.profile === "source-docker" && product?.provider === "container"
        && (product.imageId || product.sourceDigest || product.lockfileSha256 || product.builderContractVersion)) {
        throw new Error("Source Docker 使用本地 revision image，不伪造 Builder Runtime Image identity。");
    }
}

function profileContract(profile: InstallationManifest["profile"]): {source: string; product: string; runtimes: string[]} {
    switch (profile) {
        case "source-dev": return {source: "git", product: "none", runtimes: ["system", "managed"]};
        case "source-product": return {source: "git", product: "git", runtimes: ["system", "managed"]};
        case "product-bun": return {source: "release", product: "release", runtimes: ["system", "managed"]};
        case "windows-portable": return {source: "release", product: "release", runtimes: ["managed"]};
        case "source-docker": return {source: "git", product: "container", runtimes: ["container"]};
        case "ghcr": return {source: "container", product: "container", runtimes: ["container"]};
    }
}

function assertComponentPaths(manifest: InstallationManifest): void {
    for (const path of componentPaths(manifest)) assertSafeRelativePath(path);
}

/** 返回Manifest直接引用的Installation Root相对组件路径。 */
function componentPaths(manifest: InstallationManifest): string[] {
    return [
        manifest.components.manager.path,
        manifest.components.managerRuntime.provider === "managed" ? manifest.components.managerRuntime.path : null,
        manifest.components.applicationRuntime.provider === "managed" ? manifest.components.applicationRuntime.path : null,
        manifest.components.tools.rg?.provider === "managed" ? manifest.components.tools.rg.path : null,
        manifest.components.tools.git?.provider === "managed" ? manifest.components.tools.git.path : null,
        manifest.components.tools.git?.provider === "managed" ? manifest.components.tools.git.bashPath : null,
        manifest.components.product && manifest.components.product.provider !== "container" ? manifest.components.product.path : null,
        ...Object.values(manifest.roots)
            .filter((locator) => locator.base === "installation-root")
            .map((locator) => locator.path),
        manifest.profile === "ghcr" || manifest.profile === "source-docker" ? ".deploy/docker-compose.generated.yml" : null,
        ".runtime/bin",
        ...manifest.components.source.provider === "release" ? manifest.components.source.files : [],
    ].filter((path): path is string => Boolean(path)).map((path) => path.replaceAll("\\", "/"));
}

export function assertSafeRelativePath(path: string): void {
    installationRelativePath(path);
}

/** 校验四类 root 的路径合同以及 Profile 允许的完整布局。 */
function assertRootLocatorsSemantics(
    profile: InstallationManifest["profile"],
    roots: InstallationRootLocators,
): void {
    for (const [name, locator] of Object.entries(roots)) {
        try {
            installationRelativePath(locator.path);
        } catch {
            throw new Error(`${name} locator path 非法：${locator.path}`);
        }
    }
    if (profile === "windows-portable") {
        if (!rootLocatorsEqual(roots, PORTABLE_ROOT_LOCATORS)) {
            throw new Error("Windows Portable 的 Root Locator 布局非法。");
        }
        return;
    }
    const installedWindows = rootLocatorsEqual(roots, INSTALLED_WINDOWS_ROOT_LOCATORS);
    const installedMacos = rootLocatorsEqual(roots, INSTALLED_MACOS_ROOT_LOCATORS);
    const installationScoped = rootLocatorsEqual(roots, INSTALLATION_SCOPED_ROOT_LOCATORS);
    if (profile === "product-bun" ? !installedWindows && !installedMacos && !installationScoped : !installationScoped) {
        throw new Error(`Profile ${profile} 的 Root Locator 布局非法。`);
    }
}

function assertSemVer(version: string, field: string): void {
    if (!valid(version)) throw new Error(`${field} 不是合法 SemVer：${version}`);
}

function assertSchema(schema: TSchema, value: unknown, message: string): void {
    if (!Value.Check(schema, value)) throw new Error(message);
}
