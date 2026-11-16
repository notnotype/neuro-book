import {describe, expect, it} from "vitest";

import {defaultRegistry, waitForRegistry} from "#scripts/release/registry-wait";

const REGISTRY = "https://registry.example/";

/** 按轮次回答的 registry：`rounds[name][i]` 是第 i 轮对这个包的回答，轮次用完后一直回最后一个。 */
function registry(rounds: Record<string, Array<string[] | number | Error>>) {
    const asked = new Map<string, number>();
    const urls: string[] = [];
    const accepts: string[] = [];
    const fetch = async (url: string, init: {headers: Record<string, string>}): Promise<Response> => {
        urls.push(url);
        accepts.push(init.headers.accept ?? "");
        const name = decodeURIComponent(url.slice(REGISTRY.length));
        const index = asked.get(name) ?? 0;
        asked.set(name, index + 1);
        const answers = rounds[name] ?? [404];
        const answer = answers[Math.min(index, answers.length - 1)];
        if (answer instanceof Error) throw answer;
        if (typeof answer === "number") return new Response("{}", {status: answer});
        return Response.json({name, versions: Object.fromEntries((answer as string[]).map((version) => [version, {}]))});
    };
    return {fetch, urls, accepts};
}

function clock() {
    let time = 0;
    return {now: () => time, sleep: async (ms: number) => void (time += ms)};
}

describe("等 registry 上能取到要验的版本", () => {
    it("版本晚几轮才出现：等到全部出现才返回，每轮报一次还缺的", async () => {
        const fake = registry({"@x/app": [["0.1.0"], ["0.1.0"], ["0.1.0", "0.2.0"]], "@x/lib": [["0.3.0"]]});
        const reports: string[][] = [];
        const time = clock();
        await waitForRegistry(new Map([["@x/app", "0.2.0"], ["@x/lib", "0.3.0"]]), {registry: REGISTRY, timeoutMs: 600_000, intervalMs: 30_000, fetch: fake.fetch, ...time, report: (missing) => reports.push([...missing])});
        expect(reports).toEqual([["@x/app@0.2.0"], ["@x/app@0.2.0"]]);
        expect(time.now()).toBe(60_000);
        // 已经看到的不再问；查的是 bun 安装时读的缩略元数据。
        expect(fake.urls.filter((url) => url.endsWith("lib"))).toHaveLength(1);
        expect(fake.urls[0]).toBe("https://registry.example/@x%2fapp");
        expect(fake.accepts.every((accept) => accept.startsWith("application/vnd.npm.install-v1+json"))).toBe(true);
    });

    it("registry 偶尔回 5xx 或连不上：只算这一轮没看到，之后出现照样通过", async () => {
        const fake = registry({"@x/app": [503, new Error("socket hang up"), ["0.2.0"]]});
        await waitForRegistry(new Map([["@x/app", "0.2.0"]]), {registry: REGISTRY, timeoutMs: 600_000, intervalMs: 30_000, fetch: fake.fetch, ...clock()});
        expect(fake.urls).toHaveLength(3);
    });

    it("到时间仍没出现：失败，列出每个缺的版本最后一次看到的情况", async () => {
        const fake = registry({"@x/app": [["0.1.0"]], "@x/new": [404], "@x/lib": [["0.3.0"]]});
        const time = clock();
        const waiting = waitForRegistry(new Map([["@x/app", "0.2.0"], ["@x/new", "0.1.0"], ["@x/lib", "0.3.0"]]), {registry: REGISTRY, timeoutMs: 120_000, intervalMs: 30_000, fetch: fake.fetch, ...time});
        await expect(waiting).rejects.toThrow("等了 2 分钟，registry 上仍取不到：@x/app@0.2.0（元数据里还没有这个版本）、@x/new@0.1.0（registry 上没有这个包）");
        expect(time.now()).toBeLessThanOrEqual(120_000);
    });
});

describe("缺省的 registry", () => {
    it("先认 NPM_CONFIG_REGISTRY，补上结尾的斜杠；没配时是 npmjs", () => {
        expect(defaultRegistry({NPM_CONFIG_REGISTRY: "https://mirror.example/npm"})).toBe("https://mirror.example/npm/");
        expect(defaultRegistry({})).toBe("https://registry.npmjs.org/");
    });
});
