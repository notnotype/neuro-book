/**
 * 托盘（tray.ts，desktop-shell 输出 28、30）：图标与提示文字的组合；托盘退出取在跑的工作，对真实的 HTTP 服务（每种应答起一个）
 * 取。截止用手动时钟触发。
 */

import {afterAll, describe, expect, it} from "bun:test";

import {RUNNING_WORK_PATH} from "../shared/running-work";
import type {DeadlineClock} from "./deadline";
import {checkRunningWork, trayView, WORK_CHECK_MS} from "./tray";

describe("托盘视图", () => {
    const base = {owned: true, mode: "tray", stopping: false, windows: 1, checking: false} as const;

    it("自有服务端、设置是 tray、不在停止中才显示；连别人的实例、设置是 quit、停止中都不显示", () => {
        expect(trayView(base)).toEqual({visible: true, tooltip: "NeuroBook"});
        expect(trayView({...base, owned: false}).visible).toBe(false);
        expect(trayView({...base, mode: "quit"}).visible).toBe(false);
        expect(trayView({...base, stopping: true}).visible).toBe(false);
    });

    it("提示文字：有窗口、在后台、正在检查在跑的工作（检查中优先）", () => {
        expect(trayView({...base, windows: 0}).tooltip).toBe("NeuroBook（在后台运行）");
        expect(trayView({...base, windows: 0, checking: true}).tooltip).toBe("NeuroBook（正在检查在跑的工作）");
        expect(trayView({...base, windows: 2, checking: true}).tooltip).toBe("NeuroBook（正在检查在跑的工作）");
    });
});

describe("托盘退出取在跑的工作", () => {
    const servers: Array<ReturnType<typeof Bun.serve>> = [];
    afterAll(async () => {
        await Promise.all(servers.map((server) => server.stop(true)));
    });
    /** 起一个只在宿主接口的路径上给这个应答的服务，交回它的地址（与壳拿到的服务端地址同形）。 */
    function serve(answer: () => Response | Promise<Response>): string {
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (request) => (new URL(request.url).pathname === RUNNING_WORK_PATH ? answer() : new Response("no", {status: 404}))});
        servers.push(server);
        return `http://127.0.0.1:${String(server.port)}/`;
    }

    /** 手动时钟：`advance` 把时间往前拨，到点的计时随之触发。 */
    function manualClock() {
        let now = 0;
        const timers = new Set<{readonly due: number; readonly callback: () => void}>();
        const clock: DeadlineClock = {
            now: () => now,
            schedule(callback, ms) {
                const timer = {due: now + ms, callback};
                timers.add(timer);
                return () => void timers.delete(timer);
            },
        };
        const advance = (ms: number): void => {
            now += ms;
            for (const timer of [...timers]) if (timer.due <= now && timers.delete(timer)) timer.callback();
        };
        return {clock, advance, pending: () => timers.size};
    }
    const reports: string[] = [];
    const check = (url: string, clock = manualClock().clock) => checkRunningWork(url, {clock, report: (event) => reports.push(event)});

    it("取到：项数是 items 的条数；有取不到的部分时 uncertain；结算后不留计时", async () => {
        const manual = manualClock();
        expect(await check(serve(() => Response.json({items: [], failed: []})), manual.clock)).toEqual({count: 0, uncertain: false});
        expect(manual.pending()).toBe(0);
        expect(await check(serve(() => Response.json({items: [{plugin: "a", project: null, text: "x"}, {plugin: "b", project: "p", text: "y"}], failed: []})))).toEqual({count: 2, uncertain: false});
        expect(await check(serve(() => Response.json({items: [{plugin: "a", project: null, text: "x"}], failed: [{plugin: null, project: "q"}]})))).toEqual({count: 1, uncertain: true});
    });

    it("形状不对、非 2xx、不是 JSON、连不上：整个取不到，记诊断", async () => {
        reports.length = 0;
        const answers = [() => Response.json({items: "none"}), () => new Response("busy", {status: 503}), () => new Response("not json")];
        for (const answer of answers) expect(await check(serve(answer))).toEqual({count: 0, uncertain: true});
        const closed = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Response("")});
        const url = `http://127.0.0.1:${String(closed.port)}/`;
        await closed.stop(true);
        expect(await check(url)).toEqual({count: 0, uncertain: true});
        expect(reports).toEqual(Array.from({length: 4}, () => "desktop.tray.work-check-failed"));
    });

    it("截止前没有应答：到点放弃，当取不到", async () => {
        const manual = manualClock();
        const pending = check(serve(() => new Promise<Response>(() => undefined)), manual.clock);
        manual.advance(WORK_CHECK_MS - 1);
        expect(manual.pending()).toBe(1);
        manual.advance(1);
        expect(await pending).toEqual({count: 0, uncertain: true});
    });
});
