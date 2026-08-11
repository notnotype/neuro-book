import {homedir} from "node:os";
import {basename, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import * as p from "@clack/prompts";
import {Command} from "commander";

import {createAdmin} from "#manager/app-commands";
import {mutateInstallation} from "#manager/installation-mutation";
import {runInstallGuide} from "#manager/install-guide";
import {assertInstallConsent, inspectInstallEnvironment, inspectInstallPreflight, recommendedInstallProfile} from "#manager/install-preflight";
import {installPlan, installWithPreflight} from "#manager/installer";
import {configuredDiscoveryRoots, discoverInstances, inspectInstance} from "#manager/instance-discovery";
import {importInstallation, inspectImport} from "#manager/instance-import";
import {
    addDiscoveryRoot,
    findManagerInstance,
    forgetManagerInstance,
    managerConfigPath,
    readManagerConfig,
    removeDiscoveryRoot,
    registerManagerInstance,
    setDefaultManagerInstance,
} from "#manager/manager-config";
import {doctor, installationStatus, maintainRuntime, maintainTool} from "#manager/maintenance";
import {startInstallationApplication} from "#manager/migration-operation";
import {readInstallationManifest} from "#manager/manifest-store";
import {discoverInstallationRoot, installationPaths} from "#manager/paths";
import {formatCliError} from "#manager/error-message";
import {parseProfile, profileNames} from "#manager/profiles";
import {runManagerTui} from "#manager/tui";
import {adoptSourceInstallation, assertAdoptionPreflight, inspectAdoptionPreflight} from "#manager/source-adoption";
import type {InstallProfile, InstallationManifest, OfflineInspection, ReleaseChannel} from "#manager/types";
import {resetDesktopLocalState, uninstallInstallation} from "#manager/uninstaller";
import {repairDesktopInstallation, runDesktopSupervisor} from "#manager/desktop-supervisor";
import {defaultDesktopInstallationRoot, inferWindowsDesktopInstallationScope, installDesktopFromLocalDepot, readDesktopInstallationManifest, removeWindowsDesktopRegistration, uninstallRemoteDesktopInstallation} from "#manager/desktop-installation";
import {
    configureDesktopProvider,
    DESKTOP_PROVIDER_INPUT_MAX_BYTES,
    parseDesktopProviderInput,
    testDesktopProvider,
} from "#manager/desktop-provider";
import {runDesktopUacBroker} from "#manager/desktop-uac-broker";
import {runDesktopUacClient} from "nbook/desktop/shared/src/desktop-uac-client";
import {updateInstallation} from "#manager/updater";
import {inspectUpdatePreflight} from "#manager/update-preflight";
import {MANAGER_VERSION} from "#manager/version-info";

const managerExecutable = fileURLToPath(import.meta.url);
const program = new Command()
    .name("neuro-book")
    .version(MANAGER_VERSION)
    .description("NeuroBook installation, runtime, toolchain and instance manager.")
    .enablePositionalOptions()
    .option("--root <path>", "指定命令操作的 NeuroBook Installation Root。")
    .option("--instance <name-or-id>", "指定用户级配置中注册的实例。")
    .showHelpAfterError();

program.command("install")
    .description("安装或接管 NeuroBook Installation Root；交互终端默认进入完整引导。")
    .option("--profile <profile>", `安装 Profile：${profileNames().join(", ")}`)
    .option("--dir <path>", "Installation Root。")
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--release-manifest <path-or-url>", "使用本地路径或HTTPS候选Release Manifest；与--version互斥。")
    .option("--channel <channel>", "Release channel：stable 或 canary。", parseChannel)
    .option("--port <port>", "Web 端口。", parsePort)
    .option("--auth <mode>", "密码保护：enabled 或 disabled。Windows Portable 默认 disabled，其他 Profile 默认 enabled。", parseAuth)
    .option("--yes", "使用默认值，不进入交互。", false)
    .option("--dry-run", "只打印操作计划。", false)
    .option("--json", "与--dry-run一起输出结构化预检和操作计划。", false)
    .action(async (options: {
        profile?: string;
        dir?: string;
        version?: string;
        releaseManifest?: string;
        channel?: ReleaseChannel;
        port?: number;
        auth?: boolean;
        yes: boolean;
        dryRun: boolean;
        json: boolean;
    }) => {
        if (options.version && options.releaseManifest) throw new Error("--version 与 --release-manifest 不能同时使用。" );
        if (options.json && !options.dryRun) throw new Error("--json当前只与--dry-run一起使用。" );
        if (!options.dryRun) assertInstallConsent(options.yes);
        if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
            await runInstallGuide({
                profile: options.profile ? parseProfile(options.profile) : undefined,
                root: options.dir,
                version: options.version,
                releaseManifest: options.releaseManifest,
                channel: options.channel,
                port: options.port,
                authEnabled: options.auth,
                dryRun: options.dryRun,
                managerExecutable,
            });
            return;
        }
        const managerConfig = await readManagerConfig();
        let environment = await inspectInstallEnvironment(options.profile ? parseProfile(options.profile) : undefined);
        const profile = options.profile ? parseProfile(options.profile) : recommendedInstallProfile(environment);
        environment = await inspectInstallEnvironment(profile, environment);
        const input = {
            root: resolve(options.dir ?? managerConfig.preferences.installDirectory ?? join(homedir(), "neuro-book")),
            profile,
            channel: options.channel ?? managerConfig.preferences.channel,
            version: options.version,
            releaseManifest: options.releaseManifest,
            port: options.port ?? 3000,
            authEnabled: options.auth ?? profile !== "windows-portable",
            dryRun: options.dryRun,
            managerExecutable,
        };
        const preflight = await inspectInstallPreflight(input, environment);
        if (input.dryRun) {
            const output = {preflight: preflight.report, plan: installPlan(input)};
            if (options.json) printJson(output);
            else printObject(output);
            return;
        }
        p.intro("NeuroBook Manager");
        const manifest = await installWithPreflight(input, preflight);
        await registerManagerInstance({
            root: input.root,
            name: basename(input.root) || "NeuroBook",
            makeDefault: true,
            preferences: {channel: input.channel, installDirectory: input.root},
        });
        p.outro(`安装完成：${input.root}\nProfile: ${manifest.profile}\nVersion: ${manifest.appVersion}\n管理实例：neuro-book manage`);
    });

