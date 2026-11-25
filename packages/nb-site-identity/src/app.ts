/**
 * 账号的子应用：挂在 `IDENTITY_API_PREFIX` 下的自家路由（w00037 t07 计划 3.6；ADR 0063）。全部接口都是自家路由，库的
 * `auth.handler` 不挂在这里。
 *
 * 登记的先后就是请求经过的先后：来源头 → 请求体大小 → 各路由 → 最后一条兜底路由。兜底路由覆盖前缀本身与前缀下的任何路径与
 * 方法，回 404 `not_found` 的 `ErrorBody`：子应用经 `app.route` 挂进入口应用时它自己的 `notFound` 不跟着走，没有兜底时未知的路径
 * 会落到入口的 404（`{"code":…}` 的形状，与账号的错误形状不同；omp 设计审查第 8 条）。兜底之后再登记的路由会被它挡住，所以它
 * 必须最后登记。
 */

import {Hono} from "hono";

import {IDENTITY_PATHS, type MetaResponse} from "@notnotype/nb-site-identity-contract";

import {bodySizeLimit, failureFor, failureResponse, readEmptyBody, respondFailure} from "./errors";
import type {IdentityLog} from "./index";
import {appendCookies, requireSameOrigin} from "./middleware";
import type {Sessions} from "./session";

export interface IdentityAppOptions {
    readonly sessions: Sessions;
    /** 站点地址的 origin，来源头要等于它。 */
    readonly siteOrigin: string;
    readonly termsVersion: string;
    readonly registrationOpen: boolean;
    readonly log: Pick<IdentityLog, "warn" | "error">;
}

export function createIdentityApp(options: IdentityAppOptions): Hono {
    const {sessions, log} = options;
    const app = new Hono();

    app.use("*", requireSameOrigin(options.siteOrigin));
    app.use("*", bodySizeLimit);

    // 问身份：任何人可调，不延长会话、不写库（`site.accounts` 输出 7）。与模块导出的 `whoami` 是同一个函数。
    app.get(IDENTITY_PATHS.whoami, (c) => sessions.whoami(c.req.raw));

    app.get(IDENTITY_PATHS.meta, (c) => {
        // 上游的开关由 t08 接上配置；本 Task 两个都没开放。
        const body: MetaResponse = {termsVersion: options.termsVersion, registrationOpen: options.registrationOpen, providers: {google: false, github: false}};
        return c.json(body);
    });

    // 登出：没有会话时也成功；删不成时出口回 503、不清 Cookie（`Sessions.logout`）。同意门槛放行它，所以不经 `requireSession`，
    // 也不延长一个马上就要结束的会话。
    app.post(IDENTITY_PATHS.logout, async (c) => {
        await readEmptyBody(c);
        appendCookies(c, await sessions.logout(c.req.header("Cookie") ?? null));
        return c.json({});
    });

    app.all("*", (c) => respondFailure(c, failureResponse("not_found")));
    app.onError((error, c) => respondFailure(c, failureFor(error, log)));
    return app;
}
