export const DESKTOP_BRIDGE_SCHEMA = "nbook.desktop-bridge/v2";
export const DESKTOP_DISTRIBUTION_SCHEMA = "nbook.desktop-distribution/v1";
export const DESKTOP_INSTALLATION_SCHEMA = "nbook.desktop-installation/v3";
export const DESKTOP_SETTINGS_SCHEMA = "nbook.desktop-settings/v1";
export const DESKTOP_SUPERVISOR_SCHEMA = "nbook.desktop-supervisor/v1";
export const DESKTOP_CAPABILITY_SCHEMA = "nbook.desktop-capability/v1";
export const DESKTOP_USER_INSTALLATION_SCHEMA = "nbook.desktop-user-installation/v1";
export const DESKTOP_SHELL_SCHEMA = "nbook.desktop-shell/v1";
export const DESKTOP_PORTABLE_SCHEMA = "nbook.desktop-portable/v1";

export const DESKTOP_ENVELOPES = ["electron", "tauri"] as const;
export const DESKTOP_CHANNELS = ["stable", "canary"] as const;
export const DESKTOP_COMPONENT_IDS = [
    "source",
    "product",
    "bun",
    "manager-cli",
    "electron-envelope",
    "electron-application",
    "tauri-envelope",
    "tool-pack",
    "webview2-runtime",
] as const;
export const DESKTOP_MENU_COMMAND_IDS = [
    "file.open",
    "file.settings",
    "file.quit",
    "edit.undo",
    "edit.redo",
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "edit.select-all",
    "view.reload",
    "view.zoom-in",
    "view.zoom-out",
    "view.zoom-reset",
    "help.documentation",
    "help.about",
] as const;
export const DESKTOP_WINDOW_COMMAND_IDS = [
    "show",
    "hide",
    "minimize",
    "toggle-maximize",
    "close",
    "quit",
    "open-logs",
] as const;

export type DesktopEnvelope = typeof DESKTOP_ENVELOPES[number];
export type DesktopHostPlatform = "windows" | "macos";
export type DesktopArchitecture = "x64" | "arm64";
export type DesktopChannel = typeof DESKTOP_CHANNELS[number];
export type DesktopComponentId = typeof DESKTOP_COMPONENT_IDS[number];
export type DesktopMenuCommandId = typeof DESKTOP_MENU_COMMAND_IDS[number];
export type DesktopWindowCommandId = typeof DESKTOP_WINDOW_COMMAND_IDS[number];
export type DesktopCloseBehavior = "ask" | "tray" | "quit";
export type DesktopAppearance = "light" | "dark";
export type DesktopPlatform = "windows" | "macos" | "linux";
export type DesktopMenuPresentation = "renderer" | "native";
export type DesktopWindowControls = "overlay" | "custom" | "traffic-lights";
export type DesktopInstallationScope = "user" | "machine";

export type DesktopComponentArchive = {
    kind: "path" | "url";
    location: string;
    sha256: string;
    bytes: number;
    format: "zip" | "file";
};

export type DesktopDistributionComponent = {
    id: DesktopComponentId;
    version: string;
    archive: DesktopComponentArchive;
    required: boolean;
};

/** 远端 Desktop 只需要的 Envelope depot；不得携带 Product、Bun 或 Tool Pack。 */
type DesktopShellArchiveManifestBase = {
    schema: typeof DESKTOP_SHELL_SCHEMA;
    platform: "windows-x64";
    envelopePath: string;
    envelopeVersion: string;
    envelopeSha256: string;
    webview: "bundled-chromium" | "system-evergreen";
};

export type DesktopShellArchiveManifest =
    | DesktopShellArchiveManifestBase & {
        kind: "electron";
        applicationPath: "desktop/resources/app.asar";
        applicationVersion: string;
        applicationSha256: string;
    }
    | DesktopShellArchiveManifestBase & {kind: "tauri"};

/** 完整 Desktop Portable 的壳与 Product 身份；Electron 应用代码单独保护。 */
type DesktopPortableArchiveManifestBase = {
    schema: typeof DESKTOP_PORTABLE_SCHEMA;
    platform: "windows-x64";
    product: {
        imagePath: ".output";
        imageId: string;
        sourceRevision: string;
        sourceDigest: string;
        dirty: boolean;
        contractSchema: string;
        contractSha256: string;
    };
    toolPack: {files: number; bytes: number; digest: string};
    roots: {
        application: ".";
        state: "data";
        cache: ".cache";
        desktop: "data/.desktop";
        webview: "data/.desktop/webview";
    };
    payload: {files: number; bytes: number; digest: string};
};

type DesktopPortableRuntimeBase = {
    bunPath: "runtime/bun.exe";
    bunVersion: string;
    envelopePath: string;
    envelopeVersion: string;
    envelopeSha256: string;
};

export type DesktopPortableArchiveManifest =
    | DesktopPortableArchiveManifestBase & {
        kind: "electron";
        runtime: DesktopPortableRuntimeBase & {
            applicationPath: "desktop/resources/app.asar";
            applicationSha256: string;
        };
        webview: {kind: "bundled-chromium"; webviewRoot: "data/.desktop/webview"};
    }
    | DesktopPortableArchiveManifestBase & {
        kind: "tauri";
        runtime: DesktopPortableRuntimeBase;
        webview: {kind: "system-evergreen"; webviewRoot: "data/.desktop/webview"};
    };

/** 可下载组件的不可变发行声明；组件本身只允许内容寻址 archive。 */
export type DesktopDistributionManifest = {
    schema: typeof DESKTOP_DISTRIBUTION_SCHEMA;
    version: string;
    channel: DesktopChannel;
    platform: "windows" | "macos";
    architecture: "x64" | "arm64";
    components: DesktopDistributionComponent[];
};

export type DesktopInstalledComponent = {
    id: DesktopComponentId;
    version: string;
    path: string;
    sha256: string;
};

