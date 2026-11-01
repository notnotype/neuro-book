/**
 * `nbook` 命令行本体（docs/specs/runtime/cli.md）：由入口 `main.ts` 在两条前置导入之后加载。不给子命令等于 `start`。
 *
 * commander 的错误不让它自己打印（英文、退出码 1），统一在这里按错误码换成中文、以 2 退出；它的帮助标题也换成中文。
 */

import {homedir} from "node:os";

import {Command, CommanderError} from "commander";

import {BUN_ENGINE, PRODUCT_VERSION} from "nbook/shared/product";

import {CliFailure, createOutput} from "./output";
import {installPlugin, listPlugins, setPluginEnabled, uninstallPlugin} from "./plugin";
import type {PluginContext} from "./plugin";
import {start} from "./start";
import {defaultStateRoot, resolveStateRoot} from "./state-root";

const TITLES: Readonly<Record<string, string>> = {"Usage:": "用法：", "Arguments:": "参数：", "Options:": "选项：", "Commands:": "命令：", "Global Options:": "全局选项："};

function versionText(): string {
    return `NeuroBook ${PRODUCT_VERSION}\nBun ${Bun.version}\n缺省状态根 ${defaultStateRoot(process.platform, process.env, homedir())}`;
}

function portOption(value: string): number {
    const port = Number(value);
    if (!/^\d+$/u.test(value) || port > 65535) throw new CliFailure("usage", `端口必须是 0 到 65535 的整数，收到 ${value}`, 2);
    return port;
}

interface GlobalOptions {
    readonly stateRoot?: string;
    readonly json?: boolean;
}

function program(): Command {
    const nbook = new Command("nbook")
        .description("NeuroBook：本地优先的长篇写作工作区")
        .option("--state-root <目录>", "状态根（缺省是平台的数据目录，或环境变量 NBOOK_STATE_ROOT）")
        .option("--json", "结果以一个 JSON 对象写到标准输出")
        .helpOption("-h, --help", "显示帮助")
        .helpCommand("help [命令]", "显示命令的帮助")
        .version(versionText(), "-v, --version", "显示版本")
        // commander 的用法行与命令列表写 `[options]`：自己拼，与中文标题一致；子命令的帮助也列出全局选项。
        // 对齐按终端里的显示宽度算：commander 缺省按字符数，中文一个字占两格，说明列会错开。
        .configureHelp({styleTitle: (title) => TITLES[title] ?? title, commandUsage: usageOf, subcommandTerm: termOf, showGlobalOptions: true, displayWidth: (text) => Bun.stringWidth(text)})
        .configureOutput({outputError: () => undefined})
        .exitOverride();
    nbook
        .command("start", {isDefault: true})
        .description("启动 NeuroBook（前台运行，Ctrl-C 停止）；状态根上已有实例时打开它")
        .option("--port <端口>", "HTTP 端口（不给时 4217，被占用就成对顺延；给了的端口被占用时启动失败）", portOption)
        .option("--rpc-port <端口>", "内核 RPC 端口（缺省跟着 --port 加 1，都不给时是 4218）", portOption)
        .option("--no-open", "不打开浏览器")
        .option("--safe-mode", "安全模式：不加载第三方插件")
        // 拼错的子命令会被当成缺省的 start 的参数：收下它们，在下面报“不认识的命令”。
        .allowExcessArguments()
        .action(async (options: {port?: number; rpcPort?: number; open: boolean; safeMode?: boolean}, command: Command) => {
            const [unknown] = command.args;
            if (unknown !== undefined) throw new CliFailure("usage", `不认识的命令 ${unknown}；可用的命令：start、plugin（nbook --help 查看用法）`, 2);
            const globals = command.optsWithGlobals<GlobalOptions>();
            await start(
                {stateRoot: stateRootOf(globals), output: createOutput(globals.json === true), env: process.env, cwd: process.cwd()},
                {port: options.port, rpcPort: options.rpcPort, open: options.open, safeMode: options.safeMode === true},
            );
        });
    const plugin = nbook.command("plugin").description("管理第三方插件：只写登记表，重启服务后生效");
    const pluginContext = (command: Command): PluginContext => {
        const globals = command.optsWithGlobals<GlobalOptions>();
        return {stateRoot: stateRootOf(globals), output: createOutput(globals.json === true), cwd: process.cwd()};
    };
    plugin.command("list").description("列出内置与第三方插件，以及待生效的变化").action((_options: unknown, command: Command) => listPlugins(pluginContext(command)));
    plugin
        .command("install")
        .description("安装或升级一个本地插件目录（nbooke build 的产物 dist）")
        .argument("<目录>", "插件目录")
        .option("--yes", "降级或有插件会受阻时也继续")
        .action((directory: string, options: {yes?: boolean}, command: Command) => installPlugin(pluginContext(command), directory, {yes: options.yes === true}));
    plugin.command("enable").description("启用插件").argument("<id>", "插件 id").action((id: string, _options: unknown, command: Command) => setPluginEnabled(pluginContext(command), id, true));
    plugin.command("disable").description("禁用插件").argument("<id>", "插件 id").action((id: string, _options: unknown, command: Command) => setPluginEnabled(pluginContext(command), id, false));
    plugin.command("uninstall").description("卸载插件，保留它的私有数据").argument("<id>", "插件 id").action((id: string, _options: unknown, command: Command) => uninstallPlugin(pluginContext(command), id));
    return nbook;
}

