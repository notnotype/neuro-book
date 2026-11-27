/**
 * 条目页 e2e 的公用辅助（docs/specs/canon/author-ui.md）：只按角色与元素标记定位，不读业务代码。
 */

import {expect} from "@playwright/test";
import type {Locator} from "@playwright/test";

/**
 * 换到条目页的一个分页（横排的 `Tabs` 或竖排导航里的一行）：已经选中就不点。选中的模块分页再点一下是打开看法菜单
 * （author-ui 输出 9），用例只是要“到这一页”时不能多点这一下，否则菜单盖在页面左上、挡住后面的点击。
 */
export async function selectTab(tab: Locator): Promise<void> {
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
}