export type DesktopManagedProvider = {
    provider: "managed";
    version: string;
    path: string;
    sha256: string;
};

export type DesktopSystemProvider = {
    provider: "system";
    version: string;
    executable: string;
};

export type DesktopProviderLocator = DesktopManagedProvider | DesktopSystemProvider;

export type DesktopToolProviderLocator =
    | DesktopManagedProvider & {bashPath?: string}
    | DesktopSystemProvider & {bashExecutable?: string};

export type DesktopInstallationProviders = {
    managerRuntime: DesktopProviderLocator;
    applicationRuntime: DesktopProviderLocator;
    tools: {
        rg: DesktopToolProviderLocator;
        git: DesktopToolProviderLocator;
    };
};

export type DesktopComponentReceipt = {
    id: DesktopComponentId;
    version: string;
    path: string;
    sha256: string;
    source: "depot" | "network" | "managed";
};

export type DesktopUninstallPolicy = {
    preserveStateRootByDefault: true;
    deleteStateRootRequiresExplicit: true;
    preserveExternalProjectWorkspace: true;
};

export type DesktopInstallationUserRoots = {
    state: {base: "local-app-data" | "user-app-data"; path: string};
    cache: {base: "local-app-data" | "user-cache"; path: string};
    desktop: {base: "local-app-data" | "user-app-data"; path: string};
    webview: {base: "local-app-data" | "user-app-data"; path: string};
};

export type DesktopConnection =
    | {mode: "local"}
    | {mode: "remote"; baseUrl: string; insecureHttpAccepted: boolean};

/** 用户级安装的稳定路径合同；只保存模板，不保存本机绝对路径。 */
export type DesktopUserInstallationContract = {
    schema: typeof DESKTOP_USER_INSTALLATION_SCHEMA;
    platform: DesktopHostPlatform;
    architecture: DesktopArchitecture;
    applicationBundle: string;
    installationRoot: string;
    stateRoot: string;
    cacheRoot: string;
    desktopRoot: string;
    webviewRoot: string;
    signedBundleRequired: boolean;
    portable: false;
};

/** 返回 Windows/macOS 用户级安装合同；macOS 只支持分架构，不声称已产出安装包。 */
export function desktopUserInstallationContract(
    platform: DesktopHostPlatform,
    architecture: DesktopArchitecture,
): DesktopUserInstallationContract {
    if (platform === "windows") {
        if (architecture !== "x64") throw new Error("Windows 用户级 Desktop 当前只支持 x64。" );
        return {
            schema: DESKTOP_USER_INSTALLATION_SCHEMA,
            platform,
            architecture,
            applicationBundle: "%LOCALAPPDATA%/Programs/NeuroBook",
            installationRoot: "%LOCALAPPDATA%/Programs/NeuroBook",
            stateRoot: "%LOCALAPPDATA%/NeuroBook/data",
            cacheRoot: "%LOCALAPPDATA%/NeuroBook/cache",
            desktopRoot: "%LOCALAPPDATA%/NeuroBook/desktop",
            webviewRoot: "%LOCALAPPDATA%/NeuroBook/desktop/webview",
            signedBundleRequired: false,
            portable: false,
        };
    }
    return {
        schema: DESKTOP_USER_INSTALLATION_SCHEMA,
        platform,
        architecture,
        applicationBundle: "~/Applications/NeuroBook.app",
        installationRoot: "~/Library/Application Support/NeuroBook/installation",
        stateRoot: "~/Library/Application Support/NeuroBook/data",
        cacheRoot: "~/Library/Caches/NeuroBook",
        desktopRoot: "~/Library/Application Support/NeuroBook/desktop",
        webviewRoot: "~/Library/Application Support/NeuroBook/desktop/webview",
        signedBundleRequired: true,
        portable: false,
    };
}

/** Desktop 安装层的本机真相源；所有组件路径均相对 Installation Root。 */
export type DesktopInstallationManifest = {
    schema: typeof DESKTOP_INSTALLATION_SCHEMA;
    installationId: string;
    installationScope: DesktopInstallationScope;
    programRoot: ".";
    userRoots: DesktopInstallationUserRoots;
    envelope: DesktopEnvelope;
    channel: DesktopChannel;
    connection: DesktopConnection;
    providers: DesktopInstallationProviders;
    components: DesktopInstalledComponent[];
    receipts: DesktopComponentReceipt[];
    uninstall: DesktopUninstallPolicy;
    addCliToUserPath: boolean;
    installedAt: string;
    updatedAt: string;
};

/** 设备本地设置，不进入 Product State Root 或内容备份。 */
export type DesktopSettings = {
    schema: typeof DESKTOP_SETTINGS_SCHEMA;
    zoomFactor: number;
    trayEnabled: boolean;
    closeBehavior: DesktopCloseBehavior;
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = Object.freeze({
    schema: DESKTOP_SETTINGS_SCHEMA,
    zoomFactor: 1,
    trayEnabled: true,
    closeBehavior: "ask",
});

export type DesktopStatus = {
    schema: typeof DESKTOP_BRIDGE_SCHEMA;
    envelope: DesktopEnvelope;
    connection: "local" | "remote";
    version: string;
    origin: string;
    insecureRemote: boolean;
    platform: DesktopPlatform;
    menuPresentation: DesktopMenuPresentation;
    windowControls: DesktopWindowControls;
};

export type DesktopSettingsPatch = Partial<Pick<DesktopSettings, "zoomFactor" | "trayEnabled" | "closeBehavior">>;

/** Windows/macOS 将第二次启动、协议和未来文件关联投影为同一个有界请求。 */
export type DesktopLaunchRequest = {
    args: string[];
    cwd: string;
};

/** Renderer 唯一允许看到的宿主能力；不包含 shell、fs 或 Manager 控制凭据。 */
export interface DesktopBridge {
    readonly schema: typeof DESKTOP_BRIDGE_SCHEMA;
    status(): Promise<DesktopStatus>;
    setAppearance(appearance: DesktopAppearance): Promise<void>;
    settings(): Promise<DesktopSettings>;
    updateSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
    window(command: DesktopWindowCommandId): Promise<void>;
    menu(command: DesktopMenuCommandId): Promise<void>;
    onMenuCommand(listener: (command: DesktopMenuCommandId) => void): () => void;
    onLaunchRequest(listener: (request: DesktopLaunchRequest) => void): () => void;
}

export type DesktopCapability = {
    schema: typeof DESKTOP_CAPABILITY_SCHEMA;
    productVersion: string;
    bridgeSchemas: [typeof DESKTOP_BRIDGE_SCHEMA];
    supportsRemoteDesktop: true;
};

export type DesktopSupervisorRequest =
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "start"; startupNonce: string; port: number}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "stop"}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "verify"}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "repair"};