program.command("manage")
    .description("打开 blessed TUI，管理所有已注册 NeuroBook 实例。")
    .action(async () => runManagerTui(managerExecutable));

const instances = program.command("instances").description("管理用户级实例索引。配置默认位于 ~/.neuro-book-manager/config.json。");
instances.command("list")
    .description("列出已注册实例。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const config = await readManagerConfig();
        if (options.json) {
            printJson(config);
            return;
        }
        console.log(`配置：${managerConfigPath()}`);
        if (!config.instances.length) {
            console.log("尚未注册实例。运行 neuro-book 或 neuro-book install 开始安装。" );
            return;
        }
        for (const instance of config.instances) {
            const marker = instance.id === config.defaultInstanceId ? "*" : " ";
            console.log(`${marker} ${instance.name}\n  ${instance.root}\n  id: ${instance.id}`);
        }
    });
const importCommand = async (path: string, options: {name?: string; default: boolean; yes?: boolean; json?: boolean}): Promise<void> => {
    const result = await importInstallation({root: path, name: options.name, makeDefault: options.default, acceptWarnings: options.yes});
    if (options.json) printJson(result);
    else console.log(`已导入：${result.instance.name} (${result.instance.root})`);
};
instances.command("add")
    .description("注册已有 Installation Root，不修改实例文件。")
    .argument("<path>")
    .option("--name <name>", "实例显示名称。")
    .option("--default", "设为默认实例。", false)
    .option("--yes", "接受离线检查warning。", false)
    .action(importCommand);
instances.command("import")
    .description("导入已有Manifest v5实例，不修改实例文件。")
    .argument("<path>")
    .option("--name <name>", "实例显示名称。")
    .option("--default", "设为默认实例。", false)
    .option("--yes", "接受离线检查warning。", false)
    .option("--json", "输出导入检查和结果。", false)
    .action(importCommand);
instances.command("inspect")
    .description("只读检查当前或指定目录。")
    .argument("[path]", "候选目录。", process.cwd())
    .option("--json", "输出JSON。", false)
    .action(async (path: string, options: {json: boolean}) => {
        const inspection = await inspectInstance(path);
        options.json ? printJson(inspection) : printInspection(inspection);
    });
instances.command("discover")
    .description("在有限搜索根内发现未登记实例。")
    .option("--root <paths...>", "本次搜索根。")
    .option("--json", "输出JSON。", false)
    .action(async (options: {root?: string[]; json: boolean}) => {
        const config = await readManagerConfig();
        const result = await discoverInstances(options.root ?? configuredDiscoveryRoots(config), config.instances.map((instance) => instance.root));
        if (options.json) printJson(result);
        else {
            if (!result.candidates.length) console.log("没有发现未登记的NeuroBook实例。");
            for (const candidate of result.candidates) printInspection(candidate);
            for (const warning of result.warnings) console.warn(`警告：${warning.message}`);
        }
    });
const instanceRoots = instances.command("roots").description("管理有限实例搜索根。");
instanceRoots.command("list").action(async () => {
    const config = await readManagerConfig();
    const roots = configuredDiscoveryRoots(config);
    if (!roots.length) console.log("自动发现已关闭。");
    else for (const root of roots) console.log(root);
});
instanceRoots.command("add").argument("<path>").action(async (path: string) => {
    const config = await addDiscoveryRoot(path);
    console.log(`已增加搜索根：${resolve(path)}\n共${configuredDiscoveryRoots(config).length}个搜索根。`);
});
instanceRoots.command("remove").argument("<path>").action(async (path: string) => {
    await removeDiscoveryRoot(path);
    console.log(`已删除搜索根：${resolve(path)}`);
});
instances.command("forget")
    .description("从用户级索引忘记实例，不删除 Installation Root。")
    .argument("<name-or-id>")
    .action(async (reference: string) => {
        await forgetManagerInstance(reference);
        console.log(`已忘记实例：${reference}`);
    });
instances.command("default")
    .description("设置默认实例。")
    .argument("<name-or-id>")
    .action(async (reference: string) => {
        const instance = await setDefaultManagerInstance(reference);
        console.log(`默认实例：${instance.name} (${instance.root})`);
    });
instances.command("config")
    .description("显示用户级 Manager 配置路径。")
    .action(() => console.log(managerConfigPath()));

program.command("adopt")
    .description("接管没有Manifest的NeuroBook Git checkout。")
    .argument("[path]", "Git checkout。", process.cwd())
    .option("--profile <profile>", "source-dev、source-product或source-docker。")
    .option("--port <port>", "Web端口。", parsePort)
    .option("--auth <mode>", "密码保护：enabled或disabled。", parseAuth)
    .option("--yes", "使用默认值，不进入交互。", false)
    .option("--dry-run", "只输出接管计划。", false)
    .action(async (path: string, options: {profile?: string; port?: number; auth?: boolean; yes: boolean; dryRun: boolean}) => {
        if (!options.dryRun) assertInstallConsent(options.yes);
        let profile = options.profile ? parseAdoptProfile(options.profile) : "source-dev" as const;
        if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
            profile = await promptResult(p.select({message: "选择接管后的运行方式", initialValue: profile, options: [
                {value: "source-dev" as const, label: "Source Dev", hint: "保留源码；现有不可信.output不纳入管理"},
                {value: "source-product" as const, label: "Source Product", hint: "从当前revision事务重建Product"},
                {value: "source-docker" as const, label: "Source Docker", hint: "容器内构建明确revision镜像"},
            ]}));
        }
        const config = await readManagerConfig();
        const preflight = await inspectAdoptionPreflight({root: path, profile, port: options.port ?? 3000});
        assertAdoptionPreflight(preflight);
        const inspection = preflight.inspection;
        if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
            const confirmed = await promptResult(p.confirm({message: `接管${inspection.root}为${profile}？`, initialValue: true}));
            if (!confirmed) { p.cancel("已取消接管，没有修改目录。" ); return; }
        }
        const adoptedInput = {root: inspection.root, profile, channel: config.preferences.channel, port: options.port ?? 3000, authEnabled: options.auth ?? true, dryRun: options.dryRun, managerExecutable};
        if (options.dryRun) { printJson({preflight: preflight.report, plan: installPlan(adoptedInput)}); return; }
        const {manifest} = await adoptSourceInstallation(adoptedInput, preflight);
        p.outro(`接管完成：${inspection.root}\nProfile: ${manifest.profile}\nVersion: ${manifest.appVersion}`);
    });

