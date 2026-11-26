/**
 * 哪些网址算“到过一个网站”：越界导航（运行记录的 `navigation.offsite`）只在这些网址里找。
 *
 * 调度器收尾时按它记下越界的网址；报表读记录时再按它筛一遍，与判分一样以当前规则为准，
 * 运行时的规则比现在宽（例如把还没导航的新标签页也算进去）时不用重跑就能纠正。
 */

/** 不算网站的网址：空白页、Chrome 自己的错误页与内部页，以及刚建、还没开始导航的标签页（CDP 给的网址是空串）。 */
const NOT_A_SITE = /^(?:$|about:|chrome-error:|chrome:|devtools:|data:)/u;

export function isSiteUrl(url: string): boolean {
    return !NOT_A_SITE.test(url);
}