export type DesktopSupervisorStage =
    | "full-verify"
    | "migration"
    | "starting-product"
    | "waiting-ready"
    | "stopping-product"
    | "repairing";

export type DesktopSupervisorEvent =
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "stage"; stage: DesktopSupervisorStage}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "ready"; url: string; origin: string; version: string; startupNonce: string}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "verified"; verification: "quick" | "full"}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "stopped"; shutdown: "graceful" | "forced"}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "failure"; code: string; message: string; recoverable: boolean}
    | {schema: typeof DESKTOP_SUPERVISOR_SCHEMA; requestId: string; type: "logs"; path: string};

/** 严格解析 Desktop Distribution Manifest。输入是磁盘或网络上的不可信 JSON。 */
export function parseDesktopDistributionManifest(value: unknown): DesktopDistributionManifest {
    const root = object(value, "Desktop Distribution Manifest");
    exactKeys(root, ["schema", "version", "channel", "platform", "architecture", "components"], "Desktop Distribution Manifest");
    literal(root.schema, DESKTOP_DISTRIBUTION_SCHEMA, "schema");
    const version = nonEmptyString(root.version, "version");
    const channel = member(root.channel, DESKTOP_CHANNELS, "channel");
    const platform = member(root.platform, ["windows", "macos"] as const, "platform");
    const architecture = member(root.architecture, ["x64", "arm64"] as const, "architecture");
    if (!Array.isArray(root.components)) throw new Error("components 必须是数组。");
    const components = root.components.map((item, index) => parseDistributionComponent(item, index));
    assertUnique(components.map((item) => item.id), "Desktop Distribution components");
    return {schema: DESKTOP_DISTRIBUTION_SCHEMA, version, channel, platform, architecture, components};
}

/** 严格解析远端 Desktop 壳 depot manifest。 */
export function parseDesktopShellArchiveManifest(value: unknown): DesktopShellArchiveManifest {
    const root = object(value, "Desktop Shell Archive Manifest");
    literal(root.schema, DESKTOP_SHELL_SCHEMA, "schema");
    const kind = member(root.kind, DESKTOP_ENVELOPES, "kind");
    const applicationKeys = kind === "electron"
        ? ["applicationPath", "applicationVersion", "applicationSha256"]
        : [];
    exactKeys(root, [
        "schema",
        "kind",
        "platform",
        "envelopePath",
        "envelopeVersion",
        "envelopeSha256",
        ...applicationKeys,
        "webview",
    ], "Desktop Shell Archive Manifest");
    literal(root.platform, "windows-x64", "platform");
    const envelopePath = desktopRelativePath(nonEmptyString(root.envelopePath, "envelopePath"), "envelopePath");
    const expectedPath = kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    if (envelopePath !== expectedPath) throw new Error(`Envelope 路径与壳类型不一致：${envelopePath}`);
    const common: DesktopShellArchiveManifestBase = {
        schema: DESKTOP_SHELL_SCHEMA,
        platform: "windows-x64",
        envelopePath,
        envelopeVersion: nonEmptyString(root.envelopeVersion, "envelopeVersion"),
        envelopeSha256: sha256(root.envelopeSha256, "envelopeSha256"),
        webview: member(root.webview, ["bundled-chromium", "system-evergreen"] as const, "webview"),
    };
    if (kind === "tauri") return {...common, kind};
    const applicationPath = desktopRelativePath(nonEmptyString(root.applicationPath, "applicationPath"), "applicationPath");
    if (applicationPath !== "desktop/resources/app.asar") {
        throw new Error(`Electron application 路径不受支持：${applicationPath}`);
    }
    return {
        ...common,
        kind,
        applicationPath,
        applicationVersion: nonEmptyString(root.applicationVersion, "applicationVersion"),
        applicationSha256: sha256(root.applicationSha256, "applicationSha256"),
    };
}

