/**
 * 系统提示词里“可派的子代理”一节（docs/specs/agent/subagents.md 输出 20）：`nbook.agent` 默认给每个会话装上这个扩展，交稳定的槽
 * `subagents`，缺省布局把它收进系统块。会话没有 `agent_spawn`、或白名单为空时不交。
 *
 * 白名单随 Profile 设置变，每次请求现算；推荐的 Profile 要写初始输入与结果的形状，这两样在 Profile 的实现里、要异步解析，所以先
 * 缓存起来：第一次还没取到时这一节只写名字与说明，取到之后的请求补上（形状不变，之后不再变）。
 */

import {defineExtension} from "@notnotype/nb-harness/kernel";
import type {AnyProfile, JsonValue} from "@notnotype/nb-harness/kernel/contracts";

import type {ProfileEntry} from "../../shared/contracts";
import {profileAgents} from "../../shared/profile-agents";
import type {ToolBinding} from "../../shared/profile-tools";
import type {AgentExtensionImplementation} from "../../shared/points";

export const SUBAGENTS_EXTENSION = "nbook.agent.subagents";
export const SPAWN_TOOL = "nbook.agent.spawn";

interface Shape {
    readonly initial?: JsonValue;
    readonly result?: JsonValue;
}

export interface SubagentPromptDeps {
    readonly catalog: () => readonly ProfileEntry[];
    /** 这个 Profile 在 Profile 设置里的 `agents` 绑定。 */
    readonly binding: (profile: string) => ToolBinding | undefined;
}

/** 形状缓存：Profile 的实现换了（重新打包）时由调用方 `clear`。 */
export class ProfileShapes {
    readonly #shapes = new Map<string, Shape>();
    readonly #loading = new Set<string>();
    /** `clear` 时加一：清空之前发出的解析晚到时按代数丢掉，旧形状不会写回。 */
    #generation = 0;

    constructor(private readonly resolve: (key: string) => Promise<AnyProfile | undefined>) {}

    get(key: string): Shape | undefined {
        const shape = this.#shapes.get(key);
        if (shape === undefined) this.#load(key);
        return shape;
    }

    /** Profile 目录变了（重新打包、增删）：下次用到时重新取。 */
    clear(): void {
        this.#generation += 1;
        this.#shapes.clear();
        this.#loading.clear();
    }

    #load(key: string): void {
        if (this.#loading.has(key)) return;
        this.#loading.add(key);
        const generation = this.#generation;
        void this.resolve(key).then((resolved) => {
            if (generation !== this.#generation) return;
            // 解析不到的记成没有形状，不在每次请求时再解析；目录变了（`clear`）再试。
            if (resolved === undefined) {
                this.#shapes.set(key, {});
                return;
            }
            // `defineProfile` 的结果带着这两个字段，`AnyProfile` 只列内核按名字读的；内核建会话时也这样读（session.ts 的 `initial`）。
            const profile = resolved as AnyProfile & {readonly initial?: unknown; readonly result?: {readonly schema: unknown}};
            this.#shapes.set(key, {...(profile.initial === undefined ? {} : {initial: profile.initial as JsonValue}), ...(profile.result === undefined ? {} : {result: profile.result.schema as JsonValue})});
        }, () => undefined).finally(() => {
            if (generation === this.#generation) this.#loading.delete(key);
        });
    }
}

function line(entry: ProfileEntry | undefined, key: string): string {
    return entry === undefined ? `- ${key}` : `- ${key}（${entry.name}）：${entry.description}`;
}

/** 这一节的文字；不交时 null。纯函数，便于测试。 */
export function subagentsSection(profile: string | undefined, hasSpawn: boolean, deps: SubagentPromptDeps, shapes: Pick<ProfileShapes, "get">): string | null {
    if (!hasSpawn || profile === undefined) return null;
    const catalog = deps.catalog();
    const agents = profileAgents(catalog.find((entry) => entry.key === profile)?.agents, deps.binding(profile));
    if (agents.allowed.length === 0) return null;
    const byKey = new Map(catalog.map((entry) => [entry.key, entry]));
    const recommended = new Set(agents.recommended);
    const parts = ["用 agent_spawn 派子代理时，profile 只能是下面这些 Profile 的 key。"];
    if (recommended.size > 0) {
        parts.push("推荐：");
        for (const key of agents.recommended) {
            const shape = shapes.get(key);
            parts.push(line(byKey.get(key), key));
            if (shape?.initial !== undefined) parts.push(`  初始输入（initial）：${JSON.stringify(shape.initial)}`);
            if (shape?.result !== undefined) parts.push(`  结果（交回时调用 yield）：${JSON.stringify(shape.result)}`);
        }
    }
    const others = agents.allowed.filter((key) => !recommended.has(key));
    if (others.length > 0) {
        parts.push(recommended.size > 0 ? "其余可派：" : "可派：");
        for (const key of others) parts.push(line(byKey.get(key), key));
    }
    return `<subagents>\n${parts.join("\n")}\n</subagents>`;
}

export function subagentsPrompt(deps: SubagentPromptDeps, shapes: ProfileShapes): AgentExtensionImplementation {
    return defineExtension({
        id: SUBAGENTS_EXTENSION,
        version: "1",
        contribute: {
            subagents: {value: (view) => subagentsSection(view.session?.profile, view.tools.some((tool) => tool.id === SPAWN_TOOL), deps, shapes)},
        },
    });
}
