/**
 * 自动生成会话的标题和说明（docs/specs/agent/builtin-profiles.md 输出 6–13）。
 *
 * 扩展只把“一轮结束”“带摘要的压缩”告诉 `SessionMeta`，不等待；用 `turnEnded` 不用 `runEnded`，因为压缩运行也以
 * `runEnded{completed}` 收口，而它没有轮。生成按前台会话排成一条队，每一项轮到时按当时的状态重新判断，所以并发的触发不会多发请求，
 * 上一次失败也不用另记。
 *
 * 寿命：碰会话的每一步各自经 `table.accept`，`SessionTable.stop` 因此能等到建到一半的会话登记完再关。只有 `waitRun` 不经 accept：
 * 它要等 `stop` 关掉标题会话才收口，放进 accept 会互相等。`AgentRuntime.stop` 在 `table.stop` 之后等这里的队列排空。
 */

import {createHash, randomUUID} from "node:crypto";

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import {defineExtension} from "@notnotype/nb-harness/kernel";
import type {CoreSettings, LogEvent, ModelPort, SessionApi} from "@notnotype/nb-harness/kernel/contracts";

import {SESSION_TITLE_PROFILE} from "../shared/contracts";
import type {CreateResult} from "../shared/contracts";
import {EXTENSIONS_POINT} from "../shared/points";
import type {AgentExtensionDeclaration, AgentExtensionImplementation} from "../shared/points";

import {SESSION_META_TAG} from "./builtin/profiles/session-title";
import type {SessionTable} from "./sessions";

export const SESSION_META_EXTENSION = "nbook.agent.session-meta";
export const SESSION_META_CONTRIBUTION: ContributionDeclaration<AgentExtensionDeclaration> = {capability: EXTENSIONS_POINT, id: SESSION_META_EXTENSION, declaration: {tags: [SESSION_META_TAG]}};

export type MetaTrigger = {readonly kind: "turn"} | {readonly kind: "compaction"; readonly summary: string};

/** 给模型的材料各取多少个字符。 */
const FIRST_TURN_CHARS = 2000;
const SUMMARY_CHARS = 4000;
const FALLBACK_TITLE_CHARS = 30;
/** 解析标题会话的模型时用：它自己的设置是缺省值，不看前台会话选的模型。 */
const TITLE_SESSION_SETTINGS: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};

const firstChars = (text: string, count: number): string => Array.from(text).slice(0, count).join("");

/** 前台会话 id 最长 128 个字符，直接拼会超过 id 上限，所以取哈希。 */
export const titleSessionId = (session: string): string => `session-title-${createHash("sha256").update(session).digest("hex").slice(0, 32)}`;

export function sessionMetaExtension(notify: (session: string, trigger: MetaTrigger) => void): AgentExtensionImplementation {
    return defineExtension({
        id: SESSION_META_EXTENSION,
        tags: [SESSION_META_TAG],
        on: {
            turnEnded: (event, ctx) => {
                if ((event.data as {reason: string}).reason === "completed") notify(ctx.session.sessionId, {kind: "turn"});
            },
            compaction: (event, ctx) => {
                const {replacement} = event.data as {replacement: string | null};
                if (replacement !== null) notify(ctx.session.sessionId, {kind: "compaction", summary: replacement});
            },
        },
    });
}

export interface SessionMetaOptions {
    readonly table: SessionTable;
    /** 建会话（走运行时的建会话流程）；调用方已在 `accept` 里。 */
    readonly create: (options: {readonly profile: string; readonly id: string; readonly background: true}) => Promise<CreateResult>;
    readonly models: ModelPort;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

const textOf = (event: LogEvent): string => {
    const {content} = event.data as {content: readonly {readonly kind: string; readonly text?: string}[]};
    return content.filter((block) => block.kind === "text").map((block) => block.text ?? "").join("");
};

export class SessionMeta {
    readonly #queues = new Map<string, Promise<void>>();

    constructor(private readonly options: SessionMetaOptions) {}

    notify(session: string, trigger: MetaTrigger): void {
        const queued = (this.#queues.get(session) ?? Promise.resolve()).then(() => this.#generate(session, trigger)).catch((error: unknown) => {
            // 停止时各步被拒绝或运行被中断：结果丢掉，下次启动后由下一轮结束再触发。
            if (!this.options.table.stopping) this.#failed(session, error instanceof Error ? error.message : String(error));
        }).finally(() => {
            if (this.#queues.get(session) === queued) this.#queues.delete(session);
        });
        this.#queues.set(session, queued);
    }

    /** 等排着的生成都结束；`SessionTable` 开始停止之后才调，所以不会再有新的生成走到模型。 */
    async settled(): Promise<void> {
        while (this.#queues.size > 0) await Promise.allSettled([...this.#queues.values()]);
    }

    #step<T>(run: () => Promise<T>): Promise<T> {
        return this.options.table.accept(run);
    }