/** 严格解析完整 Desktop Portable manifest。 */
export function parseDesktopPortableManifest(value: unknown): DesktopPortableArchiveManifest {
    const root = object(value, "Desktop Portable Manifest");
    exactKeys(root, [
        "schema",
        "kind",
        "platform",
        "product",
        "runtime",
        "toolPack",
        "roots",
        "webview",
        "payload",
    ], "Desktop Portable Manifest");
    literal(root.schema, DESKTOP_PORTABLE_SCHEMA, "schema");
    const kind = member(root.kind, DESKTOP_ENVELOPES, "kind");
    literal(root.platform, "windows-x64", "platform");
    const product = object(root.product, "product");
    exactKeys(product, [
        "imagePath",
        "imageId",
        "sourceRevision",
        "sourceDigest",
        "dirty",
        "contractSchema",
        "contractSha256",
    ], "product");
    literal(product.imagePath, ".output", "product.imagePath");
    const sourceRevision = nonEmptyString(product.sourceRevision, "product.sourceRevision");
    if (!/^[a-f0-9]{40,64}$/u.test(sourceRevision)) {
        throw new Error("product.sourceRevision 必须是 40–64 位小写十六进制 revision。");
    }
    const runtime = object(root.runtime, "runtime");
    const applicationKeys = kind === "electron" ? ["applicationPath", "applicationSha256"] : [];
    exactKeys(runtime, [
        "bunPath",
        "bunVersion",
        "envelopePath",
        "envelopeVersion",
        "envelopeSha256",
        ...applicationKeys,
    ], "runtime");
    literal(runtime.bunPath, "runtime/bun.exe", "runtime.bunPath");
    const envelopePath = desktopRelativePath(nonEmptyString(runtime.envelopePath, "runtime.envelopePath"), "runtime.envelopePath");
    const expectedEnvelopePath = kind === "electron" ? "desktop/NeuroBook-Electron.exe" : "desktop/NeuroBook-Tauri.exe";
    if (envelopePath !== expectedEnvelopePath) {
        throw new Error(`Portable Envelope 路径与壳类型不一致：${envelopePath}`);
    }
    const toolPack = object(root.toolPack, "toolPack");
    exactKeys(toolPack, ["files", "bytes", "digest"], "toolPack");
    const roots = object(root.roots, "roots");
    exactKeys(roots, ["application", "state", "cache", "desktop", "webview"], "roots");
    const webview = object(root.webview, "webview");
    exactKeys(webview, ["kind", "webviewRoot"], "webview");
    const payload = object(root.payload, "payload");
    exactKeys(payload, ["files", "bytes", "digest"], "payload");
    const common: DesktopPortableArchiveManifestBase & {runtime: DesktopPortableRuntimeBase} = {
        schema: DESKTOP_PORTABLE_SCHEMA,
        platform: "windows-x64",
        product: {
            imagePath: ".output",
            imageId: sha256(product.imageId, "product.imageId"),
            sourceRevision,
            sourceDigest: sha256(product.sourceDigest, "product.sourceDigest"),
            dirty: boolean(product.dirty, "product.dirty"),
            contractSchema: nonEmptyString(product.contractSchema, "product.contractSchema"),
            contractSha256: sha256(product.contractSha256, "product.contractSha256"),
        },
        runtime: {
            bunPath: "runtime/bun.exe",
            bunVersion: nonEmptyString(runtime.bunVersion, "runtime.bunVersion"),
            envelopePath,
            envelopeVersion: nonEmptyString(runtime.envelopeVersion, "runtime.envelopeVersion"),
            envelopeSha256: sha256(runtime.envelopeSha256, "runtime.envelopeSha256"),
        },
        toolPack: {
            files: nonNegativeInteger(toolPack.files, "toolPack.files"),
            bytes: nonNegativeInteger(toolPack.bytes, "toolPack.bytes"),
            digest: sha256(toolPack.digest, "toolPack.digest"),
        },
        roots: {
            application: literal(roots.application, ".", "roots.application"),
            state: literal(roots.state, "data", "roots.state"),
            cache: literal(roots.cache, ".cache", "roots.cache"),
            desktop: literal(roots.desktop, "data/.desktop", "roots.desktop"),
            webview: literal(roots.webview, "data/.desktop/webview", "roots.webview"),
        },
        payload: {
            files: nonNegativeInteger(payload.files, "payload.files"),
            bytes: nonNegativeInteger(payload.bytes, "payload.bytes"),
            digest: sha256(payload.digest, "payload.digest"),
        },
    };
    const webviewRoot = literal(webview.webviewRoot, "data/.desktop/webview", "webview.webviewRoot");
    if (kind === "tauri") {
        return {
            ...common,
            kind,
            webview: {
                kind: literal(webview.kind, "system-evergreen", "webview.kind"),
                webviewRoot,
            },
        };
    }
    const applicationPath = desktopRelativePath(nonEmptyString(runtime.applicationPath, "runtime.applicationPath"), "runtime.applicationPath");
    if (applicationPath !== "desktop/resources/app.asar") {
        throw new Error(`Portable Electron application 路径不受支持：${applicationPath}`);
    }
    return {
        ...common,
        kind,
        runtime: {
            ...common.runtime,
            applicationPath,
            applicationSha256: sha256(runtime.applicationSha256, "runtime.applicationSha256"),
        },
        webview: {
            kind: literal(webview.kind, "bundled-chromium", "webview.kind"),
            webviewRoot,
        },
    };
}

/** 严格解析 Desktop Installation Manifest。输入是本机磁盘上的不可信 JSON。 */
export function parseDesktopInstallationManifest(value: unknown): DesktopInstallationManifest {
    const root = object(value, "Desktop Installation Manifest");
    exactKeys(root, [
        "schema",
        "installationId",
        "installationScope",
        "programRoot",
        "userRoots",
        "envelope",
        "channel",
        "connection",
        "providers",
        "components",
        "receipts",
        "uninstall",
        "addCliToUserPath",
        "installedAt",
        "updatedAt",
    ], "Desktop Installation Manifest");
    literal(root.schema, DESKTOP_INSTALLATION_SCHEMA, "schema");
    const installationId = nonEmptyString(root.installationId, "installationId");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(installationId)) {
        throw new Error("installationId 必须是单段安全标识。");
    }
    const installationScope = member(root.installationScope, ["user", "machine"] as const, "installationScope");
    literal(root.programRoot, ".", "programRoot");
    const userRoots = parseDesktopInstallationUserRoots(root.userRoots);
    const envelope = member(root.envelope, DESKTOP_ENVELOPES, "envelope");
    const channel = member(root.channel, DESKTOP_CHANNELS, "channel");
    const connection = parseConnection(root.connection);
    const providers = parseDesktopInstallationProviders(root.providers);
    if (!Array.isArray(root.components)) throw new Error("components 必须是数组。");
    const components = root.components.map((item, index) => parseInstalledComponent(item, index));
    assertUnique(components.map((item) => item.id), "Desktop Installation components");
    assertDesktopEnvelopeComponents(envelope, components);
    if (!Array.isArray(root.receipts)) throw new Error("receipts 必须是数组。");
    const receipts = root.receipts.map((item, index) => parseDesktopComponentReceipt(item, index));
    assertUnique(receipts.map((item) => item.id), "Desktop Installation receipts");
    if (receipts.length !== components.length || receipts.some((receipt) => {
        const component = components.find((item) => item.id === receipt.id);
        return !component || component.version !== receipt.version || component.path !== receipt.path || component.sha256 !== receipt.sha256;
    })) {
        throw new Error("Desktop Installation receipts 必须与 components 逐项一致。");
    }
    const uninstall = parseDesktopUninstallPolicy(root.uninstall);
    const addCliToUserPath = boolean(root.addCliToUserPath, "addCliToUserPath");
    const installedAt = isoDate(root.installedAt, "installedAt");
    const updatedAt = isoDate(root.updatedAt, "updatedAt");
    return {
        schema: DESKTOP_INSTALLATION_SCHEMA,
        installationId,
        installationScope,
        programRoot: ".",
        userRoots,
        envelope,
        channel,
        connection,
        providers,
        components,
        receipts,
        uninstall,
        addCliToUserPath,
        installedAt,
        updatedAt,
    };
}