program.command("update")
    .description("事务更新当前或指定安装。")
    .option("--version <version>", "指定 NeuroBook Release 版本。")
    .option("--release-manifest <path-or-url>", "使用本地路径或HTTPS候选Release Manifest；与--version互斥。")
    .option("--channel <channel>", "切换 Release channel。", parseChannel)
    .option("--dry-run", "只打印更新目标。", false)
    .action(async (options: {version?: string; releaseManifest?: string; channel?: ReleaseChannel; dryRun: boolean}) => {
        if (options.version && options.releaseManifest) throw new Error("--version 与 --release-manifest 不能同时使用。" );
        const {root, manifest} = await currentInstallation();
        if (options.dryRun) {
            printJson(await inspectUpdatePreflight({
                root,
                manifest,
                version: options.version,
                releaseManifest: options.releaseManifest,
                channel: options.channel,
                managerExecutable,
            }));
            return;
        }
        const result = await updateInstallation({
            root,
            manifest,
            version: options.version,
            releaseManifest: options.releaseManifest,
            channel: options.channel,
            managerExecutable,
        });
        p.outro(result.changed
            ? `更新完成：${result.manifest.appVersion}`
            : `已是最新版本：${result.manifest.appVersion}`);
    });

program.command("start")
    .description("启动当前或指定安装。")
    .option("--no-health-check", "Windows Portable跳过HTTP健康检查和自动打开浏览器。")
    .option("--shutdown-on-stdin-end", "标准输入关闭时完整收口Product；供桌面宿主和自动验收使用。", false)
    .action(async (options: {healthCheck: boolean; shutdownOnStdinEnd: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const controller = options.shutdownOnStdinEnd ? new AbortController() : null;
        const shutdown = (): void => controller?.abort();
        if (controller) {
            process.stdin.once("end", shutdown);
            process.stdin.once("error", shutdown);
            process.stdin.resume();
            if (process.stdin.readableEnded || process.stdin.destroyed) controller.abort();
        }
        try {
            await startInstallationApplication(root, {
                healthCheck: options.healthCheck,
                ...(controller ? {shutdownSignal: controller.signal} : {}),
            });
        } finally {
            process.stdin.removeListener("end", shutdown);
            process.stdin.removeListener("error", shutdown);
            if (controller) process.stdin.pause();
        }
    });

program.command("status")
    .description("查看安装状态。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const status = await installationStatus(root, manifest);
        options.json ? printJson(status) : printObject(status);
    });

program.command("doctor")
    .description("诊断安装目录、Product 与外部命令。")
    .option("--json", "输出 JSON。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const result = await doctor(root, manifest);
        options.json ? printJson(result) : printObject(result);
    });

program.command("uninstall")
    .description("卸载当前或指定安装；默认保留 State Root 用户数据。")
    .option("--delete-data", "同时删除托管 State Root；外部 Project Workspace 永不删除。", false)
    .option("--json", "输出单行 NDJSON 完成回执。", false)
    .option("--yes", "确认执行卸载。", false)
    .action(async (options: {deleteData: boolean; json: boolean; yes: boolean}) => {
        const {root, manifest} = await currentInstallation();
        if (!options.yes) {
            if (!process.stdin.isTTY || !process.stdout.isTTY) {
                throw new Error("卸载需要 --yes；同时删除托管用户数据还需显式传入 --delete-data。");
            }
            const label = options.deleteData
                ? "卸载应用并删除托管用户数据？外部 Project Workspace 不受影响。"
                : "卸载应用？State Root 用户数据会保留，Cache、Desktop/WebView 和日志会删除。";
            const confirmed = await promptResult(p.confirm({message: label, initialValue: false}));
            if (!confirmed) {
                p.cancel("已取消卸载。" );
                return;
            }
        }
        const desktopManifest = process.platform === "win32"
            ? await readDesktopInstallationManifest(root, manifest.roots)
            : null;
        const legacyDesktopScope = process.platform === "win32" && desktopManifest === null
            ? await inferWindowsDesktopInstallationScope(root)
            : null;
        const result = await uninstallInstallation({
            installationRoot: root,
            deleteData: options.deleteData,
        });
        if (desktopManifest) await removeWindowsDesktopRegistration(root, desktopManifest);
        else if (legacyDesktopScope) await removeWindowsDesktopRegistration(root, legacyDesktopScope);
        const config = await readManagerConfig();
        const instance = findManagerInstance(config, root);
        if (instance) await forgetManagerInstance(instance.id);
        if (result.status === "scheduled") {
            if (options.json) {
                printNdjson({
                    kind: "complete",
                    action: "uninstall",
                    status: result.status,
                    installationRoot: result.installationRoot,
                    stateRoot: result.stateRoot,
                    statePreserved: result.statePreserved,
                    resultPath: result.resultPath,
                });
                return;
            }
            p.outro(result.statePreserved
                ? `卸载已安排；当前命令退出后删除程序，用户数据保留在：${result.stateRoot}\n结果记录：${result.resultPath}`
                : `卸载已安排；当前命令退出后删除程序和托管用户数据。\n结果记录：${result.resultPath}`);
            return;
        }
        if (options.json) {
            printNdjson({
                kind: "complete",
                action: "uninstall",
                status: result.status,
                installationRoot: result.installationRoot,
                stateRoot: result.stateRoot,
                statePreserved: result.statePreserved,
            });
            return;
        }
        p.outro(result.statePreserved
            ? `卸载完成；用户数据保留在：${result.stateRoot}`
            : "卸载完成；托管用户数据已删除。" );
    });