function argumentsOf(command: Command): string[] {
    return command.registeredArguments.map((argument) => (argument.required ? `<${argument.name()}>` : `[${argument.name()}]`));
}

function usageOf(command: Command): string {
    const names: string[] = [];
    for (let current: Command | null = command; current !== null; current = current.parent) names.unshift(current.name());
    return [...names, "[选项]", ...(command.commands.length > 0 ? ["[命令]"] : []), ...argumentsOf(command)].join(" ");
}

function termOf(command: Command): string {
    return [command.name(), ...(command.options.length > 0 ? ["[选项]"] : []), ...argumentsOf(command)].join(" ");
}

function stateRootOf(globals: GlobalOptions): string {
    return resolveStateRoot({option: globals.stateRoot, env: process.env, platform: process.platform, home: homedir(), cwd: process.cwd()});
}

/**
 * commander 的错误换成中文说明；帮助与版本是正常结束。按错误码分支，选项名、命令名与建议只从英文原文的引号里取出来显示。
 * `commander.help` 有两种：`help` 子命令（退出码 0）与命令组没跟子命令（它已把帮助写到标准错误，退出码 1）。
 */
function usageFailure(error: CommanderError): CliFailure | null {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") return null;
    if (error.code === "commander.help" && error.exitCode === 0) return null;
    const quoted = /'([^']+)'/u.exec(error.message)?.[1] ?? "";
    const suggestion = /Did you mean ([^?]+)\?/u.exec(error.message)?.[1];
    const hint = `${suggestion === undefined ? "" : `，是不是 ${suggestion}`}；加 --help 查看用法`;
    switch (error.code) {
        case "commander.unknownOption":
            return new CliFailure("usage", `不认识的选项 ${quoted}${hint}`, 2);
        case "commander.unknownCommand":
            return new CliFailure("usage", `不认识的命令 ${quoted}${hint}`, 2);
        case "commander.help":
            return new CliFailure("usage", "缺少子命令，见上面的帮助", 2);
        case "commander.missingArgument":
            return new CliFailure("usage", `缺少参数 <${quoted}>${hint}`, 2);
        case "commander.optionMissingArgument":
            return new CliFailure("usage", `选项 ${quoted} 缺少值${hint}`, 2);
        case "commander.excessArguments":
            return new CliFailure("usage", `命令 ${quoted} 不收这么多参数${hint}`, 2);
        default:
            return new CliFailure("usage", `用法错误${hint}`, 2);
    }
}

async function main(argv: readonly string[]): Promise<number> {
    const json = argv.includes("--json");
    const output = createOutput(json);
    if (!Bun.semver.satisfies(Bun.version, BUN_ENGINE)) {
        output.failure(new CliFailure("bun-too-old", `NeuroBook 需要 Bun ${BUN_ENGINE}，当前是 ${Bun.version}；运行 bun upgrade 后再试`, 2));
        return 2;
    }
    try {
        await program().parseAsync(argv, {from: "user"});
        return 0;
    } catch (error) {
        // portOption 在 commander 解析参数时抛出，commander 把它原样往外抛。
        const failure = error instanceof CommanderError ? usageFailure(error) : error instanceof CliFailure ? error : null;
        if (error instanceof CommanderError && failure === null) return 0;
        if (failure === null) throw error;
        output.failure(failure);
        return failure.exitCode;
    }
}

process.exit(await main(process.argv.slice(2)));
