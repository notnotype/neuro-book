/**
 * 登录、注册、补交同意成功之后进站（t10 计划 3.1“登录后的去向”）。登录续接（`continue`）归 B7。
 *
 * 进站不自己算去处：重取当前账号之后，对当前地址再走一遍守卫。这几页都是访客页（同意页是“缺同意”页），已登录的人进来本来就会被
 * 守卫按分派送走（`session/guard.ts`），带着的 `next` 也照同样的规则校验。去处只在分派一处算。
 */

import type {Router} from "vue-router";

import type {CurrentAccount} from "./account";

/**
 * - `entered`：已登录，守卫已把人送到去处。
 * - `anonymous`：重取之后仍是匿名（会话没建起来，例如浏览器没存下 Cookie）；人留在原页，由页面告诉他。
 * - `unavailable`：取不到身份；外壳会整页显示连不上与重试（`App.vue`），页面不必再显示。
 */
export type EnterOutcome = "entered" | "anonymous" | "unavailable";

/** 重取当前账号，对当前地址再走一遍守卫。跳转本身失败（守卫抛错）时 reject，由页面显示并记诊断。 */
export async function enterAfterSignIn(account: CurrentAccount, router: Router): Promise<EnterOutcome> {
    const state = await account.refresh();
    if (state.kind === "anonymous") return "anonymous";
    if (state.kind !== "signed-in") return "unavailable";
    const current = router.currentRoute.value;
    // 同一地址的导航要 `force` 才会发生。返回的导航失败（被更晚的导航取代）不算出错：那次更晚的导航同样走守卫。
    await router.replace({path: current.path, query: current.query, hash: current.hash, force: true});
    return "entered";
}
