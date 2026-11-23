import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startHttpProxy} from "../testing/http-proxy";
import type {HttpProxy} from "../testing/http-proxy";
import {createEgress, EgressError, runSystemCommand} from "./egress";
import type {EgressOptions, ProxySetting} from "./egress";
import {bypassMatches, isLocalHost, parseProxy} from "./rules";
import {parseGsettings, parseKioslaverc, parseScutil, parseWindowsRegistry, readSystemProxy} from "./system";
import type {RunCommand} from "./system";

const GSETTINGS_MANUAL = `org.gnome.system.proxy autoconfig-url ''
org.gnome.system.proxy ignore-hosts ['localhost', '127.0.0.0/8', '::1', '*.corp.example']
org.gnome.system.proxy mode 'manual'
org.gnome.system.proxy use-same-proxy true
org.gnome.system.proxy.ftp host ''
org.gnome.system.proxy.ftp port 0
org.gnome.system.proxy.http authentication-password ''
org.gnome.system.proxy.http authentication-user ''
org.gnome.system.proxy.http enabled false
org.gnome.system.proxy.http host 'proxy.example'
org.gnome.system.proxy.http port 3128
org.gnome.system.proxy.http use-authentication false
org.gnome.system.proxy.https host 'secure.example'
org.gnome.system.proxy.https port 3129
org.gnome.system.proxy.socks host ''
org.gnome.system.proxy.socks port 0
`;

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : 10.1.1.1
  HTTPSEnable : 1
  HTTPSPort : 8443
  HTTPSProxy : 10.1.1.2
}
`;

const REG = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    DisableCachingOfSSLPages    REG_DWORD    0x0
    IE5_UA_Backup_Flag    REG_SZ    5.0
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride    REG_SZ    localhost;127.*;10.*;<local>
`;