/** 壳可执行文件与实际 Electron 应用代码必须同时进入安装真相源。 */
function assertDesktopEnvelopeComponents(
    envelope: DesktopEnvelope,
    components: DesktopInstalledComponent[],
): void {
    const executableId = envelope === "electron" ? "electron-envelope" : "tauri-envelope";
    const executablePath = envelope === "electron"
        ? "desktop/NeuroBook-Electron.exe"
        : "desktop/NeuroBook-Tauri.exe";
    const executable = components.find((component) => component.id === executableId);
    if (!executable || executable.path !== executablePath) {
        throw new Error(`Desktop Installation Manifest 缺少固定路径的 ${executableId} component。`);
    }
    const application = components.find((component) => component.id === "electron-application");
    if (envelope === "electron") {
        if (!application || application.path !== "desktop/resources/app.asar") {
            throw new Error("Desktop Installation Manifest 缺少固定路径的 electron-application component。");
        }
    } else if (application) {
        throw new Error("Tauri Installation Manifest 不能包含 electron-application component。");
    }
}

/** 严格解析 Desktop 设备设置，并校验缩放范围。 */
export function parseDesktopSettings(value: unknown): DesktopSettings {
    const root = object(value, "Desktop Settings");
    exactKeys(root, ["schema", "zoomFactor", "trayEnabled", "closeBehavior"], "Desktop Settings");
    literal(root.schema, DESKTOP_SETTINGS_SCHEMA, "schema");
    const zoomFactor = number(root.zoomFactor, "zoomFactor");
    if (zoomFactor < 0.75 || zoomFactor > 2) throw new Error("zoomFactor 必须位于 0.75 到 2 之间。");
    const trayEnabled = boolean(root.trayEnabled, "trayEnabled");
    const closeBehavior = member(root.closeBehavior, ["ask", "tray", "quit"] as const, "closeBehavior");
    return {schema: DESKTOP_SETTINGS_SCHEMA, zoomFactor, trayEnabled, closeBehavior};
}

/** 应用部分 Desktop 设置；未知字段和越界缩放直接失败。 */
export function patchDesktopSettings(current: DesktopSettings, patch: DesktopSettingsPatch): DesktopSettings {
    const patchRecord = object(patch, "Desktop Settings patch");
    const allowed = ["zoomFactor", "trayEnabled", "closeBehavior"];
    if (Object.keys(patchRecord).some((key) => !allowed.includes(key))) throw new Error("Desktop Settings patch 包含未知字段。");
    return parseDesktopSettings({...current, ...patch});
}

/** 严格解析 Envelope 返回的 Desktop Chrome 能力。 */
export function parseDesktopStatus(value: unknown): DesktopStatus {
    const root = object(value, "Desktop status");
    exactKeys(root, [
        "schema",
        "envelope",
        "connection",
        "version",
        "origin",
        "insecureRemote",
        "platform",
        "menuPresentation",
        "windowControls",
    ], "Desktop status");
    literal(root.schema, DESKTOP_BRIDGE_SCHEMA, "schema");
    return {
        schema: DESKTOP_BRIDGE_SCHEMA,
        envelope: member(root.envelope, DESKTOP_ENVELOPES, "envelope"),
        connection: member(root.connection, ["local", "remote"] as const, "connection"),
        version: nonEmptyString(root.version, "version"),
        origin: desktopRemoteOrigin(nonEmptyString(root.origin, "origin"), true),
        insecureRemote: boolean(root.insecureRemote, "insecureRemote"),
        platform: member(root.platform, ["windows", "macos", "linux"] as const, "platform"),
        menuPresentation: member(root.menuPresentation, ["renderer", "native"] as const, "menuPresentation"),
        windowControls: member(root.windowControls, ["overlay", "custom", "traffic-lights"] as const, "windowControls"),
    };
}

/** 严格收窄单实例转发参数，避免无限 argv/cwd 进入 Renderer。 */
export function parseDesktopLaunchRequest(value: unknown): DesktopLaunchRequest {
    const root = object(value, "Desktop launch request");
    exactKeys(root, ["args", "cwd"], "Desktop launch request");
    if (!Array.isArray(root.args)) throw new Error("Desktop launch request args 必须是数组。");
    if (root.args.length > 32) throw new Error("Desktop launch request args 最多包含 32 项。");
    const args = root.args.map((arg, index) => {
        if (typeof arg !== "string" || arg.includes("\0")) {
            throw new Error(`Desktop launch request args[${String(index)}] 必须是不含 NUL 的字符串。`);
        }
        if (arg.length > 4096) {
            throw new Error(`Desktop launch request args[${String(index)}] 最多包含 4096 个字符。`);
        }
        return arg;
    });
    const cwd = nonEmptyString(root.cwd, "Desktop launch request cwd");
    if (cwd.length > 4096) throw new Error("Desktop launch request cwd 最多包含 4096 个字符。");
    return {args, cwd};
}