const desktop = program.command("desktop").description("管理 Desktop Local/WebView 状态。");
desktop.command("install")
    .description("从本地 Product Portable 或独立 shell depot 安装 Windows 用户级 Desktop；下载与更新由 Manager 托管。")
    .option("--archive <path>", "本地模式使用的 Electron/Tauri Portable ZIP；必须来自已验证的本地 depot。")
    .option("--depot <path>", "本地模式使用的 Electron 聚合 Depot ZIP；必须带同目录 sidecar。")
    .option("--shell-archive <path>", "远端模式使用的独立 Desktop Envelope ZIP；不得包含 Product、Bun 或 Tool Pack。")
    .option("--distribution-manifest <path>", "使用本地 Desktop Distribution Manifest；组件 ZIP 必须位于 manifest 根目录内。")
    .option("--distribution-manifest-url <url>", "从 HTTPS 下载 Desktop Distribution Manifest；组件摘要仍由 Manager 校验。")
    .option("--envelope <envelope>", "桌面壳：electron 或 tauri。", "electron")
    .option("--channel <channel>", "发行通道：stable 或 canary。", parseChannel)
    .option("--remote <url>", "连接远端 Product；不传则使用本机 Product。")
    .option("--allow-insecure-http", "允许局域网 HTTP 远端；安装后状态仍标记为不安全。", false)
    .option("--scope <scope>", "安装范围：user（当前用户，默认）或 machine（Program Files，需要管理员权限）。", "user")
    .option("--dir <path>", "Installation Root；未指定时按 scope 选择默认目录。")
    .option("--runtime-provider <provider>", "Runtime provider：managed 或 system。", "managed")
    .option("--git-provider <provider>", "Git/Bash provider：managed 或 system。", "managed")
    .option("--rg-provider <provider>", "ripgrep provider：managed 或 system。", "managed")
    .option("--add-cli-to-path", "把 Manager CLI 加入当前用户 PATH。", false)
    .option("--enable-auth", "安装后启用本地 Product 鉴权，并通过密码创建管理员。", false)
    .option("--password-stdin", "从 stdin 读取本地 Product 首次管理员密码；保持原始 UTF-8 字节，不 trim。", false)
    .option("--json", "以 NDJSON 输出阶段和完成回执，供 Manager GUI 使用。", false)
    .option("--yes", "跳过交互确认。", false)
    .action(async (options: {
        archive?: string;
        depot?: string;
        shellArchive?: string;
        distributionManifest?: string;
        distributionManifestUrl?: string;
        envelope: string;
        channel?: ReleaseChannel;
        remote?: string;
        allowInsecureHttp: boolean;
        scope: string;
        dir?: string;
        runtimeProvider: string;
        gitProvider: string;
        rgProvider: string;
        addCliToPath: boolean;
        enableAuth: boolean;
        passwordStdin: boolean;
        json: boolean;
        yes: boolean;
    }) => {
        if (process.platform !== "win32") throw new Error("Desktop 用户级安装当前只支持 Windows；macOS 仅完成安装合同与 CI 准备。" );
        if (options.envelope !== "electron" && options.envelope !== "tauri") throw new Error(`不支持的 Desktop envelope：${options.envelope}`);
        if (!["managed", "system"].includes(options.runtimeProvider)
            || !["managed", "system"].includes(options.gitProvider)
            || !["managed", "system"].includes(options.rgProvider)) {
            throw new Error("Runtime/Git/rg provider 只支持 managed 或 system。" );
        }
        if (options.scope !== "user" && options.scope !== "machine") {
            throw new Error(`不支持的 Desktop 安装范围：${options.scope}`);
        }
        if (options.dir && resolve(options.dir) !== resolve(defaultDesktopInstallationRoot(options.scope as "user" | "machine"))) {
            throw new Error("Windows Installed v1 使用固定 Installation Root；请省略 --dir，或传入当前 scope 对应的 canonical 路径。" );
        }
        const remoteUrl = options.remote ? new URL(options.remote) : null;
        if (remoteUrl && options.passwordStdin) throw new Error("远端 Desktop 安装不能读取本地管理员密码。" );
        if (!remoteUrl && options.passwordStdin && !options.enableAuth) {
            throw new Error("--password-stdin 只有与 --enable-auth 一起使用时才会读取密码。");
        }
        const depotArguments = [options.archive, options.depot, options.shellArchive, options.distributionManifest, options.distributionManifestUrl].filter((value) => value !== undefined);
        if (depotArguments.length !== 1) {
            throw new Error("Desktop 安装必须且只能提供 --archive、--depot、--shell-archive、--distribution-manifest 或 --distribution-manifest-url 之一。" );
        }
        if (remoteUrl) {
            if (options.archive) throw new Error("远端 Desktop 安装不能使用完整 --archive。" );
            if (options.depot) throw new Error("远端 Desktop 安装不能使用本地 Product --depot。" );
            if (remoteUrl.protocol !== "https:" && !(remoteUrl.protocol === "http:" && options.allowInsecureHttp)) {
                throw new Error("远端 Desktop 默认要求 HTTPS；局域网 HTTP 必须显式传入 --allow-insecure-http。" );
            }
            if (remoteUrl.protocol === "http:" && !options.yes && process.stdin.isTTY && process.stdout.isTTY) {
                const confirmed = await promptResult(p.confirm({message: "HTTP 远端连接未加密，仍要继续？", initialValue: false}));
                if (!confirmed) { p.cancel("已取消 Desktop 安装。" ); return; }
            }
        }
        if (!remoteUrl && options.shellArchive) throw new Error("本地 Desktop 安装不能使用 --shell-archive。" );
        if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
            const confirmed = await promptResult(p.confirm({message: `安装 ${options.envelope} Desktop 到用户级目录？`, initialValue: true}));
            if (!confirmed) { p.cancel("已取消 Desktop 安装。" ); return; }
        }
        let adminPassword: string | undefined;
        // 远端 shell 没有 Product Installation Manifest，不能伪装成可执行的本地实例加入索引。
        if (!remoteUrl && options.enableAuth) {
            if (options.passwordStdin) {
                if (process.stdin.isTTY) throw new Error("--password-stdin 需要从管道读取密码，不能与交互 TTY 同时使用。" );
                adminPassword = await readPasswordStdin();
            } else if (!options.yes && process.stdin.isTTY && process.stdout.isTTY) {
                adminPassword = await promptResult(p.password({message: "设置 NeuroBook 管理员密码", mask: "*"}));
            }
            if (adminPassword === undefined) {
                throw new Error("--enable-auth 必须同时提供管理员密码；交互模式使用隐藏输入，自动化模式使用 --password-stdin。" );
            }
        }
        if (options.json) printNdjson({kind: "stage", stage: "validating-input"});
        const result = await installDesktopFromLocalDepot({
            ...(options.archive ? {archivePath: options.archive} : {}),
            ...(options.depot ? {aggregateDepotPath: options.depot} : {}),
            ...(options.shellArchive ? {shellArchivePath: options.shellArchive} : {}),
            ...(options.distributionManifest ? {distributionManifestPath: options.distributionManifest} : {}),
            ...(options.distributionManifestUrl ? {distributionManifestUrl: options.distributionManifestUrl} : {}),
            envelope: options.envelope,
            channel: options.channel ?? "canary",
            installationScope: options.scope as "user" | "machine",
            connection: remoteUrl
                ? {mode: "remote", baseUrl: remoteUrl.origin, insecureHttpAccepted: remoteUrl.protocol === "http:"}
                : {mode: "local"},
            installationRoot: options.dir,
            addCliToUserPath: options.addCliToPath,
            runtimeProvider: options.runtimeProvider as "managed" | "system",
            gitProvider: options.gitProvider as "managed" | "system",
            rgProvider: options.rgProvider as "managed" | "system",
            managerExecutable,
            ...(adminPassword !== undefined ? {adminPassword} : {}),
            ...(options.json ? {
                onStage: (stage) => printNdjson({kind: "stage", stage}),
            } : {}),
        });
        let managerRegistrationWarning: string | null = null;
        if (!remoteUrl) {
            try {
                await registerManagerInstance({
                    root: result.installationRoot,
                    name: "NeuroBook",
                    makeDefault: true,
                    preferences: {channel: result.manifest.channel, installDirectory: result.installationRoot},
                });
            } catch (error) {
                managerRegistrationWarning = error instanceof Error ? error.message : String(error);
                if (options.json) {
                    printNdjson({
                        kind: "warning",
                        code: "manager-instance-registration-failed",
                        message: managerRegistrationWarning,
                    });
                } else {
                    console.warn(`Desktop 已安装，但 Manager 实例索引未更新：${managerRegistrationWarning}`);
                }
            }
        }
        if (options.json) {
            printNdjson({
                kind: "complete",
                installationRoot: result.installationRoot,
                stateRoot: result.stateRoot,
                cacheRoot: result.cacheRoot,
                desktopRoot: result.desktopRoot,
                connection: result.manifest.connection.mode,
                installationScope: result.manifest.installationScope,
                remoteProductVersion: result.remoteProductVersion ?? null,
                applicationPreparation: result.applicationPreparation ?? null,
                managerRegistration: managerRegistrationWarning === null ? "registered" : "warning",
            });
        } else {
            p.outro(`Desktop 安装完成：${result.installationRoot}\nState Root：${result.stateRoot}\n连接：${result.manifest.connection.mode}${result.remoteProductVersion ? `\n远端 Product：${result.remoteProductVersion}` : ""}`);
        }
    });
