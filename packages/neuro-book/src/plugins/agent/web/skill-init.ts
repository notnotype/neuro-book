/**
 * 确认框 `SkillInitDialog` 背后的流程（docs/specs/agent/skills.md 输出 27）：打开时取计划，确认后经远程初始化，失败停在失败状态等重试。
 * 安装中关掉对话框只是不再显示，安装照常进行，结果由后台任务交代（输出 29）。`$` 菜单与 Skill 页各用一份。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {agentSessionsContract} from "../shared/remote";
import type {SkillInitPlan} from "../shared/skills";

export type SkillInitPhase = "loading" | "confirm" | "installing" | "failed";
/** busy：别处正在装；interrupted：被取消或中断；unavailable：这个 Skill 现在不能初始化。 */
export type SkillInitFailure = {readonly code: "install-failed" | "busy" | "interrupted" | "unavailable"; readonly output: string};

export interface SkillInitState {
    readonly open: boolean;
    readonly id: string;
    readonly name: string;
    readonly phase: SkillInitPhase;
    readonly plan: SkillInitPlan | null;
    readonly failure: SkillInitFailure | null;
}

export interface SkillInit {
    readonly state: ShallowRef<SkillInitState>;
    /** 打开确认框并取计划；另一个 Skill 的还开着时换成这一个。 */
    ask(skill: {readonly id: string; readonly name: string}): Promise<void>;
    /** “初始化”“重试”：开始安装，装完更新状态；成功时关上。 */
    confirm(): Promise<void>;
    close(): void;
}

const CLOSED: SkillInitState = {open: false, id: "", name: "", phase: "loading", plan: null, failure: null};

export function createSkillInit(remote: Pick<RemoteClient<typeof agentSessionsContract>, "skillInitPlan" | "initSkill">, report: (message: string) => void): SkillInit {
    const state = shallowRef<SkillInitState>(CLOSED);
    // 每次打开加一：上一个 Skill 的计划或安装结果回来时已经换了对话框，就不再写进来。
    let round = 0;
    const update = (at: number, patch: Partial<SkillInitState>): void => {
        if (at === round) state.value = {...state.value, ...patch};
    };
    const ask = async (skill: {readonly id: string; readonly name: string}): Promise<void> => {
        round += 1;
        const at = round;
        state.value = {...CLOSED, open: true, id: skill.id, name: skill.name};
        const planned = await remote.skillInitPlan({id: skill.id});
        if (planned.ok) {
            update(at, {phase: "confirm", plan: planned.value});
            return;
        }
        report(`skill init plan ${skill.id}: ${planned.code}`);
        update(at, {phase: "failed", failure: {code: "unavailable", output: ""}});
    };
    return {
        state,
        ask,
        async confirm() {
            const {id, name, plan, phase} = state.value;
            if (phase === "loading" || phase === "installing") return;
            // 计划没取到时的“重试”是重新取计划：用户还没看过依赖与要联网的说明，不直接装。
            if (plan === null) {
                await ask({id, name});
                return;
            }
            const at = round;
            update(at, {phase: "installing", failure: null});
            // 没有锁时确认框已经写明会生成锁文件，所以直接带上 `resolve`。
            const done = await remote.initSkill({id, ...(plan.lock ? {} : {resolve: true})});
            if (done.ok) {
                update(at, {open: false, phase: "confirm"});
                return;
            }
            if (done.code !== "install-failed" && done.code !== "busy" && done.code !== "interrupted") report(`skill init ${id}: ${done.code}`);
            const code = done.code === "install-failed" || done.code === "busy" || done.code === "interrupted" ? done.code : "unavailable";
            update(at, {phase: "failed", failure: {code, output: done.code === "install-failed" ? done.detail.output : ""}});
        },
        close() {
            state.value = {...state.value, open: false};
        },
    };
}
