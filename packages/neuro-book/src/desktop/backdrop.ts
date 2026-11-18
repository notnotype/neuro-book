/**
 * 窗口背景（docs/specs/runtime/desktop-shell.md 输出 32）：设置值换成这个窗口实际要不要、要哪一种。纯函数，壳在建每个窗口前调一次。
 *
 * 只在 Windows 11 22H2（build 22621）以上：系统背景属性 `DWMWA_SYSTEMBACKDROP_TYPE` 从这一版起有。更早的系统上设置照样能选，
 * 但窗口按普通窗口建，不报错：设置是用户层的，状态根可能被带到另一台机器。
 */

import type {WindowBackdrop} from "../shared/desktop-bridge";

/** `DWMWA_SYSTEMBACKDROP_TYPE` 的值：`DWMSBT_MAINWINDOW`（Mica）与 `DWMSBT_TRANSIENTWINDOW`（Acrylic）。 */
export const DWM_BACKDROP_TYPE = {mica: 2, acrylic: 3} as const;

/** 支持系统背景属性的最低 Windows build（11 22H2）。 */
export const MIN_BACKDROP_BUILD = 22621;

/** `os.release()` 在 Windows 上是 `10.0.<build>`；认不出来时为 null。 */
export function windowsBuild(release: string): number | null {
    const match = /^\d+\.\d+\.(\d+)/u.exec(release);
    return match === null ? null : Number(match[1]);
}

/** 这个窗口要用的背景；不是 Windows、系统太旧、没有自画外框（没有 `transparent` 的位置）或设置是 `off` 时为 null。 */
export function backdropFor(setting: WindowBackdrop, facts: {readonly platform: string; readonly release: string; readonly customFrame: boolean}): "mica" | "acrylic" | null {
    if (setting === "off" || facts.platform !== "win32" || !facts.customFrame) return null;
    const build = windowsBuild(facts.release);
    return build !== null && build >= MIN_BACKDROP_BUILD ? setting : null;
}
