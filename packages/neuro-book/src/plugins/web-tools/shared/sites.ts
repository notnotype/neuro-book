/**
 * 屏蔽网站一项的写法（docs/specs/web/tools.md 输出 3、settings-page.md 输出 12）：小写的域名（ASCII，国际化域名写成 punycode）或
 * IPv4 地址，至少两段，不带协议、端口、路径与末尾的点。设置页写入前、工具读设置时都经 `normalizeSite`：设置文件里手写错的项只跳过这一项，
 * 不让整份名单失效。前后端共用，不碰 DOM、Bun 与 Node。
 */

const SITE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

/** 粘贴的网址只留主机，经 URL 转小写与 punycode，去掉末尾的点；归一化后不像域名（含空白、单段、IP 字面量）时为 null。 */
export function normalizeSite(input: string): string | null {
    const trimmed = input.trim();
    if (trimmed === "" || /\s/u.test(trimmed)) return null;
    let host: string;
    try {
        host = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`).hostname;
    } catch {
        return null;
    }
    const bare = host.replace(/\.$/u, "");
    return SITE.test(bare) ? bare : null;
}

/** 名单归一化：写错的项跳过，去重，保持原来的先后。 */
export function normalizeSites(values: readonly string[]): string[] {
    const sites: string[] = [];
    for (const value of values) {
        const site = normalizeSite(value);
        if (site !== null && !sites.includes(site)) sites.push(site);
    }
    return sites;
}

/** 网址的主机是不是名单里的一项或它的子域名（输出 3）：`csdn.net` 也挡 `blog.csdn.net`，不挡 `notcsdn.net`；末尾的点不算。 */
export function siteBlocked(href: string, sites: readonly string[]): boolean {
    if (sites.length === 0) return false;
    let host: string;
    try {
        host = new URL(href).hostname.toLowerCase().replace(/\.$/u, "");
    } catch {
        return false;
    }
    return sites.some((site) => host === site || host.endsWith(`.${site}`));
}