    #failed(session: string, message: string): void {
        this.options.report("session-meta-failed", `could not generate the title and description of session ${session}: ${message}`, {session, message});
    }

    async #generate(session: string, trigger: MetaTrigger): Promise<void> {
        const view = this.options.table.view(session);
        const snapshot = await this.#step(() => view.snapshot());
        if (snapshot.header.background === true || snapshot.header.caller !== undefined) return;
        if (trigger.kind === "turn" && snapshot.description !== null && snapshot.title !== null) return;

        const firstInput = trigger.kind === "turn" ? await this.#material(view) : null;
        if (trigger.kind === "turn" && firstInput === null) return;

        const resolved = this.options.models.resolve({settings: TITLE_SESSION_SETTINGS, purpose: "background", profile: SESSION_TITLE_PROFILE});
        if (!resolved.ok) {
            if (trigger.kind !== "turn" || snapshot.title !== null) return;
            const title = firstChars(firstInput!.input.replace(/\s+/gu, " "), FALLBACK_TITLE_CHARS);
            await this.#write(view, session, {title});
            return;
        }

        const text = trigger.kind === "turn"
            ? `<conversation>\n用户：${firstChars(firstInput!.input, FIRST_TURN_CHARS)}\n\n助手：${firstChars(firstInput!.reply, FIRST_TURN_CHARS)}\n</conversation>`
            : `这段对话已经写过摘要，请按摘要写说明（标题照旧也要交）。当前标题：${snapshot.title ?? "（没有）"}\n\n<conversation>\n${firstChars(trigger.summary, SUMMARY_CHARS)}\n</conversation>`;
        const generated = await this.#ask(session, text);
        if (generated === null) return;
        await this.#write(view, session, trigger.kind === "turn" ? generated : {description: generated.description});
    }

    /** 当前路径上第一条用户的话与第一条有文字的回复（都是全文，给模型时才截，兜底标题要先折叠空白）；用户的话没有文字时为 null。 */
    async #material(view: SessionApi): Promise<{readonly input: string; readonly reply: string} | null> {
        const events = await this.#step(() => view.path());
        const input = (events.find((event) => event.type === "input")?.data as {text: string} | undefined)?.text.trim() ?? "";
        if (input === "") return null;
        const reply = events.filter((event) => event.type === "assistant").map(textOf).find((text) => text.trim() !== "") ?? "";
        return {input, reply};
    }

    /** 在标题会话里跑一次；失败写诊断，交回 null。 */
    async #ask(session: string, text: string): Promise<{readonly title: string; readonly description: string} | null> {
        const id = titleSessionId(session);
        const created = await this.#step(() => this.options.create({profile: SESSION_TITLE_PROFILE, id, background: true}));
        const titleSession = this.options.table.view(id);
        if (!created.ok) {
            if (created.code !== "session-exists") {
                this.#failed(session, `could not create the title session: ${created.code}`);
                return null;
            }
            // 看当前的 Profile，不看会话头：会话头只记建会话时的，`changeProfile` 之后这里交给的就是别的 Profile 与它的工具。
            const {header, profile} = await this.#step(() => titleSession.snapshot());
            if (profile.id !== SESSION_TITLE_PROFILE || header.background !== true) {
                this.options.report("session-meta-conflict", `session ${id} is not the title session of ${session}; nothing was sent to it`, {session, titleSession: id});
                return null;
            }
        }
        const sent = await this.#step(() => titleSession.send({commandId: randomUUID(), input: {text}}));
        if (!sent.ok || sent.value.runId === null) {
            this.#failed(session, sent.ok ? "the title session already has a run" : `could not send to the title session: ${sent.code}`);
            return null;
        }
        const {runId} = sent.value;
        const result = await titleSession.waitRun(runId);
        const value = result.result?.value as {readonly title?: unknown; readonly description?: unknown} | undefined;
        if (result.reason === "finished" && typeof value?.title === "string" && typeof value.description === "string") return {title: value.title, description: value.description};
        // 停止时运行被中断：结果丢掉（见文件头）。
        if (!this.options.table.stopping) this.#failed(session, `the title session ended with ${result.reason}${result.error?.code === undefined ? "" : ` (${result.error.code})`}`);
        return null;
    }

    async #write(view: SessionApi, session: string, meta: {readonly title?: string; readonly description?: string}): Promise<void> {
        const written = await this.#step(() => view.setGeneratedMeta({commandId: randomUUID(), ...meta}));
        if (!written.ok) this.#failed(session, `could not write the result: ${written.code}`);
    }
}
