/**
 * 系统托盘（docs/specs/runtime/desktop-shell.md 输出 28 到 30）：图标显示与否、提示文字，以及托盘“退出”之前取一次在跑的工作。
 * 只有纯函数与一次 HTTP 请求，图标本身由适配层建（`packages/neuro-book/desktop/`）。
 */

import {Value} from "typebox/value";

import type {CloseLastWindow} from "../shared/desktop-bridge";
import {RUNNING_WORK_PATH, RunningWorkReportSchema} from "../shared/running-work";
import {at} from "./deadline";
import type {DeadlineClock} from "./deadline";

export interface TrayInputs {
    /** 服务端是壳自己的、还没在意外退出后选“稍后”（与协调器的 `#ownsServer` 同义）。 */
    readonly owned: boolean;
    readonly mode: CloseLastWindow;
    readonly stopping: boolean;
    readonly windows: number;
    /** 托盘“退出”正在取在跑的工作。 */
    readonly checking: boolean;
}

export interface TrayView {
    readonly visible: boolean;
    readonly tooltip: string;
}

/** 托盘图标显示与否与提示文字（输出 28）。菜单与提示只有中文：壳没有页面的文字目录。 */
export function trayView(inputs: TrayInputs): TrayView {
    const visible = inputs.owned && inputs.mode === "tray" && !inputs.stopping;
    const tooltip = inputs.checking ? "NeuroBook（正在检查在跑的工作）" : inputs.windows === 0 ? "NeuroBook（在后台运行）" : "NeuroBook";
    return {visible, tooltip};
}

/** 取在跑的工作的结果：`count` 是取到的项数；`uncertain` 为真是有取不到的部分，或整个取不到。 */
export interface WorkCheck {
    readonly count: number;
    readonly uncertain: boolean;
}

/** 托盘退出取在跑的工作的截止（输出 30）。 */
export const WORK_CHECK_MS = 8_000;

/**
 * 向服务端取一次在跑的工作（server-host 的“在跑的工作”，`GET /api/runtime/work`）。连不上、非 2xx、不是 JSON、形状不对、
 * 截止前没有应答，都当整个取不到，并把原因交给 `report`。
 */
export async function checkRunningWork(serverUrl: string, options: {readonly clock: DeadlineClock; readonly deadlineMs?: number; readonly report: (event: string, error: unknown) => void}): Promise<WorkCheck> {
    const controller = new AbortController();
    const cancel = at(options.clock, options.clock.now() + (options.deadlineMs ?? WORK_CHECK_MS), () => controller.abort(new Error("no answer before the deadline")));
    try {
        const response = await fetch(new URL(RUNNING_WORK_PATH, serverUrl), {headers: {accept: "application/json"}, signal: controller.signal});
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const body: unknown = await response.json();
        if (!Value.Check(RunningWorkReportSchema, body)) throw new Error("the running-work answer has the wrong shape");
        return {count: body.items.length, uncertain: body.failed.length > 0};
    } catch (error) {
        options.report("desktop.tray.work-check-failed", error);
        return {count: 0, uncertain: true};
    } finally {
        cancel();
    }
}
