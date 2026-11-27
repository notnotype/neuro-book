/**
 * 登录、注册、补交同意成功之后进站（t10 计划 3.1“登录后的去向”）。
 *
 * 响应带合格的继续地址（登录续接，`session/continue.ts`）时整页去那里，不走分派：那是服务端的授权端点，不是站点的页面。
 * 不带时不自己算去处：重取当前账号之后，对当前地址再走一遍守卫。这几页都是访客页（同意页是“缺同意”页），已登录的人进来本来就会被
 * 守卫按分派送走（`session/guard.ts`），带着的 `next` 也照同样的规则校验。去处只在分派一处算。
 */

import {CONTINUE_PARAM} from "@notnotype/nb-site-identity-contract/constants";
import type {Router} from "vue-router";

import type {SiteContext} from "../context";
import {continueTarget} from "./continue";

/**
 * - `entered`：已登录，守卫已把人送到去处。
 * - `continued`：去了继续地址，又从往返缓存回到了这一页（`SiteContext.leave` resolve）；页面放开按钮即可。
 * - `anonymous`：重取之后仍是匿名（会话没建起来，例如浏览器没存下 Cookie）；人留在原页，由页面告诉他。
 * - `unavailable`：取不到身份；外壳会整页显示连不上与重试（`App.vue`），页面不必再显示。
 */
export type EnterOutcome = "entered" | "continued" | "anonymous" | "unavailable";

/**
 * `continueUrl` 是这次成功响应里的继续地址（没有就是 `undefined`）。去继续地址之前不重取当前账号：页面随之卸载，回到站点时重新取。
 * 跳转本身失败（守卫抛错）时 reject，由页面显示并记诊断。
 */
export async function enterAfterSignIn(
    site: Pick<SiteContext, "account" | "origin" | "leave">,
    router: Router,
    continueUrl: string | undefined,
): Promise<EnterOutcome> {
    const target = continueTarget(continueUrl, site.origin);
    if (target !== undefined) {
        await site.leave(target);
        return "continued";
    }
    const state = await site.account.refresh();
    if (state.kind === "anonymous") return "anonymous";
    if (state.kind !== "signed-in") return "unavailable";
    const current = router.currentRoute.value;
    // 续接令牌这时已经没用了（服务端没给继续地址：令牌不合格或过期），从地址上去掉再走守卫：留着的话，登录页对带令牌的已登录用户
    // 放行（`GuardTarget.signedInWithContinue`），人会停在登录表单上。
    const {[CONTINUE_PARAM]: _spent, ...query} = current.query;
    // 同一地址的导航要 `force` 才会发生。返回的导航失败（被更晚的导航取代）不算出错：那次更晚的导航同样走守卫。
    await router.replace({path: current.path, query, hash: current.hash, force: true});
    return "entered";
}
