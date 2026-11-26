/**
 * 观察者：另开一条只读的 CDP 连接，在执行开始、每一步工具调用结束后与执行结束时，给所有页面目标各截一张图，
 * 并记下这时有哪些页面目标与网址。两边的执行者用同一个观察者，截图交给评判器时写明是“动作之后”。
 *
 * 不抢焦点（不调 `bringToFront`）、不改网络与下载设置。截图一次只做一轮：步骤事件来得比截图快时，
 * 后来的排在前一轮之后。截图超时（页面上有没处理的对话框时 `Page.captureScreenshot` 不返回）记为丢帧，
 * 不算评测部件出错，也不阻塞后面的步骤。
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

export class Observer {
    private readonly sessions = new Map<string, string>();
    private readonly lastDigest = new Map<string, string>();
    private readonly shots: RunScreenshot[] = [];
    private chain: Promise<unknown> = Promise.resolve();
    private spentMs = 0;
    private count = 0;

    constructor(private readonly cdp: CdpClient, private readonly dir: string) {}

    /** 截一轮；交回这时的页面目标。几次调用按先后排队，一轮做完才开始下一轮。 */
    capture(after: RunScreenshot["after"]): Promise<PageTarget[]> {
        const run = this.chain.then(() => this.round(after));
        this.chain = run.catch(() => undefined);
        return run;
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
        for (const page of pages) await this.shoot(page.targetId, after);
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
