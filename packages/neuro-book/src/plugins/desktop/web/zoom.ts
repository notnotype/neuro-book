/**
 * 桌面窗口的界面缩放（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）：档位换算、快捷键与 Ctrl+滚轮的判定、改档。
 *
 * 改档先把目标档位交给壳（界面立即变），再在防抖里写用户层；防抖期间再改，从目标档位接着算，不从还没写回的旧值算，所以连按
 * 几下不会丢档或回弹。写回失败时说明原因，把壳拉回配置服务里的值。快捷键不写进命令声明：声明只能写一个键位，分发器按
 * `event.key` 精确比对，Ctrl+Shift+=、小键盘与别的键盘布局都命不中；这里按 `event.code` 认。
 */

import type {DesktopSettingValues} from "nbook/shared/desktop-bridge";
import type {SettingsService} from "nbook/shared/settings";

import {DEFAULT_ZOOM, desktopSettings, ZOOM_LEVELS} from "../shared/contracts";
import type {ZoomLevel} from "../shared/contracts";

export type ZoomAction = "in" | "out" | "reset";

/** 离 `current` 最近的档位往 `direction` 走一档，到头不动。 */
export function steppedZoom(current: number, direction: 1 | -1): ZoomLevel {
    let nearest = 0;
    for (let index = 1; index < ZOOM_LEVELS.length; index += 1) {
        if (Math.abs(ZOOM_LEVELS[index]! - current) < Math.abs(ZOOM_LEVELS[nearest]! - current)) nearest = index;
    }
    return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, nearest + direction))]!;
}

/** 判定用到的按键字段（这个文件也在后端的类型检查范围里，没有 DOM 类型）。 */
export interface ZoomKey {
    readonly code: string;
    readonly key: string;
    readonly isComposing: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/**
 * 按键对应的缩放动作：要按住 Ctrl、不按 Alt 与 Meta，Shift 不限，输入法组字时不算。先按物理键位（数字行与小键盘的加、减、0），
 * 认不到再按字符（`+`、`=`、`-`、`0`），别的键盘布局里这几个字符不在美式的位置上。小键盘的 0 在 NumLock 关着时是 Insert
 * （Ctrl+Insert 是复制），不算复位。
 */
export function zoomKeyAction(event: ZoomKey): ZoomAction | null {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;
    switch (event.code) {
        case "Equal":
        case "NumpadAdd":
            return "in";
        case "Minus":
        case "NumpadSubtract":
            return "out";
        case "Digit0":
            return "reset";
        case "Numpad0":
            return event.key === "0" ? "reset" : null;
        default:
            break;
    }
    switch (event.key) {
        case "+":
        case "=":
            return "in";
        case "-":
            return "out";
        case "0":
            return "reset";
        default:
            return null;
    }
}

/** 滚轮累积满这么多才换一档：触控板的捏合会合成大量细小的 Ctrl+滚轮事件。 */
export const WHEEL_STEP = 100;

/** Ctrl+滚轮的累积：交回这次要换的方向，没满一档时为 null。换了方向先清零。 */
export function createWheelAccumulator(): (deltaY: number) => ZoomAction | null {
    let total = 0;
    return (deltaY) => {
        if (deltaY === 0) return null;
        if (Math.sign(deltaY) !== Math.sign(total)) total = 0;
        total += deltaY;
        if (Math.abs(total) < WHEEL_STEP) return null;
        total = 0;
        return deltaY < 0 ? "in" : "out";
    };
}

/** 写回的防抖时长。 */
export const ZOOM_WRITE_DELAY_MS = 300;

export interface ZoomControllerOptions {
    readonly settings: SettingsService;
    /** 把有效值交给壳。 */
    readonly report: (values: DesktopSettingValues) => void;
    /** 写回失败时告诉用户；`detail` 是失败原因。 */
    readonly failed: (detail: string) => void;
    readonly schedule: (callback: () => void, ms: number) => () => void;
}

export interface ZoomController {
    /** 交给壳的值：防抖期间缩放是目标档位，其余是配置服务里的有效值。 */
    values(): DesktopSettingValues;
    apply(action: ZoomAction): void;
    /** 页面要离开了：还没写回的档位立刻写，不等防抖。 */
    flush(): void;
    dispose(): void;
}

export function createZoomController(options: ZoomControllerOptions): ZoomController {
    const {settings} = options;
    let target: ZoomLevel | null = null;
    let cancel: (() => void) | null = null;
    const values = (): DesktopSettingValues => ({
        zoom: target ?? settings.get(desktopSettings.zoom),
        openAtLogin: settings.get(desktopSettings.openAtLogin),
        closeLastWindow: settings.get(desktopSettings.closeLastWindow),
        windowBackdrop: settings.get(desktopSettings.windowBackdrop),
    });
    const write = async (): Promise<void> => {
        cancel = null;
        const wanted = target;
        if (wanted === null) return;
        // 复位写“删掉用户层的值”，回到缺省，而不是把缺省值写进文件。
        let failure: string | null = null;
        try {
            const result = await settings.update(desktopSettings.zoom, wanted === DEFAULT_ZOOM ? undefined : wanted, {layer: "user"});
            if (!result.ok) failure = result.detail;
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
        }
        // 写的过程中又改了档：那一次的防抖会再写，这次的结果不动目标。
        if (target !== wanted) return;
        target = null;
        if (failure !== null) {
            options.failed(failure);
            options.report(values());
        }
    };
    return {
        values,
        apply(action) {
            const current = target ?? settings.get(desktopSettings.zoom);
            const next = action === "reset" ? DEFAULT_ZOOM : steppedZoom(current, action === "in" ? 1 : -1);
            if (next === current) return;
            target = next;
            options.report(values());
            cancel?.();
            cancel = options.schedule(() => void write(), ZOOM_WRITE_DELAY_MS);
        },
        flush() {
            if (cancel === null) return;
            cancel();
            void write();
        },
        dispose() {
            cancel?.();
            cancel = null;
        },
    };
}
