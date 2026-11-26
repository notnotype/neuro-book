/**
 * 浏览器 Agent 评测的命令行（用法见同目录 `README.md`）。机器读的输出写到标准输出（版本化 JSON），进度与诊断写到标准错误。
 * 退出码：0 成功，1 运行出错，2 参数不对。
 */

import {Command, CommanderError} from "commander";

import {startSite} from "./sites/server";
import type {RunningSite} from "./sites/server";
import {TASKS, taskById} from "./tasks/index";

function program(): Command {
    const cli = new Command("browser-eval").description("浏览器 Agent 评测").exitOverride().configureOutput({outputError: (text) => process.stderr.write(text)});
    cli.command("sites")
        .description("只起假站，给人工打开看页面；Ctrl-C 停止")
        .option("--task <id>", "按这道题的种子起它的站（缺省每个站各起一份，用第一道用到它的题的种子）")
        .action(async (options: {task?: string}) => {
            const tasks = options.task === undefined ? TASKS.filter((task, i) => TASKS.findIndex((other) => other.site === task.site) === i) : [taskById(options.task)];
            const sites: Array<RunningSite<unknown>> = [];
            for (const task of tasks) {
                const site = await startSite(task.site, task.seed);
                sites.push(site);
                process.stdout.write(`${JSON.stringify({format: "nbook.browser-eval.sites/v1", site: task.site.name, task: task.id, urls: site.urls})}\n`);
            }
            await new Promise<void>((resolve) => {
                process.once("SIGINT", resolve);
                process.once("SIGTERM", resolve);
            });
            await Promise.all(sites.map((site) => site.stop()));
        });
    return cli;
}

try {
    await program().parseAsync(process.argv);
} catch (error) {
    if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? 0 : 2);
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
}