/** 严格解析远端 Product 的 Desktop capability。 */
export function parseDesktopCapability(value: unknown): DesktopCapability {
    const root = object(value, "Desktop capability");
    exactKeys(root, ["schema", "productVersion", "bridgeSchemas", "supportsRemoteDesktop"], "Desktop capability");
    literal(root.schema, DESKTOP_CAPABILITY_SCHEMA, "schema");
    const productVersion = nonEmptyString(root.productVersion, "productVersion");
    if (!Array.isArray(root.bridgeSchemas) || root.bridgeSchemas.length !== 1 || root.bridgeSchemas[0] !== DESKTOP_BRIDGE_SCHEMA) {
        throw new Error("Desktop capability 不支持 DesktopBridge v2。");
    }
    literal(root.supportsRemoteDesktop, true, "supportsRemoteDesktop");
    return {schema: DESKTOP_CAPABILITY_SCHEMA, productVersion, bridgeSchemas: [DESKTOP_BRIDGE_SCHEMA], supportsRemoteDesktop: true};
}

/** 严格解析 Envelope 发给 Manager 的一行 Supervisor 请求。 */
export function parseDesktopSupervisorRequest(value: unknown): DesktopSupervisorRequest {
    const root = supervisorRoot(value, "Desktop Supervisor request");
    const requestId = nonEmptyString(root.requestId, "requestId");
    const type = member(root.type, ["start", "stop", "verify", "repair"] as const, "type");
    if (type === "start") {
        exactKeys(root, ["schema", "requestId", "type", "startupNonce", "port"], "Desktop Supervisor start request");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, startupNonce: nonce(root.startupNonce), port: supervisorPort(root.port)};
    }
    exactKeys(root, ["schema", "requestId", "type"], `Desktop Supervisor ${type} request`);
    return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type};
}

/** 严格解析 Manager 发给 Envelope 的一行 Supervisor 事件。 */
export function parseDesktopSupervisorEvent(value: unknown): DesktopSupervisorEvent {
    const root = supervisorRoot(value, "Desktop Supervisor event");
    const requestId = nonEmptyString(root.requestId, "requestId");
    const type = member(root.type, ["stage", "ready", "verified", "stopped", "failure", "logs"] as const, "type");
    if (type === "stage") {
        exactKeys(root, ["schema", "requestId", "type", "stage"], "Desktop Supervisor stage event");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, stage: member(root.stage, ["full-verify", "migration", "starting-product", "waiting-ready", "stopping-product", "repairing"] as const, "stage")};
    }
    if (type === "ready") {
        exactKeys(root, ["schema", "requestId", "type", "url", "origin", "version", "startupNonce"], "Desktop Supervisor ready event");
        const url = loopbackUrl(root.url, "url");
        const origin = loopbackOrigin(root.origin, "origin");
        if (new URL(url).origin !== origin) throw new Error("Desktop Supervisor ready URL 与 origin 不一致。");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, url, origin, version: nonEmptyString(root.version, "version"), startupNonce: nonce(root.startupNonce)};
    }
    if (type === "verified") {
        exactKeys(root, ["schema", "requestId", "type", "verification"], "Desktop Supervisor verified event");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, verification: member(root.verification, ["quick", "full"] as const, "verification")};
    }
    if (type === "stopped") {
        exactKeys(root, ["schema", "requestId", "type", "shutdown"], "Desktop Supervisor stopped event");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, shutdown: member(root.shutdown, ["graceful", "forced"] as const, "shutdown")};
    }
    if (type === "failure") {
        exactKeys(root, ["schema", "requestId", "type", "code", "message", "recoverable"], "Desktop Supervisor failure event");
        return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, code: nonEmptyString(root.code, "code"), message: nonEmptyString(root.message, "message"), recoverable: boolean(root.recoverable, "recoverable")};
    }
    exactKeys(root, ["schema", "requestId", "type", "path"], "Desktop Supervisor logs event");
    return {schema: DESKTOP_SUPERVISOR_SCHEMA, requestId, type, path: nonEmptyString(root.path, "path")};
}

/** 将协议对象编码成一行 NDJSON，拒绝换行注入。 */
export function desktopSupervisorLine(value: DesktopSupervisorRequest | DesktopSupervisorEvent): string {
    const line = JSON.stringify(value);
    if (line.includes("\n") || line.includes("\r")) throw new Error("Desktop Supervisor NDJSON 不能包含原始换行。");
    return `${line}\n`;
}

/** 校验并返回 Installation Root 内的可迁移相对路径。 */
export function desktopRelativePath(value: string, label = "Desktop relative path"): string {
    const portable = value.replaceAll("\\", "/");
    const segments = portable.split("/");
    const absolute = portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable);
    if (!portable || portable !== value || absolute
        || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`${label} 必须是无逃逸的 portable 相对路径。`);
    }
    return portable;
}

function parseDistributionComponent(value: unknown, index: number): DesktopDistributionComponent {
    const label = `components[${String(index)}]`;
    const root = object(value, label);
    exactKeys(root, ["id", "version", "archive", "required"], label);
    const archive = object(root.archive, `${label}.archive`);
    exactKeys(archive, ["kind", "location", "sha256", "bytes", "format"], `${label}.archive`);
    const kind = member(archive.kind, ["path", "url"] as const, `${label}.archive.kind`);
    const location = kind === "path"
        ? desktopRelativePath(nonEmptyString(archive.location, `${label}.archive.location`), `${label}.archive.location`)
        : httpsUrl(archive.location, `${label}.archive.location`);
    return {
        id: member(root.id, DESKTOP_COMPONENT_IDS, `${label}.id`),
        version: nonEmptyString(root.version, `${label}.version`),
        archive: {
            kind,
            location,
            sha256: sha256(archive.sha256, `${label}.archive.sha256`),
            bytes: nonNegativeInteger(archive.bytes, `${label}.archive.bytes`),
            format: member(archive.format, ["zip", "file"] as const, `${label}.archive.format`),
        },
        required: boolean(root.required, `${label}.required`),
    };
}

