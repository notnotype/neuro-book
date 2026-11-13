/**
 * 进程内测试起服务端：先真实地认领测试自己的临时状态根（毫秒级），再 `startServer`。与产品入口走同一个认领，
 * 不另做测试用的认领句柄。
 */

import {claimNeuroBook} from "nbook/server/instance";
import {startServer} from "nbook/server/start";
import type {RunningServer, StartServerOptions} from "nbook/server/start";

export async function startClaimedServer(options: Omit<StartServerOptions, "claim">): Promise<RunningServer> {
    const claimed = await claimNeuroBook({stateRoot: options.config.stateRoot, kind: "fixture", report: () => undefined});
    if (!claimed.ok) throw new Error(`测试状态根 ${options.config.stateRoot} 认领失败：${claimed.reason}`);
    return startServer({...options, claim: claimed.claim});
}
