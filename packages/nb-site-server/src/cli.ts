/**
 * 命令行 `nb-site`：按传入的模块列表登记子命令、运行一个，由结果算出退出码（`site.operations` 的输入一节、失败表）。
 * 产品入口 `main.ts` 传两个真模块；拆成两个进程时各传一个；测试的入口 `testing/fixture-main.ts` 传夹具模块。
 *
 * 退出码只在这里算：命令的结果带 `failure` 时把它写到标准错误、得 1；请求之外出过致命错误（`lifecycle.failed`）也得 1；
 * 其余得 0。commander 自己的用法错误与 `--help` 照它的缺省直接退出（错误得 1）。
 */

import {Command} from "commander";

import {migrate} from "./commands/migrate";
import {runModuleCommand} from "./commands/module-command";
import {SUCCEEDED, type CommandResult} from "./commands/prepare";
import {serve} from "./commands/serve";
import {MODULE_NAME} from "./db/open";
import {installProcessLifecycle} from "./lifecycle";
import {createLogger, errorType, writeFailure, writeStderr, writeStdout} from "./log";
import type {SiteModule} from "./module";

/** 入口自己的子命令；模块的命令不能与它们同名。`backup` 由第 4 片加，名字先占住。 */
const ENTRY_COMMANDS = new Set(["serve", "migrate", "backup"]);

/** 模块列表的形状是程序写死的，不合格是程序错误，直接抛出。 */
function checkModules(modules: readonly SiteModule[]): void {
    const names = new Set<string>();
    const commands = new Set(ENTRY_COMMANDS);
    for (const module of modules) {
        if (!MODULE_NAME.test(module.name)) throw new Error(`invalid module name: ${JSON.stringify(module.name)}`);
        if (names.has(module.name)) throw new Error(`module ${module.name} is listed twice`);
        names.add(module.name);
        for (const command of module.commands ?? []) {
            if (commands.has(command.name)) throw new Error(`command ${command.name} of module ${module.name} clashes with another command`);
            commands.add(command.name);
        }
    }
}

export async function runCli(argv: readonly string[], modules: readonly SiteModule[]): Promise<number> {
    const log = createLogger(writeStdout);
    // 在解析命令之前装上：配置校验与迁移期间收到的信号也要记下（`lifecycle.ts`）。
    const lifecycle = installProcessLifecycle(log);
    try {
        checkModules(modules);
        let result: CommandResult = SUCCEEDED;
        const program = new Command("nb-site").description("NeuroBook official site server: serve, migrate and back up the site's data directory");
        program
            .command("serve")
            .description("check the configuration, run pending migrations, then serve HTTP until SIGTERM or SIGINT")
            .action(async () => {
                result = await serve(process.env, modules, log, lifecycle);
            });
        program
            .command("migrate")
            .description("check the configuration and run pending migrations, then exit")
            .action(async () => {
                result = await migrate(process.env, modules, log, lifecycle);
            });
        for (const module of modules) {
            for (const command of module.commands ?? []) {
                const sub = program.command(command.name).description(command.description);
                const declared = command.arguments ?? [];
                for (const argument of declared) sub.argument(argument.required ? `<${argument.name}>` : `[${argument.name}]`);
                sub.action(async (...values: unknown[]) => {
                    // commander 把位置参数按声明的顺序放在最前面，后面是选项与命令对象。
                    const args = Object.fromEntries(declared.map((argument, index) => [argument.name, values[index] as string | undefined]));
                    result = await runModuleCommand(process.env, module, command, args, log, lifecycle);
                });
            }
        }
        await program.parseAsync([...argv], {from: "user"});
        if (result.failure !== undefined) writeFailure(writeStderr, result.failure);
        return result.failure !== undefined || lifecycle.failed ? 1 : 0;
    } catch (error) {
        // 命令抛出的（不是预料之中的失败）：同样写成一行 JSON，只有错误类型，收口已由各命令的 finally 做完。
        log.error("process.fatal", "command threw", {errorType: errorType(error)});
        return 1;
    } finally {
        lifecycle.dispose();
    }
}
