/**
 * 剧情插件按视角的视图要在真实的世界服务上测（内核的视图令牌、带令牌的读取与审计都在服务里）：在一个临时目录上打开进程内的
 * `WorldService`（nb-canon 的 node 入口，真实的分段日志），按剧情插件的登记，经发布写进去。只由测试用。
 */

import {createHash} from "node:crypto";
import {join} from "node:path";

import type {Entry, Placement, WriteRequest} from "@notnotype/nb-canon";
import {nodeFiles, WorldService} from "@notnotype/nb-canon/node";

import {Viewpoint, type ViewpointGrant} from "../core/viewpoint";
import {drafts, plotRegistries, type ChangeOptions} from "./world";

export class PlotService {
    #sequence = 0;

    /** `texts` 是服务读的那张正文表：改了以后像宿主一样调 `service.textChanged`。 */
    private constructor(readonly service: WorldService, readonly texts: Map<string, string>) {}

    static async open(root: string, chapters: readonly string[]): Promise<PlotService> {
        const texts = new Map<string, string>(chapters.map((chapter) => [chapter, ""]));
        let held = false;
        const opened = await WorldService.open({
            files: nodeFiles,
            // 一个进程里只有这一个写者：锁只防并发的两次发布。
            lock: {acquire: async () => {
                while (held) await Promise.resolve();
                held = true;
                return {release: async () => void (held = false)};
            }},
            logDir: join(root, ".nbook", "world", "log"),
            sideDir: join(root, ".nbook", "world"),
            cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
            chapterText: (chapter) => texts.get(chapter),
            digest: (text) => createHash("sha256").update(text).digest("hex"),
            clock: () => 0,
            now: () => new Date(0).toISOString(),
        }, {chapters, ...plotRegistries()});
        if ("code" in opened) throw new Error(opened.code);
        return new PlotService(opened, texts);
    }

    async publish(puts: WriteRequest["puts"]): Promise<Readonly<Record<string, string>>> {
        const result = await this.service.publish({requestId: `plot-${String(++this.#sequence)}`, by: {kind: "author"}, what: "edit", title: "测试", baseVersion: this.service.status().version, puts});
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        return result.ids;
    }

    async person(name: string, extra: Partial<Entry> = {}): Promise<string> {
        const id = `tmp:p${String(++this.#sequence)}`;
        return (await this.publish([{ref: {kind: "entry", id}, after: drafts.person(id, name, extra)}]))[id]!;
    }

    async point(name: string, subject: string | null, fields: Record<string, unknown> = {}): Promise<string> {
        const id = `tmp:k${String(++this.#sequence)}`;
        return (await this.publish([{ref: {kind: "entry", id}, after: drafts.point(id, name, subject, fields)}]))[id]!;
    }

    async entry(entry: Omit<Entry, "id">): Promise<string> {
        const id = `tmp:e${String(++this.#sequence)}`;
        return (await this.publish([{ref: {kind: "entry", id}, after: {...entry, id}}]))[id]!;
    }

    async change(at: Placement, options: ChangeOptions = {}): Promise<string> {
        const id = `tmp:c${String(++this.#sequence)}`;
        return (await this.publish([{ref: {kind: "change", id}, after: drafts.change(id, at, options)}]))[id]!;
    }

    /** 为看的人开一张内核视图，在当前的快照上建剧情的视图；占位记进内核的审计。 */
    viewpoint(grant: ViewpointGrant): {readonly viewpoint: Viewpoint; readonly token: string} {
        const opened = this.service.openView({viewer: grant.viewer, line: "main", until: grant.until, purpose: "writer"});
        if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
        const snapshot = this.service.snapshot();
        const viewpoint = new Viewpoint(snapshot.view, snapshot.viewed(opened.token), grant, (method, blocked) => this.service.auditView(opened.token, {method, kind: "placeholder", blocked: blocked.map((id) => ({kind: "entry" as const, id}))}));
        return {viewpoint, token: opened.token};
    }

    stop(): Promise<void> {
        return this.service.stop();
    }
}
