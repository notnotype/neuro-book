/**
 * 假站共用的零件：带种子的随机数、流程凭据、富文本转纯文本、页面模板。
 * 假站的状态只在调度器进程的内存里，评测直接读，不经 HTTP（执行者能连本机端口，不能让它读到答案）。
 */

import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

/** mulberry32：种子一样，生成的数据就一样（题集当固定的，同一题每次运行看到同一份数据）。 */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)] as T;
}

export type CredentialStatus = "valid" | "stale" | "missing";

/**
 * 流程凭据：页面走到关键一步（打开确认弹窗、打开投票的确认、保存草稿）时向服务端要一个一次性凭据，写接口带上它。
 * 凭据按“作用域”（一个弹窗或组件实例）各留最新的一个：同一作用域再发一次，旧的作废。
 * 只在写入生效时消耗：被校验拒绝（4xx）的请求不消耗，改对重发仍是有效凭据。
 */
export class CredentialBook {
    private readonly live = new Map<string, string>();

    issue(scope: string): string {
        const token = randomUUID();
        this.live.set(scope, token);
        return token;
    }

    status(scope: string, token: unknown): CredentialStatus {
        if (typeof token !== "string" || token === "") return "missing";
        return this.live.get(scope) === token ? "valid" : "stale";
    }

    /** 写入生效后调用；凭据不是这个作用域最新的一个时什么也不做。 */
    consume(scope: string, token: unknown): void {
        if (typeof token === "string" && this.live.get(scope) === token) this.live.delete(scope);
    }
}

const ENTITIES: Readonly<Record<string, string>> = {nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'"};

/**
 * 富文本正文转纯文本，取 `innerText` 的语义：`<br>` 与块的结束成换行，去掉标签，解开常见实体，
 * 每行里的连续空白折成一个，去掉行首行尾空白与空行。纯文本照样能过这一步，所以两种提交方式比的是同一种东西。
 */
export function richTextToPlain(html: string): string {
    const text = html
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<\/(p|div|li|h[1-6]|blockquote)>/giu, "\n")
        .replace(/<[^>]*>/gu, "")
        .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gu, (_, name: string) => ENTITIES[name] ?? "");
    return text.split("\n").map((line) => line.replace(/[ \t 　]+/gu, " ").trim()).filter((line) => line !== "").join("\n");
}

const PAGES = join(import.meta.dir, "pages");
const pageCache = new Map<string, string>();

/** 读 `pages/<站>/<名>.html`，把 `{{键}}` 换成给的值（值按 HTML 转义）；模板读一次后缓存。 */
export async function renderPage(site: string, name: string, values: Readonly<Record<string, string>> = {}): Promise<string> {
    const key = `${site}/${name}`;
    let template = pageCache.get(key);
    if (template === undefined) {
        template = await readFile(join(PAGES, site, `${name}.html`), "utf8");
        pageCache.set(key, template);
    }
    return template.replace(/\{\{(\w+)\}\}/gu, (whole, name: string) => (name in values ? escapeHtml(values[name] as string) : whole));
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/gu, (ch) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"})[ch] as string);
}
