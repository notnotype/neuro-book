/**
 * 观察者：另开一条只读的 CDP 连接，在执行开始、每个步骤事件之后与执行结束时，给页面目标各截一张图，
 * 并记下这时有哪些页面目标与网址。两边的执行者用同一个观察者，截图交给评判器时写明是“动作之后”。
 *
 * 不抢焦点（不调 `bringToFront`）、不改网络与下载设置。一轮里各目标并行截；`about:blank` 不截，后台标签页
 * （`document.visibilityState` 是 hidden）记为 `hidden` 不截：试飞里截图超时的几乎都是这两种。页面上有没处理的对话框时
 * 页面里的求值与截图都不返回，记为 `timeout` 丢帧，不算评测部件出错。
 *
 * 一次只截一轮。截图时又来了新的步骤：排着的那一轮让给最新的一步（记 `superseded`），它的调用方拿到的是最新那一轮的
 * 页面目标。这样截图跟得上步骤，不会越排越晚、把后来的页面贴到早先的步骤上。
 */

import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {RunScreenshot} from "../record/schema";
import {CdpError} from "./cdp";
import type {CdpClient} from "./cdp";

export interface PageTarget {
    readonly targetId: string;
    readonly url: string;
}

const SCREENSHOT_TIMEOUT_MS = 8_000;
const VISIBILITY_TIMEOUT_MS = 1_000;

interface Waiter {
    resolve(targets: PageTarget[]): void;
    reject(error: unknown): void;
}

export class Observer {
    private readonly sessions = new Map<string, string>();
    private readonly lastDigest = new Map<string, string>();
    private readonly shots: RunScreenshot[] = [];
    private pending: {after: RunScreenshot["after"]; waiters: Waiter[]} | null = null;
    private running = false;
    private spentMs = 0;
    private count = 0;

    constructor(private readonly cdp: CdpClient, private readonly dir: string) {}

    /** 截一轮；交回这一轮看到的页面目标。截图时又来了新的调用，排着的那一轮让给最新的（见模块说明）。 */
    capture(after: RunScreenshot["after"]): Promise<PageTarget[]> {
        return new Promise<PageTarget[]>((resolve, reject) => {
            const waiter = {resolve, reject};
            if (this.pending === null) {
                this.pending = {after, waiters: [waiter]};
            } else {
                this.shots.push({file: null, after: this.pending.after, at: performance.now(), targetId: "", dropped: "superseded"});
                this.pending = {after, waiters: [...this.pending.waiters, waiter]};
            }
            if (!this.running) void this.drain();
        });
    }

    private async drain(): Promise<void> {
        this.running = true;
        while (this.pending !== null) {
            const job = this.pending;
            this.pending = null;
            try {
                const targets = await this.round(job.after);
                for (const waiter of job.waiters) waiter.resolve(targets);
            } catch (error) {
                for (const waiter of job.waiters) waiter.reject(error);
            }
        }
        this.running = false;
    }

    screenshots(): RunScreenshot[] {
        return [...this.shots];
    }

    /** 截图花掉的累计时间（毫秒），单列在报告里，看有没有拖慢执行者。 */
    observerMs(): number {
        return Math.round(this.spentMs);
    }

    private async round(after: RunScreenshot["after"]): Promise<PageTarget[]> {
        const started = performance.now();
        await mkdir(this.dir, {recursive: true});
        const {targetInfos} = await this.cdp.send<{targetInfos: Array<{targetId: string; type: string; url: string}>}>("Target.getTargets");
        const pages = targetInfos.filter((target) => target.type === "page");
        await Promise.all(pages.filter((page) => page.url !== "about:blank").map((page) => this.shoot(page.targetId, after)));
        this.spentMs += performance.now() - started;
        return pages.map(({targetId, url}) => ({targetId, url}));
    }

    private async shoot(targetId: string, after: RunScreenshot["after"]): Promise<void> {
        const at = performance.now();
        const record = (file: string | null, dropped: RunScreenshot["dropped"]) => this.shots.push({file, after, at, targetId, dropped});
        try {
            let sessionId = this.sessions.get(targetId);
            if (sessionId === undefined) {
                sessionId = (await this.cdp.send<{sessionId: string}>("Target.attachToTarget", {targetId, flatten: true})).sessionId;
                this.sessions.set(targetId, sessionId);
            }
            const visibility = await this.cdp.send<{result: {value?: unknown}}>("Runtime.evaluate", {expression: "document.visibilityState", returnByValue: true}, {sessionId, timeoutMs: VISIBILITY_TIMEOUT_MS});
            if (visibility.result.value === "hidden") {
                record(null, "hidden");
                return;
            }
            const {data} = await this.cdp.send<{data: string}>("Page.captureScreenshot", {format: "png"}, {sessionId, timeoutMs: SCREENSHOT_TIMEOUT_MS});
            const digest = createHash("sha1").update(data).digest("hex");
            if (this.lastDigest.get(targetId) === digest) {
                record(null, "same-as-previous");
                return;
            }
            this.lastDigest.set(targetId, digest);
            this.count += 1;
            const file = `${String(this.count).padStart(3, "0")}-${after}-${targetId.slice(0, 8)}.png`;
            await writeFile(join(this.dir, file), Buffer.from(data, "base64"));
            record(file, null);
        } catch (error) {
            if (error instanceof CdpError && error.kind === "timeout") {
                record(null, "timeout");
                return;
            }
            if (error instanceof CdpError && error.kind === "protocol") {
                // 目标在两次调用之间关掉了（执行者关了标签页）：会话也作废。
                this.sessions.delete(targetId);
                record(null, "target-gone");
                return;
            }
            throw error;
        }
    }
}