desktop.command("broker")
    .description("Manager GUI 的 machine-scope UAC Broker；只接受一次受限安装、修复或卸载请求。")
    .requiredOption("--pipe <pipe>", "GUI 创建的一次性控制 named pipe。")
    .requiredOption("--nonce <nonce>", "GUI 创建的一次性连接 nonce。")
    .requiredOption("--operation-id <operationId>", "GUI 创建的一次性 operation ID。")
    .requiredOption("--action <action>", "提升动作：desktop-install、desktop-repair 或 uninstall。")
    .requiredOption("--installation-root <path>", "绑定本次操作的 canonical Installation Root。")
    .option("--installation-id <id>", "绑定已有 Desktop Installation Manifest 的 installationId。")
    .option("--manifest-sha256 <digest>", "绑定已有 Desktop Installation Manifest 的摘要。")
    .option("--delete-data", "绑定卸载是否删除 State Root。", false)
    .option("--secret-pipe <pipe>", "仅用于内存中的管理员密码字节，不传入控制 NDJSON。")
    .action(async (options: {
        pipe: string;
        nonce: string;
        operationId: string;
        action: "desktop-install" | "desktop-repair" | "uninstall";
        installationRoot: string;
        installationId?: string;
        manifestSha256?: string;
        deleteData: boolean;
        secretPipe?: string;
    }) => {
        if (!["desktop-install", "desktop-repair", "uninstall"].includes(options.action)) {
            throw new Error("Desktop UAC Broker action 不受支持。");
        }
        await runDesktopUacBroker({
            pipe: options.pipe,
            nonce: options.nonce,
            operationId: options.operationId,
            action: options.action,
            managerExecutable,
            installationRoot: options.installationRoot,
            installationId: options.installationId ?? null,
            manifestSha256: options.manifestSha256 ?? null,
            deleteData: options.deleteData,
            ...(options.secretPipe ? {secretPipe: options.secretPipe} : {}),
        });
    });
desktop.command("broker-client")
    .description("Programs and Features 的一次性 machine uninstall UAC client。")
    .requiredOption("--installation-root <path>", "绑定当前 machine Installation Root。")
    .requiredOption("--installation-id <id>", "绑定当前 Desktop Installation Manifest installationId。")
    .requiredOption("--manifest-sha256 <digest>", "绑定当前 Desktop Installation Manifest SHA-256。")
    .action(async (options: {
        installationRoot: string;
        installationId: string;
        manifestSha256: string;
    }) => {
        const installationRoot = resolve(options.installationRoot);
        const result = await runDesktopUacClient({
            bunPath: process.execPath,
            managerPath: managerExecutable,
            invocation: {
                action: "uninstall",
                args: ["--root", installationRoot, "uninstall", "--yes", "--json"],
            },
            binding: {
                installationId: options.installationId,
                installationRoot,
                manifestSha256: options.manifestSha256,
                deleteData: false,
            },
            onEvent: (event) => {
                if (event.kind === "json") {
                    printNdjson(event.value);
                } else if (event.kind === "log" || event.kind === "failure") {
                    printNdjson(event);
                }
            },
        });
        if (result.exitCode !== 0 || result.signal !== null) {
            throw new Error(`Programs and Features 卸载失败：exitCode=${result.exitCode ?? "null"}, signal=${result.signal ?? "null"}`);
        }
        printNdjson({kind: "complete", action: "machine-uninstall", exitCode: 0});
    });