function parseInstalledComponent(value: unknown, index: number): DesktopInstalledComponent {
    const label = `components[${String(index)}]`;
    const root = object(value, label);
    exactKeys(root, ["id", "version", "path", "sha256"], label);
    return {
        id: member(root.id, DESKTOP_COMPONENT_IDS, `${label}.id`),
        version: nonEmptyString(root.version, `${label}.version`),
        path: desktopRelativePath(nonEmptyString(root.path, `${label}.path`), `${label}.path`),
        sha256: sha256(root.sha256, `${label}.sha256`),
    };
}

function parseDesktopInstallationProviders(value: unknown): DesktopInstallationProviders {
    const root = object(value, "providers");
    exactKeys(root, ["managerRuntime", "applicationRuntime", "tools"], "providers");
    const tools = object(root.tools, "providers.tools");
    exactKeys(tools, ["rg", "git"], "providers.tools");
    return {
        managerRuntime: parseProviderLocator(root.managerRuntime, "providers.managerRuntime"),
        applicationRuntime: parseProviderLocator(root.applicationRuntime, "providers.applicationRuntime"),
        tools: {
            rg: parseToolProviderLocator(tools.rg, "providers.tools.rg"),
            git: parseToolProviderLocator(tools.git, "providers.tools.git"),
        },
    };
}

function parseProviderLocator(value: unknown, label: string): DesktopProviderLocator {
    const root = object(value, label);
    if (root.provider === "managed") {
        exactKeys(root, ["provider", "version", "path", "sha256"], label);
        return {
            provider: "managed",
            version: nonEmptyString(root.version, `${label}.version`),
            path: desktopRelativePath(nonEmptyString(root.path, `${label}.path`), `${label}.path`),
            sha256: sha256(root.sha256, `${label}.sha256`),
        };
    }
    if (root.provider === "system") {
        exactKeys(root, ["provider", "version", "executable"], label);
        return {
            provider: "system",
            version: nonEmptyString(root.version, `${label}.version`),
            executable: commandName(root.executable, `${label}.executable`),
        };
    }
    throw new Error(`${label}.provider 不受支持。`);
}

function parseToolProviderLocator(value: unknown, label: string): DesktopToolProviderLocator {
    const root = object(value, label);
    if (root.provider === "managed") {
        const hasBashPath = Object.prototype.hasOwnProperty.call(root, "bashPath");
        exactKeys(root, [
            "provider",
            "version",
            "path",
            "sha256",
            ...(hasBashPath ? ["bashPath"] : []),
        ], label);
        const bashPath = !hasBashPath || root.bashPath === undefined
            ? undefined
            : desktopRelativePath(nonEmptyString(root.bashPath, `${label}.bashPath`), `${label}.bashPath`);
        return {
            provider: "managed",
            version: nonEmptyString(root.version, `${label}.version`),
            path: desktopRelativePath(nonEmptyString(root.path, `${label}.path`), `${label}.path`),
            sha256: sha256(root.sha256, `${label}.sha256`),
            ...(bashPath ? {bashPath} : {}),
        };
    }
    if (root.provider === "system") {
        const hasBashExecutable = Object.prototype.hasOwnProperty.call(root, "bashExecutable");
        exactKeys(root, [
            "provider",
            "version",
            "executable",
            ...(hasBashExecutable ? ["bashExecutable"] : []),
        ], label);
        const bashExecutable = !hasBashExecutable || root.bashExecutable === undefined
            ? undefined
            : commandName(root.bashExecutable, `${label}.bashExecutable`);
        return {
            provider: "system",
            version: nonEmptyString(root.version, `${label}.version`),
            executable: commandName(root.executable, `${label}.executable`),
            ...(bashExecutable ? {bashExecutable} : {}),
        };
    }
    throw new Error(`${label}.provider 不受支持。`);
}

function commandName(value: unknown, label: string): string {
    const result = nonEmptyString(value, label);
    if (result.includes("/") || result.includes("\\") || result.includes(":")) {
        throw new Error(`${label} 必须是系统命令名，不能持久化绝对路径。`);
    }
    return result;
}

function parseDesktopComponentReceipt(value: unknown, index: number): DesktopComponentReceipt {
    const label = `receipts[${String(index)}]`;
    const root = object(value, label);
    exactKeys(root, ["id", "version", "path", "sha256", "source"], label);
    return {
        id: member(root.id, DESKTOP_COMPONENT_IDS, `${label}.id`),
        version: nonEmptyString(root.version, `${label}.version`),
        path: desktopRelativePath(nonEmptyString(root.path, `${label}.path`), `${label}.path`),
        sha256: sha256(root.sha256, `${label}.sha256`),
        source: member(root.source, ["depot", "network", "managed"] as const, `${label}.source`),
    };
}

