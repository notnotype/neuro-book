/**
 * `nbook skill init <id>`（docs/specs/agent/skills.md 输出 22）：不要求应用在运行，直接调用与应用同一个初始化模块；与应用同时
 * 装同一个 Skill 时由文件锁挡住（`busy`），应用经监视看到装好的结果。
 */

import {join} from "node:path";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";

import {SkillCatalog, sourceRoot} from "nbook/plugins/agent/backend/skills/catalog";
import {SkillInstaller} from "nbook/plugins/agent/backend/skills/install";
import type {SkillInitPlan} from "nbook/plugins/agent/shared/skills";

import {CliFailure} from "./output";
import type {Output} from "./output";

export interface SkillCommandContext {
    readonly stateRoot: string;
    readonly output: Output;
    /** 标准输入是终端，能问用户。 */
    readonly interactive: boolean;
    /** 问一个是或否的问题；只在 `interactive` 时调用。 */
    readonly confirm: (question: string) => Promise<boolean>;
    /** 收到中断（Ctrl-C）时 abort。 */
    readonly signal: AbortSignal;
}

const FAILURES: Readonly<Record<string, string>> = {
    "skill-not-found": "没有这个 Skill。用户的 Skill 写名字或 user.<名字>，内置的写完整 id。",
    "not-initializable": "这个 Skill 不用初始化：只有 Skill 文件夹里自己放的、带 package.json 的 Skill 要初始化。",
    "busy": "这个 Skill 正在别处初始化（应用或另一个命令行），等它装完再看。",
    "lock-missing": "这个 Skill 没有 bun.lock。",
    "install-failed": "初始化没有成功。",
    "interrupted": "初始化被中断了。",
};

function planLines(plan: SkillInitPlan): string[] {
    return [
        plan.lock
            ? `要装 ${plan.packages === null ? "未知数量的" : String(plan.packages)} 个包，需要联网。`
            : `要装 ${String(plan.dependencies.length)} 个直接依赖（${plan.dependencies.join("、") || "无"}），需要联网。这个 Skill 没有 bun.lock：会按最新版本解析依赖并生成锁文件，以后都按它装。`,
        "包的安装脚本不会运行，需要安装脚本的包装好也可能用不了。",
    ];
}

/** 完整 id 照用；只写名字时只在用户的 Skill 里找。 */
const idOf = (target: string): string => (target.includes(".") ? target : `user.${target}`);

export async function initSkill(context: SkillCommandContext, target: string, options: {readonly yes: boolean}): Promise<void> {
    const id = idOf(target);
    let installer: SkillInstaller | null = null;
    const catalog = await SkillCatalog.open({
        roots: [sourceRoot("user", join(context.stateRoot, "user", "skills"), false)],
        clock: systemClock,
        report: () => undefined,
        installing: (skill) => installer?.installing(skill) ?? false,
    });
    const own = new SkillInstaller({item: (skill) => catalog.item(skill), refresh: (skill) => catalog.refresh(skill), locksRoot: join(context.stateRoot, "agent", "skills", "locks"), bun: process.execPath, clock: systemClock});
    installer = own;
    const stop = () => void own.stop();
    context.signal.addEventListener("abort", stop, {once: true});
    try {
        const planned = await own.plan(id);
        if (!planned.ok) throw new CliFailure(planned.code, FAILURES[planned.code]!, 1, {id});
        const lines = planLines(planned.plan);
        context.output.hint([`初始化 ${id}`, ...lines].join("\n"));
        if (!options.yes) {
            if (!context.interactive) throw new CliFailure("confirmation-required", "要继续，加 --yes 再运行一次。", 2, {id, plan: planned.plan});
            if (!(await context.confirm("继续初始化？[y/N] "))) throw new CliFailure("cancelled", "没有初始化。", 1, {id});
        }
        const done = await own.init(id, {resolve: !planned.plan.lock});
        if (!done.ok) throw new CliFailure(done.code, `${FAILURES[done.code]!}${done.detail === undefined ? "" : `\n${done.detail}`}`, 1, {id, ...(done.detail === undefined ? {} : {output: done.detail})});
        context.output.result(`已初始化 ${id}。`, {id, plan: planned.plan});
    } finally {
        context.signal.removeEventListener("abort", stop);
        await catalog.close();
    }
}