describe("规则", () => {
    it("本机与私网地址按主机串判定，含 IPv4 映射的 IPv6", () => {
        const local = ["localhost", "app.localhost", "127.0.0.1", "127.5.6.7", "10.0.0.8", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.0.1", "0.0.0.0", "[::1]", "[::]", "[fd00::1]", "[fe80::1]", "[::ffff:127.0.0.1]", new URL("http://[::ffff:10.0.0.1]/").hostname];
        const remote = ["api.example.com", "172.32.0.1", "8.8.8.8", "[2001:db8::1]", "[::ffff:8.8.8.8]", "localhost.example.com", "10.0.0.1.example.com"];
        expect(local.filter((host) => !isLocalHost(host))).toEqual([]);
        expect(remote.filter((host) => isLocalHost(host))).toEqual([]);
    });

    it("旁路清单：通配、子域名、端口、网段、<local>", () => {
        const url = (href: string): URL => new URL(href);
        expect(bypassMatches(["example.com"], url("https://example.com/"))).toBe(true);
        expect(bypassMatches(["example.com"], url("https://api.example.com/"))).toBe(true);
        expect(bypassMatches([".example.com"], url("https://example.com/"))).toBe(false);
        expect(bypassMatches(["*.example.com"], url("https://a.example.com/"))).toBe(true);
        expect(bypassMatches(["example.com"], url("https://notexample.com/"))).toBe(false);
        expect(bypassMatches(["example.com:8443"], url("https://example.com:8443/"))).toBe(true);
        expect(bypassMatches(["example.com:8443"], url("https://example.com/"))).toBe(false);
        expect(bypassMatches(["203.0.113.0/24"], url("http://203.0.113.9/"))).toBe(true);
        expect(bypassMatches(["203.0.113.0/24"], url("http://203.0.114.9/"))).toBe(false);
        expect(bypassMatches(["203.0/16"], url("http://203.0.9.9/"))).toBe(true);
        expect(bypassMatches(["128.0.0.0/1"], url("http://200.1.1.1/"))).toBe(true);
        expect(bypassMatches(["128.0.0.0/1"], url("http://100.1.1.1/"))).toBe(false);
        expect(bypassMatches(["<local>"], url("http://intranet/"))).toBe(true);
        expect(bypassMatches(["<local>"], url("http://intranet.example/"))).toBe(false);
        expect(bypassMatches(["203.*"], url("http://203.1.2.3/"))).toBe(true);
        expect(bypassMatches(["*"], url("http://anything.example/"))).toBe(true);
        expect(bypassMatches([], url("http://anything.example/"))).toBe(false);
        // IPv6：网段、带方括号与端口、不带方括号的字面量，按规范化后的地址比。
        expect(bypassMatches(["2001:db8:1111::/48"], url("http://[2001:db8:1111::1]/"))).toBe(true);
        expect(bypassMatches(["2001:db8:1111::/48"], url("http://[2001:db8:2222::1]/"))).toBe(false);
        expect(bypassMatches(["[2001:db8::1]:8080"], url("http://[2001:db8::1]:8080/"))).toBe(true);
        expect(bypassMatches(["[2001:db8::1]:8080"], url("http://[2001:db8::1]/"))).toBe(false);
        expect(bypassMatches(["2001:0db8:0:0::1"], url("http://[2001:db8::1]/"))).toBe(true);
    });

    it("代理地址：省略协议按 http 补；只收 http 与 https；带用户名密码的给人看时去掉", () => {
        expect(parseProxy("proxy.example:3128")).toEqual({ok: true, address: {url: "http://proxy.example:3128/", origin: "http://proxy.example:3128", hasCredentials: false}});
        expect(parseProxy("https://u:p@proxy.example:443")).toEqual({ok: true, address: {url: "https://u:p@proxy.example/", origin: "https://proxy.example", hasCredentials: true}});
        expect(parseProxy("socks5://127.0.0.1:1080")).toEqual({ok: false, reason: "unsupported"});
        expect(parseProxy("socks5h://127.0.0.1:1080")).toEqual({ok: false, reason: "unsupported"});
        expect(parseProxy("")).toEqual({ok: false, reason: "invalid"});
        expect(parseProxy("http://")).toEqual({ok: false, reason: "invalid"});
    });
});

describe("系统设置的读法（喂各平台命令的原样输出）", () => {
    it("GNOME 手动：各协议的地址与例外；自动是不支持的脚本；没设", () => {
        expect(parseGsettings(GSETTINGS_MANUAL)).toEqual({kind: "manual", http: "proxy.example:3128", https: "secure.example:3129", bypass: ["localhost", "127.0.0.0/8", "::1", "*.corp.example"]});
        expect(parseGsettings("org.gnome.system.proxy mode 'auto'\norg.gnome.system.proxy autoconfig-url 'http://wpad/wpad.dat'\n")).toEqual({kind: "pac"});
        expect(parseGsettings("org.gnome.system.proxy mode 'none'\n")).toEqual({kind: "none"});
        expect(parseGsettings("something else\n")).toBeNull();
        // 只设了 HTTP、开了认证：HTTPS 也用它（GNOME 自己的回退），认证写进地址。
        const httpOnly = "org.gnome.system.proxy mode 'manual'\norg.gnome.system.proxy.http host 'proxy.example'\norg.gnome.system.proxy.http port 3128\norg.gnome.system.proxy.http use-authentication true\norg.gnome.system.proxy.http authentication-user 'ann'\norg.gnome.system.proxy.http authentication-password 'p@ss'\n";
        expect(parseGsettings(httpOnly)).toEqual({kind: "manual", http: "http://ann:p%40ss@proxy.example:3128", https: "http://ann:p%40ss@proxy.example:3128", bypass: []});
    });

    it("KDE：手动的两种地址写法与例外；脚本与自动发现；用环境变量算没设", () => {
        const manual = "[General]\nfoo=1\n\n[Proxy Settings]\nNoProxyFor=localhost,.corp.example\nProxyType=1\nhttpProxy=http://proxy.example 3128\nhttpsProxy=http://proxy.example:3129\nsocksProxy=\n";
        expect(parseKioslaverc(manual)).toEqual({kind: "manual", http: "http://proxy.example:3128", https: "http://proxy.example:3129", bypass: ["localhost", ".corp.example"]});
        expect(parseKioslaverc("[Proxy Settings]\nProxyType=2\nProxy Config Script=http://wpad/x.pac\n")).toEqual({kind: "pac"});
        expect(parseKioslaverc("[Proxy Settings]\nProxyType=3\n")).toEqual({kind: "pac"});
        expect(parseKioslaverc("[Proxy Settings]\nProxyType=4\n")).toEqual({kind: "none"});
        expect(parseKioslaverc("[Proxy Settings]\nProxyType=9\n")).toBeNull();
        expect(parseKioslaverc("[Proxy Settings]\nProxyType=1\nReversedException=true\nNoProxyFor=in-scope.example\nhttpProxy=http://proxy.example:3128\n")).toMatchObject({kind: "unsupported"});
    });

    it("macOS：开着的协议与例外；开了自动配置就按脚本", () => {
        expect(parseScutil(SCUTIL)).toEqual({kind: "manual", http: "10.1.1.1:8080", https: "10.1.1.2:8443", bypass: ["*.local", "169.254/16"]});
        expect(parseScutil("<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 8080\n  HTTPProxy : 10.1.1.1\n  ProxyAutoConfigEnable : 1\n}\n")).toEqual({kind: "pac"});
        expect(parseScutil("<dictionary> {\n  HTTPEnable : 0\n}\n")).toEqual({kind: "none"});
        expect(parseScutil("<dictionary> {\n  SOCKSEnable : 1\n  SOCKSPort : 1080\n  SOCKSProxy : 127.0.0.1\n}\n")).toEqual({kind: "manual", socks: "127.0.0.1:1080", bypass: []});
        expect(parseScutil("garbage")).toBeNull();
        // 按网卡的配置（`__SCOPED__`）不盖过全局的。
        const scoped = "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 3128\n  HTTPProxy : global.example\n  __SCOPED__ : <dictionary> {\n    en0 : <dictionary> {\n      HTTPEnable : 1\n      HTTPPort : 8081\n      HTTPProxy : scoped.example\n      ExceptionsList : <array> {\n        0 : only-en0.example\n      }\n    }\n  }\n}\n";
        expect(parseScutil(scoped)).toEqual({kind: "manual", http: "global.example:3128", bypass: []});
    });

    it("Windows：共用一个地址、按协议分开写、自动配置脚本、关着", () => {
        expect(parseWindowsRegistry(REG)).toEqual({kind: "manual", http: "127.0.0.1:7890", https: "127.0.0.1:7890", bypass: ["localhost", "127.*", "10.*", "<local>"]});
        expect(parseWindowsRegistry(REG.replace("127.0.0.1:7890", "http=10.0.0.1:80;https=10.0.0.1:443;socks=10.0.0.1:1080"))).toEqual({kind: "manual", http: "10.0.0.1:80", https: "10.0.0.1:443", socks: "10.0.0.1:1080", bypass: ["localhost", "127.*", "10.*", "<local>"]});
        expect(parseWindowsRegistry(`${REG}    AutoConfigURL    REG_SZ    http://wpad/proxy.pac\n`)).toEqual({kind: "pac"});
        expect(parseWindowsRegistry(REG.replace("0x1", "0x0"))).toEqual({kind: "none"});
        expect(parseWindowsRegistry("ERROR: something\n")).toBeNull();
    });

    it("Linux 没装 gsettings 算没设；Windows 命令失败、Linux 输出认不出来算读不到", async () => {
        const absent: RunCommand = async () => {
            throw Object.assign(new Error("spawn gsettings ENOENT"), {code: "ENOENT"});
        };
        const base = {env: {}, readText: async () => null, timeoutMs: 2000};
        expect(await readSystemProxy({...base, platform: "linux", run: absent})).toEqual({ok: true, source: null, proxy: {kind: "none"}});
        expect(await readSystemProxy({...base, platform: "win32", run: absent})).toMatchObject({ok: false, source: "windows"});
        expect(await readSystemProxy({...base, platform: "linux", run: async () => ({code: 0, stdout: "not gsettings"})})).toMatchObject({ok: false, source: "gnome"});
        expect(await readSystemProxy({...base, platform: "darwin", run: async () => ({code: 0, stdout: SCUTIL})})).toMatchObject({ok: true, source: "macos"});
        const kde = await readSystemProxy({...base, env: {XDG_CURRENT_DESKTOP: "KDE", HOME: "/home/someone"}, platform: "linux", run: absent, readText: async (path) => (path === "/home/someone/.config/kioslaverc" ? "[Proxy Settings]\nProxyType=1\nhttpsProxy=http://k.example:1\n" : null)});
        expect(kde).toEqual({ok: true, source: "kde", proxy: {kind: "manual", https: "http://k.example:1", bypass: []}});
    });
});

/** 只给要的几项，系统命令缺省答“没设”。 */
function egress(setting: ProxySetting, extra: Partial<EgressOptions> = {}) {
    return createEgress({setting: () => setting, startupEnv: {}, platform: "linux", run: async () => ({code: 0, stdout: "org.gnome.system.proxy mode 'none'\n"}), ...extra});
}

describe("选路", () => {
    const https = new URL("https://api.example.com/v1/models");
    const http = new URL("http://api.example.com/v1/models");

    it("直连、自定义、本机目标", async () => {
        expect(await egress({mode: "direct"}).routeFor()(https)).toEqual({ok: true, proxy: false});
        expect(await egress({mode: "custom", url: "http://proxy.example:3128"}).routeFor()(https)).toEqual({ok: true, proxy: "http://proxy.example:3128/"});
        expect(await egress({mode: "custom", url: "http://proxy.example:3128"}).routeFor()(new URL("http://127.0.0.1:9000/v1"))).toEqual({ok: true, proxy: false});
        expect(await egress({mode: "custom", url: "http://proxy.example:3128"}).describe(new URL("http://[::ffff:127.0.0.1]:9000/"))).toMatchObject({route: "bypassed", source: {kind: "local"}});
    });

    it("自定义地址不合规：带用户名密码（写不写协议都算）、SOCKS、空的", async () => {
        expect(await egress({mode: "custom", url: "http://u:secret@proxy.example:3128"}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-invalid"});
        expect(await egress({mode: "custom", url: "u:secret@proxy.example:3128"}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-invalid"});
        expect(await egress({mode: "custom", url: "socks5://127.0.0.1:1080"}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-unsupported"});
        expect(await egress({mode: "custom", url: ""}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-invalid"});
        expect(await egress({mode: "custom"}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-invalid"});
    });

    it("服务商的设置盖过应用级", async () => {
        const app = egress({mode: "custom", url: "http://proxy.example:3128"});
        expect(await app.routeFor({mode: "direct"})(https)).toEqual({ok: true, proxy: false});
        expect(await egress({mode: "direct"}).routeFor({mode: "custom", url: "http://other.example:8080"})(https)).toEqual({ok: true, proxy: "http://other.example:8080/"});
    });

    it("跟随系统：按目标协议取环境变量，小写优先，ALL_PROXY 兜底，NO_PROXY 旁路", async () => {
        const env = {HTTPS_PROXY: "http://secure.example:1", http_proxy: "plain.example:2", HTTP_PROXY: "upper.example:3", NO_PROXY: "skip.example"};
        const system = egress({mode: "system"}, {startupEnv: env});
        expect(await system.routeFor()(https)).toEqual({ok: true, proxy: "http://secure.example:1/"});
        expect(await system.routeFor()(http)).toEqual({ok: true, proxy: "http://plain.example:2/"});
        expect(await system.describe(http)).toMatchObject({route: "proxy", source: {kind: "env", name: "http_proxy"}, origin: "http://plain.example:2"});
        expect(await system.routeFor()(new URL("https://api.skip.example/"))).toEqual({ok: true, proxy: false});
        expect(await system.describe(new URL("https://api.skip.example/"))).toMatchObject({route: "bypassed", source: {kind: "env", name: "HTTPS_PROXY"}});
        expect(await egress({mode: "system"}, {startupEnv: {ALL_PROXY: "http://all.example:4"}}).routeFor()(https)).toEqual({ok: true, proxy: "http://all.example:4/"});
    });

    it("自定义也按环境的 NO_PROXY 报旁路（Bun 对显式代理同样旁路）", async () => {
        const custom = egress({mode: "custom", url: "http://proxy.example:3128"}, {startupEnv: {no_proxy: ".example.com"}});
        expect(await custom.describe(https)).toMatchObject({route: "bypassed", source: {kind: "setting"}, origin: "http://proxy.example:3128"});
        expect(await custom.routeFor()(https)).toEqual({ok: true, proxy: false});
    });

    it("环境变量给 SOCKS：不支持，文字里不带地址与密码", async () => {
        const route = await egress({mode: "system"}, {startupEnv: {HTTPS_PROXY: "socks5://user:hunter22@127.0.0.1:1080"}}).routeFor()(https);
        expect(route).toMatchObject({ok: false, code: "proxy-unsupported"});
        expect(JSON.stringify(route)).not.toContain("hunter22");
        const summary = await egress({mode: "system"}, {startupEnv: {HTTPS_PROXY: "http://user:hunter22@proxy.example:1"}}).describe(https);
        expect(summary).toMatchObject({origin: "http://proxy.example:1", hasCredentials: true});
        expect(JSON.stringify(summary)).not.toContain("hunter22");
    });

    it("环境没设时读系统设置：手动按协议与例外，脚本不支持，读不到报错不直连，只有 SOCKS 不支持", async () => {
        const gnome = (stdout: string) => egress({mode: "system"}, {run: async () => ({code: 0, stdout})});
        expect(await gnome(GSETTINGS_MANUAL).routeFor()(https)).toEqual({ok: true, proxy: "http://secure.example:3129/"});
        expect(await gnome(GSETTINGS_MANUAL).routeFor()(http)).toEqual({ok: true, proxy: "http://proxy.example:3128/"});
        expect(await gnome(GSETTINGS_MANUAL).describe(new URL("https://git.corp.example/"))).toMatchObject({route: "bypassed", source: {kind: "system", name: "gnome"}});
        // 系统的代理也按启动环境的 NO_PROXY 旁路（Bun 照样按它旁路显式的代理）。
        const withNoProxy = egress({mode: "system"}, {startupEnv: {NO_PROXY: "api.example.com"}, run: async () => ({code: 0, stdout: GSETTINGS_MANUAL})});
        expect(await withNoProxy.routeFor()(https)).toEqual({ok: true, proxy: false});
        expect(await withNoProxy.describe(https)).toMatchObject({route: "bypassed"});
        expect(await egress({mode: "system"}, {run: async () => ({code: 0, stdout: "[Proxy Settings]\n"}), platform: "linux", startupEnv: {XDG_CURRENT_DESKTOP: "KDE", HOME: "/nowhere"}, readText: async () => "[Proxy Settings]\nProxyType=1\nReversedException=1\nhttpsProxy=http://k.example:1\n"}).routeFor()(https)).toMatchObject({ok: false, code: "proxy-unsupported"});
        expect(await gnome("org.gnome.system.proxy mode 'auto'\n").routeFor()(https)).toMatchObject({ok: false, code: "proxy-unsupported"});
        expect(await gnome("org.gnome.system.proxy mode 'none'\n").describe(https)).toMatchObject({route: "direct", source: {kind: "system", name: "gnome"}, error: null});
        expect(await gnome("org.gnome.system.proxy mode 'manual'\norg.gnome.system.proxy.socks host 's.example'\norg.gnome.system.proxy.socks port 1080\n").routeFor()(https)).toMatchObject({ok: false, code: "proxy-unsupported"});
        const failing = egress({mode: "system"}, {platform: "win32", run: async () => ({code: 1, stdout: ""})});
        expect(await failing.routeFor()(https)).toMatchObject({ok: false, code: "proxy-unreadable"});
        expect(await failing.describe(https)).toMatchObject({source: {kind: "system", name: "windows"}, error: {code: "proxy-unreadable"}});
    });

    it("系统设置缓存 60 秒，同时在读的共用一次", async () => {
        let runs = 0;
        let clock = 0;
        const system = egress({mode: "system"}, {now: () => clock, run: async () => {
            runs += 1;
            return {code: 0, stdout: GSETTINGS_MANUAL};
        }});
        const route = system.routeFor();
        await Promise.all([route(https), route(https), route(http)]);
        expect(runs).toBe(1);
        clock = 59_999;
        await route(https);
        expect(runs).toBe(1);
        clock = 60_000;
        await route(https);
        expect(runs).toBe(2);
    });
});

describe("读系统设置的真实子进程与文件", () => {
    let tmp = "";
    beforeAll(async () => {
        tmp = await createTestTmpRoot("nb-host", "egress-system");
    });
    afterAll(async () => {
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    it("gsettings 不理会终止信号、一直不答：到 2 秒时限就报读不到，不等它收尾；并发的两次共用一次", async () => {
        const bin = join(tmp, "bin");
        await mkdir(bin, {recursive: true});
        await writeFile(join(bin, "gsettings"), "#!/bin/sh\ntrap '' TERM\nexec sleep 6\n");
        await chmod(join(bin, "gsettings"), 0o755);
        // 真的起子进程（缺省的执行函数），只把命令名换成假的 gsettings：`bun test` 里改 PATH 传不到子进程。
        let commands = 0;
        const system = createEgress({setting: () => ({mode: "system"}), startupEnv: {}, platform: "linux", run: (command, timeoutMs) => {
            commands += 1;
            return runSystemCommand([join(bin, "gsettings"), ...command.slice(1)], timeoutMs);
        }});
        const started = performance.now();
        const [first, second] = await Promise.all([system.describe(new URL("https://api.example.com/")), system.describe(new URL("https://api.example.com/"))]);
        const elapsed = performance.now() - started;
        expect(first).toMatchObject({error: {code: "proxy-unreadable"}});
        expect(second).toMatchObject({error: {code: "proxy-unreadable"}});
        expect(commands).toBe(1);
        expect(elapsed).toBeLessThan(4000);
    });

    it.skipIf(process.getuid?.() === 0)("KDE 的配置读不了（权限）时报读不到，不当成没设", async () => {
        const config = join(tmp, "kde-config");
        await mkdir(config, {recursive: true});
        await writeFile(join(config, "kioslaverc"), "[Proxy Settings]\nProxyType=1\nhttpsProxy=http://proxy.example:3128\n");
        await chmod(join(config, "kioslaverc"), 0o000);
        try {
            const kde = createEgress({setting: () => ({mode: "system"}), startupEnv: {XDG_CURRENT_DESKTOP: "KDE", XDG_CONFIG_HOME: config}, platform: "linux"});
            expect(await kde.describe(new URL("https://api.example.com/"))).toMatchObject({source: {kind: "system", name: "kde"}, error: {code: "proxy-unreadable"}});
            const absent = createEgress({setting: () => ({mode: "system"}), startupEnv: {XDG_CURRENT_DESKTOP: "KDE", XDG_CONFIG_HOME: join(tmp, "no-such-dir")}, platform: "linux"});
            expect(await absent.describe(new URL("https://api.example.com/"))).toMatchObject({route: "direct", error: null});
        } finally {
            await chmod(join(config, "kioslaverc"), 0o644);
        }
    });
});

describe("经真实的本机代理发请求", () => {
    let proxy: HttpProxy | null = null;
    let upstream: ReturnType<typeof Bun.serve> | null = null;
    const saved = new Map<string, string | undefined>();
    afterEach(() => {
        proxy?.stop();
        upstream?.stop(true);
        proxy = null;
        upstream = null;
        for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        saved.clear();
    });
    const setEnv = (values: Readonly<Record<string, string>>): void => {
        for (const [name, value] of Object.entries(values)) {
            if (!saved.has(name)) saved.set(name, process.env[name]);
            process.env[name] = value;
        }
    };
    /** 假端点挂在本机，代理把 `models.test` 接过去：目标不是本机名，出口才会让它走代理。 */
    const start = (): {readonly proxy: HttpProxy; readonly hits: string[]} => {
        const hits: string[] = [];
        upstream = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => {
            const path = new URL(request.url).pathname;
            hits.push(path);
            return new Response(path === "/not-ip" ? "ip=not-an-ip\n" : "ip=203.0.113.9\nts=1\n");
        }});
        const port = upstream.port;
        proxy = startHttpProxy({resolve: (host, target) => (host === "models.test" || host === "trace.test" ? {host: "127.0.0.1", port: port ?? 0} : {host, port: target})});
        return {proxy, hits};
    };

    it("自定义：请求经代理到达目标，代理收到绝对地址形式的请求", async () => {
        const {proxy, hits} = start();
        const response = await egress({mode: "custom", url: proxy.url}).fetchFor()("http://models.test/v1/chat/completions", {method: "POST", body: "{}"});
        expect(response.status).toBe(200);
        expect(proxy.requests.map((request) => `${request.method} ${request.target}`)).toEqual(["POST http://models.test/v1/chat/completions"]);
        expect(hits).toEqual(["/v1/chat/completions"]);
    });

    it("测试代理转发大的响应体不截断：读端先慢慢读，收到的与上游一字不差", async () => {
        const size = 12 * 1024 * 1024;
        const body = new Uint8Array(size).map((_, index) => index % 251);
        upstream = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response(body)});
        const port = upstream.port ?? 0;
        proxy = startHttpProxy({resolve: () => ({host: "127.0.0.1", port})});
        const response = await fetch("http://big.test/", {proxy: proxy.url});
        const reader = response.body!.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (let read = 0; ; read += 1) {
            // 前几十次读慢一点：代理那头的写端会写满、只收下一部分。
            if (read < 40) await Bun.sleep(5);
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
        }
        expect(total).toBe(size);
        expect(Buffer.concat(chunks).equals(Buffer.from(body))).toBe(true);
    });

    it("https 目标经代理建隧道（CONNECT）", async () => {
        const {proxy} = start();
        await egress({mode: "custom", url: proxy.url}).fetchFor()("https://models.test/v1/models").catch(() => undefined);
        expect(proxy.requests.map((request) => `${request.method} ${request.target}`)).toEqual(["CONNECT models.test:443"]);
    });

    it("跟随系统用启动环境的代理，代理的用户名密码作 Proxy-Authorization 发给代理", async () => {
        const {proxy} = start();
        const withUser = proxy.url.replace("http://", "http://alice:s3cret@");
        const response = await egress({mode: "system"}, {startupEnv: {HTTP_PROXY: withUser}}).fetchFor()("http://models.test/v1/models");
        expect(response.status).toBe(200);
        expect(proxy.requests[0]?.headers["proxy-authorization"]).toBe(`Basic ${btoa("alice:s3cret")}`);
    });

    it("直连盖过进程环境的代理变量：代理一个连接也没收到", async () => {
        const {proxy} = start();
        setEnv({HTTP_PROXY: proxy.url, http_proxy: proxy.url, HTTPS_PROXY: proxy.url, https_proxy: proxy.url, NO_PROXY: "", no_proxy: ""});
        // 对照：不写 `proxy` 时 Bun 读进程环境走了代理。
        expect((await fetch("http://models.test/v1/models")).status).toBe(200);
        expect(proxy.connections()).toBe(1);
        await expect(egress({mode: "direct"}).fetchFor()("http://models.test/v1/models")).rejects.toThrow();
        // 系统里没设、环境快照里也没有：同样直连，不吃进程环境。
        await expect(egress({mode: "system"}).fetchFor()("http://models.test/v1/models")).rejects.toThrow();
        expect(proxy.connections()).toBe(1);
    });

    it("选不出路时不发请求：fetchFor reject EgressError，代理没有连接", async () => {
        const {proxy} = start();
        const error = await egress({mode: "system"}, {startupEnv: {HTTP_PROXY: "socks5://127.0.0.1:1"}}).fetchFor()("http://models.test/v1/models").catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(EgressError);
        expect((error as EgressError).code).toBe("proxy-unsupported");
        const pac = await egress({mode: "system"}, {run: async () => ({code: 0, stdout: "org.gnome.system.proxy mode 'auto'\n"})}).fetchFor()("http://models.test/v1/models").catch((caught: unknown) => caught);
        expect((pac as EgressError).code).toBe("proxy-unsupported");
        expect(proxy.connections()).toBe(0);
    });

    it("测试代理：经代理取测试目标，交回出口 IP 与选路；目标在本机时报旁路；取消", async () => {
        const {proxy} = start();
        const custom = egress({mode: "custom", url: proxy.url}, {testUrl: "http://trace.test/cdn-cgi/trace"});
        const result = await custom.test();
        expect(result).toMatchObject({ok: true, ip: "203.0.113.9", summary: {route: "proxy", origin: proxy.url}});
        expect(proxy.requests.map((request) => request.target)).toEqual(["http://trace.test/cdn-cgi/trace"]);
        const port = upstream?.port ?? 0;
        expect(await egress({mode: "custom", url: proxy.url}, {testUrl: `http://127.0.0.1:${String(port)}/cdn-cgi/trace`}).test()).toMatchObject({ok: true, summary: {route: "bypassed", source: {kind: "local"}}});
        const controller = new AbortController();
        controller.abort();
        expect(await custom.test(undefined, controller.signal)).toMatchObject({ok: false, reason: "cancelled"});
        expect(await egress({mode: "custom", url: "socks5://127.0.0.1:1"}, {testUrl: "http://trace.test/"}).test()).toMatchObject({ok: false, reason: "proxy-unsupported"});
        // 回了 200 但 `ip=` 后面不是 IP（目标被换成别的页面）：不把它当出口 IP。
        expect(await egress({mode: "custom", url: proxy.url}, {testUrl: "http://trace.test/not-ip"}).test()).toMatchObject({ok: true, ip: null});
    });
});
