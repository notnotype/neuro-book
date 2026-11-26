/**
 * 搜索与读取服务的接口（docs/specs/web/tools.md 输出 1 到 12）。每家一个实现文件（`deepseek.ts`、`tavily.ts`），加服务时多一个
 * 文件、在服务端入口的服务表里多一项，工具不改。客户端从不抛错：失败都在结果里，按分类给码，详情已经遮盖过密钥。
 */

import type {ProviderFailureCode, WebProviderId} from "../../shared/contracts";

export interface SearchRequest {
    readonly query: string;
    readonly count: number;
    readonly sites?: readonly string[];
    readonly after?: string;
    readonly before?: string;
    /** Tavily 的搜索深度（设置项 `nbook.web/tavilySearchDepth`）；别家不认，缺省 `basic`。 */
    readonly depth?: "basic" | "advanced";
    /** 屏蔽网站（设置项 `nbook.web/blockedSites`）：服务有原生参数的交给它，结果由工具再在本地筛一遍（输出 3）。 */
    readonly excludeSites?: readonly string[];
}

export interface SearchHit {
    readonly title: string;
    readonly url: string;
    readonly summary: string;
    readonly date?: string;
    readonly site?: string;
    readonly score?: number;
}

export interface Page {
    readonly url: string;
    readonly title: string;
    readonly markdown: string;
}

export interface ProviderFailure {
    readonly ok: false;
    readonly code: ProviderFailureCode;
    /** 服务错误响应里的 `error.message`，遮盖过密钥、截到 500 字；没有就不给。 */
    readonly detail?: string;
    readonly status?: number;
    /** 服务给的请求 id，只进诊断。 */
    readonly requestId?: string;
}

export type Outcome<T> = {readonly ok: true; readonly value: T} | ProviderFailure;

/** 一次工具调用交给客户端的范围：`signal` 在调用被中止或到总截止时触发，`deadline` 是总截止的时刻（毫秒）。 */
export interface CallScope {
    readonly signal: AbortSignal;
    readonly deadline: number;
    /** `false`：429 也不重试（设置页的检测，输出 19）。 */
    readonly retry?: false;
}

export interface WebProvider {
    readonly id: WebProviderId;
    /** 写在文字结果第一行，例如“DeepSeek”。 */
    readonly label: string;
    /**
     * 这家服务收不收这条查询（日期格式、连同过滤的长度），不收时交回一句哪里不对的说明。工具在发出任何一条查询之前先逐条问它，
     * 有一条不收就一条也不发（输出 1）；`search` 自己也会再查一遍。
     */
    validateSearch(request: SearchRequest): string | null;
    search(request: SearchRequest, key: string, scope: CallScope): Promise<Outcome<readonly SearchHit[]>>;
    fetch(url: string, key: string, scope: CallScope): Promise<Outcome<Page>>;
}
