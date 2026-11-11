/**
 * 能不能写（docs/specs/canon/author-ui.md 输出 27、28）：由读取层的世界状态与连接算出一句原因，可以写时为 null。三种页面、
 * 数据分页的 `context.blocked` 与各写入入口共用。独占事件已让读取层重读状态，独占结束后这里自动变回 null。
 */

import type {Text} from "@notnotype/nb-ui/text";

import {canonText} from "../shared/text";
import type {CanonWorld} from "./world";

export function writeBlocked(world: CanonWorld): Text | null {
    if (world.connection.value === "ended") return canonText("blocked.disconnected");
    const status = world.status.value.data;
    // 还没读到状态时不判断：第一次读取还没回来，界面上本来就没有写入入口。
    if (status === undefined) return null;
    if (status.state === "read-only") return canonText("blocked.readOnly", {reason: status.reason ?? ""});
    if (status.state === "stopped") return canonText("blocked.disconnected");
    if (status.exclusive !== null) return canonText("blocked.busy", {holder: status.exclusive.label});
    return null;
}