desktop.command("supervise")
    .description("通过 stdin/stdout NDJSON 为 Desktop Envelope 编排 Product 生命周期。")
    .action(async () => {
        const {root, manifest} = await currentInstallation();
        await runDesktopSupervisor({root, manifest});
    });
desktop.command("repair")
    .description("复核 Product Runtime Image 并原子重建 Manager receipt。")
    .option("--json", "以单行 NDJSON 输出回执。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        if (options.json) printNdjson({kind: "stage", stage: "repairing"});
        await repairDesktopInstallation(root, manifest);
        if (options.json) printNdjson({kind: "complete", action: "repair"});
        else p.outro("Desktop Runtime receipt 已修复。");
    });
desktop.command("uninstall")
    .description("卸载只含远端 Envelope 的 Desktop；默认保留 State Root。")
    .requiredOption("--dir <path>", "远端 Desktop Installation Root。")
    .option("--delete-data", "同时删除托管 State Root。", false)
    .option("--yes", "跳过确认。", false)
    .action(async (options: {dir: string; deleteData: boolean; yes: boolean}) => {
        if (!options.yes) {
            if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("远端 Desktop 卸载需要 --yes。" );
            const confirmed = await promptResult(p.confirm({
                message: options.deleteData ? "卸载远端 Desktop 并删除托管用户数据？" : "卸载远端 Desktop？State Root 会保留。",
                initialValue: false,
            }));
            if (!confirmed) {
                p.cancel("已取消卸载。" );
                return;
            }
        }
        const result = await uninstallRemoteDesktopInstallation(options.dir, options.deleteData);
        p.outro(result.stateRoot && !options.deleteData
            ? `远端 Desktop 已卸载；State Root 保留在：${result.stateRoot}`
            : "远端 Desktop 与托管用户数据已卸载。" );
    });
desktop.command("reset")
    .description("删除当前实例的 Desktop Local Root，包括 WebView profile。")
    .option("--yes", "确认删除桌面本地状态。", false)
    .action(async (options: {yes: boolean}) => {
        const {root} = await currentInstallation();
        if (!options.yes) {
            if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("桌面重置需要 --yes。" );
            const confirmed = await promptResult(p.confirm({
                message: "删除桌面窗口设置和 WebView 本地 profile？Workspace 草稿已经独立存储，不会随之删除。",
                initialValue: false,
            }));
            if (!confirmed) {
                p.cancel("已取消桌面重置。" );
                return;
            }
        }
        const desktopRoot = await resetDesktopLocalState({
            installationRoot: root,
        });
        p.outro(`桌面本地状态已重置：${desktopRoot}`);
    });
desktop.command("configure-provider")
    .description("通过 stdin 写入一个自定义 Provider；API Key 不得出现在 argv 或环境变量。")
    .requiredOption("--stdin-json", "从 stdin 读取 Provider JSON。")
    .option("--json", "以单行 NDJSON 输出回执。", false)
    .action(async (options: {json: boolean}) => {
        const {root, manifest} = await currentInstallation();
        const value = await readDesktopProviderInput();
        const roots = installationPaths(root, manifest.roots);
        const result = await configureDesktopProvider(roots.state, {
            name: value.name ?? "",
            baseURL: value.baseURL ?? "",
            api: value.api ?? "",
            apiKey: value.apiKey ?? "",
            model: value.model ?? "",
            discoverModels: value.discoverModels,
        });
        if (options.json) printNdjson({kind: "provider-configured", providerId: result.providerId, modelKey: result.modelKey});
        else printJson({kind: "provider-configured", providerId: result.providerId, modelKey: result.modelKey});
    });
desktop.command("test-provider")
    .description("通过 stdin 测试自定义 Provider 的可达性；失败只显示警告，不阻止保存。")
    .requiredOption("--stdin-json", "从 stdin 读取 Provider JSON。")
    .option("--json", "以单行 NDJSON 输出回执。", false)
    .action(async (options: {json: boolean}) => {
        const result = await testDesktopProvider(await readDesktopProviderInput());
        const output = {kind: "provider-test", ...result};
        if (options.json) printNdjson(output);
        else printJson(output);
    });

const runtime = program.command("runtime").description("管理 Bun Runtime。");
runtime.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson({
        managerRuntime: manifest.components.managerRuntime,
        applicationRuntime: manifest.components.applicationRuntime,
    });
});
runtime.command("install")
    .argument("<runtime>", "当前只支持 bun。")
    .option("--version <version>")
    .action(async (runtimeName: string, options: {version?: string}) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root} = await currentInstallation();
        await maintainRuntime(root, managerExecutable, options.version);
    });
runtime.command("update")
    .argument("<runtime>", "当前只支持 bun。")
    .action(async (runtimeName: string) => {
        if (runtimeName !== "bun") throw new Error(`不支持的 Runtime：${runtimeName}`);
        const {root} = await currentInstallation();
        await maintainRuntime(root, managerExecutable);
    });

const tools = program.command("tools").description("管理 Agent 工具链。");
tools.command("list").action(async () => {
    const {manifest} = await currentInstallation();
    printJson(manifest.components.tools);
});
tools.command("install")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root} = await currentInstallation();
        await maintainTool(root, tool, managerExecutable);
    });
tools.command("update")
    .argument("[tool]", "rg 或 git；省略时更新全部 managed tools。")
    .action(async (tool?: string) => {
        const {root, manifest} = await currentInstallation();
        if (tool) {
            assertTool(tool);
            await maintainTool(root, tool, managerExecutable);
            return;
        }
        await maintainTool(root, "rg", managerExecutable);
        if (process.platform === "win32") await maintainTool(root, "git", managerExecutable);
    });