function parseDesktopInstallationUserRoots(value: unknown): DesktopInstallationUserRoots {
    const root = object(value, "userRoots");
    exactKeys(root, ["state", "cache", "desktop", "webview"], "userRoots");
    type UserBase = "local-app-data" | "user-app-data" | "user-cache";
    const parseRoot = (
        input: unknown,
        label: string,
        bases: readonly UserBase[],
    ): {base: UserBase; path: string} => {
        const item = object(input, label);
        exactKeys(item, ["base", "path"], label);
        const base = member(item.base, bases, `${label}.base`);
        const path = nonEmptyString(item.path, `${label}.path`);
        if (path.startsWith("/") || path.startsWith("\\") || path.includes(":") || path.split(/[\\/]/u).some((segment) => !segment || segment === "." || segment === "..")) {
            throw new Error(`${label}.path 必须是无逃逸的用户目录相对路径。`);
        }
        return {base, path: path.replaceAll("\\", "/")};
    };
    return {
        state: parseRoot(root.state, "userRoots.state", ["local-app-data", "user-app-data"]) as DesktopInstallationUserRoots["state"],
        cache: parseRoot(root.cache, "userRoots.cache", ["local-app-data", "user-cache"]) as DesktopInstallationUserRoots["cache"],
        desktop: parseRoot(root.desktop, "userRoots.desktop", ["local-app-data", "user-app-data"]) as DesktopInstallationUserRoots["desktop"],
        webview: parseRoot(root.webview, "userRoots.webview", ["local-app-data", "user-app-data"]) as DesktopInstallationUserRoots["webview"],
    };
}

function parseDesktopUninstallPolicy(value: unknown): DesktopUninstallPolicy {
    const root = object(value, "uninstall");
    exactKeys(root, ["preserveStateRootByDefault", "deleteStateRootRequiresExplicit", "preserveExternalProjectWorkspace"], "uninstall");
    literal(root.preserveStateRootByDefault, true, "uninstall.preserveStateRootByDefault");
    literal(root.deleteStateRootRequiresExplicit, true, "uninstall.deleteStateRootRequiresExplicit");
    literal(root.preserveExternalProjectWorkspace, true, "uninstall.preserveExternalProjectWorkspace");
    return {
        preserveStateRootByDefault: true,
        deleteStateRootRequiresExplicit: true,
        preserveExternalProjectWorkspace: true,
    };
}

function parseConnection(value: unknown): DesktopConnection {
    const root = object(value, "connection");
    const mode = member(root.mode, ["local", "remote"] as const, "connection.mode");
    if (mode === "local") {
        exactKeys(root, ["mode"], "connection");
        return {mode};
    }
    const hasHttpAcknowledgement = Object.prototype.hasOwnProperty.call(root, "insecureHttpAccepted");
    exactKeys(root, hasHttpAcknowledgement ? ["mode", "baseUrl", "insecureHttpAccepted"] : ["mode", "baseUrl"], "connection");
    const insecureHttpAccepted = hasHttpAcknowledgement
        ? boolean(root.insecureHttpAccepted, "connection.insecureHttpAccepted")
        : false;
    const baseUrl = desktopRemoteOrigin(root.baseUrl, insecureHttpAccepted);
    return {mode, baseUrl, insecureHttpAccepted};
}

/** 校验并规范化 Desktop Remote origin；HTTP 必须由调用方显式确认。 */
export function desktopRemoteOrigin(value: unknown, insecureHttpAccepted = false): string {
    const origin = remoteBaseUrl(value);
    if (new URL(origin).protocol === "http:" && !insecureHttpAccepted) {
        throw new Error("局域网 HTTP 远端必须记录二次确认。");
    }
    return origin;
}

function supervisorRoot(value: unknown, label: string): JsonObject {
    const root = object(value, label);
    literal(root.schema, DESKTOP_SUPERVISOR_SCHEMA, `${label}.schema`);
    return root;
}

function remoteBaseUrl(value: unknown): string {
    const text = nonEmptyString(value, "connection.baseUrl");
    const url = new URL(text);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || isPrivateIpv4(url.hostname)))) {
        throw new Error("远端地址必须使用 HTTPS；HTTP 只允许 loopback 或私有 IPv4。");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("远端地址只能包含 origin，不能携带凭据、路径、query 或 hash。");
    }
    return url.origin;
}

function loopbackUrl(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    const url = new URL(text);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error(`${label} 必须是带动态端口的 127.0.0.1 HTTP URL。`);
    return url.href;
}

function loopbackOrigin(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    const url = new URL(text);
    if (url.href !== `${url.origin}/` || url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error(`${label} 必须是 127.0.0.1 origin。`);
    return url.origin;
}

function httpsUrl(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${label} 必须是无凭据的 HTTPS URL。`);
    return url.href;
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31;
}

function nonce(value: unknown): string {
    const text = nonEmptyString(value, "startupNonce");
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(text)) throw new Error("startupNonce 格式非法。");
    return text;
}

function supervisorPort(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535) {
        throw new Error("Desktop Supervisor port 必须是 1024-65535 的整数。");
    }
    return value;
}

function sha256(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    if (!/^sha256:[a-f0-9]{64}$/u.test(text)) throw new Error(`${label} 必须是小写 sha256 digest。`);
    return text;
}

function isoDate(value: unknown, label: string): string {
    const text = nonEmptyString(value, label);
    if (new Date(text).toISOString() !== text) throw new Error(`${label} 必须是规范 ISO 时间。`);
    return text;
}

function nonEmptyString(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error(`${label} 必须是非空且不含 NUL 的字符串。`);
    return value;
}

function number(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字。`);
    return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负安全整数。`);
    return value;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") throw new Error(`${label} 必须是 boolean。`);
    return value;
}

function literal<const T extends string | boolean>(value: unknown, expected: T, label: string): T {
    if (value !== expected) throw new Error(`${label} 必须是 ${String(expected)}。`);
    return expected;
}

function member<const T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
    if (typeof value !== "string" || !values.includes(value)) throw new Error(`${label} 不受支持：${String(value)}`);
    return value as T[number];
}

function assertUnique(values: string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`${label} 不能包含重复 ID。`);
}

/** 仅用于把外部 JSON 收窄；unknown 字段永远不会流入业务对象。 */
type JsonObject = {[key: string]: unknown};

function object(value: unknown, label: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
    return value as JsonObject;
}

function exactKeys(record: JsonObject, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} 字段不匹配：expected=${wanted.join(",")} actual=${actual.join(",")}`);
}