tools.command("path")
    .argument("<tool>", "rg 或 git。")
    .action(async (tool: string) => {
        assertTool(tool);
        const {root, manifest} = await currentInstallation();
        const component = manifest.components.tools[tool];
        if (!component || component.provider !== "managed") throw new Error(`${tool} 不是 managed tool。`);
        console.log(resolve(root, component.path));
    });

const admin = program.command("admin").description("管理员操作。");
admin.command("create")
    .argument("[username]")
    .action(async (username?: string) => {
        const {root} = await currentInstallation();
        await mutateInstallation(root, (mutation) => createAdmin(mutation.root, mutation.manifest, username));
    });

await main();

/** 处理无参数向导与 Commander 命令入口。 */
async function main(): Promise<void> {
    try {
        if (process.argv.slice(2).length === 0) {
            await runContextEntry();
            return;
        }
        await program.parseAsync(process.argv);
    } catch (error) {
        if (process.argv.includes("--json")) {
            printNdjson({
                kind: "failure",
                message: formatCliError(error),
                recoverable: true,
            });
        } else {
            p.log.error(formatCliError(error));
        }
        process.exitCode = 1;
    }
}

/** 无参数入口根据当前目录切换管理、接管和部署菜单。 */
async function runContextEntry(): Promise<void> {
    const inspection = await inspectInstance(process.cwd());
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        printJson({...inspection, nextCommand: inspection.kind === "managed-installation" ? "neuro-book manage" : inspection.kind === "neuro-book-checkout" ? `neuro-book adopt ${JSON.stringify(inspection.root)}` : inspection.kind === "invalid-installation" ? "重新安装当前实例；不要覆盖损坏目录" : "neuro-book install --profile <profile> --yes"});
        return;
    }
    if (inspection.kind === "managed-installation" && inspection.manifest) {
        p.intro("NeuroBook 实例管理");
        p.note(`目录：${inspection.root}\nProfile：${inspection.manifest.profile}\n版本：${inspection.manifest.appVersion}`, "当前实例");
        const action = await promptResult(p.select({message: "要执行什么操作？", options: [
            {value: "manage", label: "打开实例管理TUI"}, {value: "start", label: "启动当前实例"},
            {value: "status", label: "查看状态"}, {value: "doctor", label: "运行诊断"},
            {value: "update", label: "更新当前实例"}, {value: "admin", label: "创建管理员"},
            {value: "runtime", label: "查看Runtime"}, {value: "tools", label: "查看Tool"}, {value: "instances", label: "查看实例索引"},
        ]}));
        if (action === "manage") return runManagerTui(managerExecutable);
        if (action === "start") return startInstallationApplication(inspection.root);
        if (action === "status") return printObject(await installationStatus(inspection.root, inspection.manifest));
        if (action === "doctor") return printObject(await doctor(inspection.root, inspection.manifest));
        if (action === "update") {
            const result = await updateInstallation({root: inspection.root, manifest: inspection.manifest, managerExecutable});
            p.outro(result.changed ? `更新完成：${result.manifest.appVersion}` : `已是最新版本：${result.manifest.appVersion}`);
            return;
        }
        if (action === "runtime") { printJson({managerRuntime: inspection.manifest.components.managerRuntime, applicationRuntime: inspection.manifest.components.applicationRuntime}); return; }
        if (action === "tools") { printJson(inspection.manifest.components.tools); return; }
        if (action === "instances") { printJson(await readManagerConfig()); return; }
        await mutateInstallation(inspection.root, (mutation) => createAdmin(mutation.root, mutation.manifest));
        return;
    }
    if (inspection.kind === "invalid-installation") {
        p.intro("NeuroBook实例损坏");
        printInspection(inspection);
        const action = await promptResult(p.select({message: "下一步", options: [{value: "manage", label: "管理其他实例"}, {value: "exit", label: "退出并人工处理"}]}));
        if (action === "manage") await runManagerTui(managerExecutable);
        return;
    }
    if (inspection.kind === "neuro-book-checkout") {
        p.intro("发现未接管的NeuroBook源码");
        printInspection(inspection);
        const action = await promptResult(p.select({message: "下一步", options: [
            {value: "adopt", label: "接管当前目录"}, {value: "manage", label: "管理其他实例"}, {value: "install", label: "部署新实例"},
        ]}));
        if (action === "manage") return runManagerTui(managerExecutable);
        if (action === "install") return runInstallGuide({managerExecutable});
        await program.parseAsync([process.argv[0]!, process.argv[1]!, "adopt", inspection.root]);
        return;
    }
    const config = await readManagerConfig();
    const found = await discoverInstances(configuredDiscoveryRoots(config), config.instances.map((instance) => instance.root));
    p.intro("NeuroBook Manager");
    p.note(`已注册实例：${config.instances.length}\n发现未登记实例：${found.candidates.length}`, "环境检测");
    const action = await promptResult(p.select({message: "你希望做什么？", options: [
        {value: "install", label: "部署新实例"}, {value: "manage", label: "管理已有实例", disabled: config.instances.length === 0},
        {value: "discover", label: "查看发现的实例", disabled: found.candidates.length === 0},
    ]}));
    if (action === "manage") return runManagerTui(managerExecutable);
    if (action === "discover") { await handleDiscoveredCandidates(found.candidates); return; }
    await runInstallGuide({managerExecutable});
}

async function handleDiscoveredCandidates(candidates: OfflineInspection[]): Promise<void> {
    const selected = await promptResult(p.select({message: "选择候选实例", options: [...candidates.map((candidate) => ({value: candidate.root, label: candidate.root, hint: candidate.kind})), {value: "__back", label: "返回"}]}));
    if (selected === "__back") return;
    const inspection = candidates.find((candidate) => candidate.root === selected);
    if (!inspection) return;
    printInspection(inspection);
    if (inspection.kind === "managed-installation") {
        const checked = await inspectImport(inspection.root);
        if (!checked.importable) throw new Error(checked.blockers.map((issue) => issue.message).join("\n"));
        const confirmed = await promptResult(p.confirm({message: "导入此实例？", initialValue: true}));
        if (confirmed) await importInstallation({root: inspection.root, acceptWarnings: true});
        return;
    }
    if (inspection.kind === "neuro-book-checkout") {
        const profile = await promptResult(p.select({message: "选择接管后的运行方式", options: [
            {value: "source-dev" as const, label: "Source Dev", hint: "保留源码；现有不可信.output不纳入管理"},
            {value: "source-product" as const, label: "Source Product", hint: "从当前revision事务重建Product"},
            {value: "source-docker" as const, label: "Source Docker", hint: "容器内构建明确revision镜像"},
        ]}));
        const preflight = await inspectAdoptionPreflight({root: inspection.root, profile, port: 3000});
        assertAdoptionPreflight(preflight);
        const confirmed = await promptResult(p.confirm({message: `以${profile}接管此checkout？`, initialValue: true}));
        if (!confirmed) return;
        const config = await readManagerConfig();
        await adoptSourceInstallation({root: inspection.root, profile, channel: config.preferences.channel, port: 3000, authEnabled: true, dryRun: false, managerExecutable}, preflight);
    }
}

function printInspection(inspection: OfflineInspection): void {
    console.log([`目录：${inspection.root}`, `类型：${inspection.kind}`, inspection.git ? `Git：${inspection.git.branch} ${inspection.git.revision}${inspection.git.dirty ? " dirty" : ""}` : "", `Product：${inspection.product.exists ? inspection.product.trusted ? "可信" : "存在但不可信" : "不存在"}`, ...inspection.blockers.map((item) => `阻断：${item.message}`), ...inspection.warnings.map((item) => `警告：${item.message}`)].filter(Boolean).join("\n"));
}

function parseAdoptProfile(value: string): "source-dev" | "source-product" | "source-docker" {
    if (value === "source-dev" || value === "source-product" || value === "source-docker") return value;
    throw new Error(`接管只支持Source Profile：${value}`);
}

async function promptResult<T>(result: Promise<T | symbol>): Promise<T> {
    const value = await result;
    if (p.isCancel(value)) throw new Error("已取消操作。" );
    return value as T;
}

/** 从 stdin 读取管理员密码；不 trim、不写日志，硬限制为 4096 UTF-8 bytes。 */
async function readPasswordStdin(): Promise<string> {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        const value = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        bytes += value.byteLength;
        if (bytes > 4096) throw new Error("管理员密码超过 4096 bytes。" );
        chunks.push(value);
    }
    if (bytes === 0) throw new Error("stdin 没有提供管理员密码。" );
    const input = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        input.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(input);
    } catch {
        throw new Error("管理员密码必须是有效的 UTF-8 字节。" );
    }
}

/** 按显式 root、显式实例、当前目录、默认实例的顺序定位安装。 */
async function currentInstallation(): Promise<{root: string; manifest: InstallationManifest}> {
    const selection = program.opts<{root?: string; instance?: string}>();
    if (selection.root && selection.instance) throw new Error("--root 与 --instance 不能同时使用。" );
    if (selection.root) return readInstallation(resolve(selection.root));
    if (selection.instance) {
        const config = await readManagerConfig();
        const instance = findManagerInstance(config, selection.instance);
        if (!instance) throw new Error(`找不到已注册实例：${selection.instance}`);
        return readInstallation(instance.root);
    }

    const discoveredRoot = discoverInstallationRoot();
    const localManifest = await readInstallationManifest(installationPaths(discoveredRoot).manifest);
    if (localManifest) return {root: discoveredRoot, manifest: localManifest};

    const config = await readManagerConfig();
    const defaultInstance = config.defaultInstanceId ? findManagerInstance(config, config.defaultInstanceId) : null;
    if (defaultInstance) return readInstallation(defaultInstance.root);
    throw new Error(`当前目录不属于 NeuroBook 实例，且没有默认实例。运行 neuro-book manage 或 neuro-book instances add <path>。`);
}

/** 读取指定 Installation Root 的严格 manifest。 */
async function readInstallation(root: string): Promise<{root: string; manifest: InstallationManifest}> {
    const absoluteRoot = resolve(root);
    const manifest = await readInstallationManifest(installationPaths(absoluteRoot).manifest);
    if (!manifest) throw new Error(`目录不属于 NeuroBook Manager 安装：${absoluteRoot}`);
    return {root: absoluteRoot, manifest};
}

/** 解析 Release channel 参数。 */
function parseChannel(value: string): ReleaseChannel {
    if (value === "stable" || value === "canary") return value;
    throw new Error(`channel 只支持 stable 或 canary：${value}`);
}

/** 解析并限制 Web 端口。 */
function parsePort(value: string): number {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`端口必须是 1-65535：${value}`);
    return port;
}

/** 解析鉴权开关参数。 */
function parseAuth(value: string): boolean {
    if (value === "enabled") return true;
    if (value === "disabled") return false;
    throw new Error(`auth 只支持 enabled 或 disabled：${value}`);
}

/** 累积并校验 update 组件参数。 */
/** 限制 v1 可维护工具集合。 */
function assertTool(value: string): asserts value is "rg" | "git" {
    if (value !== "rg" && value !== "git") throw new Error(`不支持的工具：${value}`);
}

/** 输出机器可读 JSON。 */
function printJson(value: object): void {
    console.log(JSON.stringify(value, null, 4));
}

/** 输出 Manager GUI 使用的单行 NDJSON；值中不得出现原始换行。 */
function printNdjson(value: object): void {
    const line = JSON.stringify(value);
    if (line.includes("\n") || line.includes("\r")) throw new Error("Manager GUI NDJSON 不允许原始换行。");
    console.log(line);
}

/** 输出适合终端快速查看的顶层键值。 */
function printObject(value: object): void {
    for (const [key, item] of Object.entries(value)) {
        console.log(`${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
    }
}

async function readDesktopProviderInput(): Promise<{
    name: string;
    baseURL: string;
    api: string;
    apiKey: string;
    model: string;
    discoverModels?: boolean;
}> {
    if (process.stdin.isTTY) throw new Error("Provider JSON 必须通过 stdin 传入。");
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of process.stdin) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        totalBytes += bytes.byteLength;
        if (totalBytes > DESKTOP_PROVIDER_INPUT_MAX_BYTES) {
            throw new Error("Provider JSON 超过 64 KiB。");
        }
        chunks.push(bytes);
    }
    return parseDesktopProviderInput(JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown);
}
