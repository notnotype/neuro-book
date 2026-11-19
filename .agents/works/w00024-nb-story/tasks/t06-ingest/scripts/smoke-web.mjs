// viewer Smoke 的场景 9（docs/specs/story/viewer.md 的“验收与 Smoke”）：真实模型（.env 的 NBOOK_LLM_*，gpt-6-luna）、
// 真实 `nbstory serve`（Work 分支 worktree）与本机 Chrome，在导入页导入样例书前 3 章，第 1 章提交后停一次再继续，抽完后
// 打开书。截图与小结写进不进 Git 的本地目录。由 Node 运行（Bun 下启动浏览器时 CDP 握手会超时）：
//   node .agents/works/w00024-nb-story/tasks/t06-ingest/scripts/smoke-web.mjs
import {spawn, execFileSync} from "node:child_process";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {chromium} from "playwright";

const REPO = "/home/<user>/CodeRepository/neuro-book";
const PKG = `${REPO}/.worktree/w00024-nb-story/packages/nb-story`;
const OUT = `${REPO}/.local/agent/works/w00024-nb-story/tasks/t06-ingest/smoke-web`;
rmSync(OUT, {recursive: true, force: true});
const configHome = join(OUT, "xdg");
mkdirSync(join(configHome, "nbstory"), {recursive: true});
mkdirSync(join(OUT, "shots"), {recursive: true});

// 配置只写端点地址与密钥环境变量名，由 Bun 读 .env 写出；密钥不经过这个脚本。
execFileSync("bun", ["--env-file", `${REPO}/.env`, "-e", `await Bun.write(process.argv[1], JSON.stringify({model: {baseUrl: process.env.NBOOK_LLM_BASE_URL, id: "gpt-6-luna", apiKeyEnv: "NBOOK_LLM_API_KEY", price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"}}}))`, join(configHome, "nbstory", "config.json")]);
const file = join(OUT, "样例前3章.txt");
execFileSync("bun", ["-e", `import {sampleSourceText} from "${PKG}/testing/sample.ts"; await Bun.write(process.argv[1], await sampleSourceText(3));`, file]);

const serve = spawn("bun", ["--env-file", `${REPO}/.env`, `${PKG}/src/cli.ts`, "serve", "--library", join(OUT, "library")], {stdio: ["ignore", "pipe", "pipe"], env: {...process.env, XDG_CONFIG_HOME: configHome}});
let output = "";
const login = await new Promise((resolve, reject) => {
    serve.stdout.on("data", chunk => {
        output += chunk;
        const match = /http:\/\/\S+\/login\?token=\S+/u.exec(output);
        if (match) resolve(match[0]);
    });
    serve.stderr.on("data", chunk => (output += chunk));
    serve.on("exit", code => reject(new Error(`serve 退出（${code}）：${output}`)));
});
const base = login.slice(0, login.indexOf("/login"));
const browser = await chromium.launch({channel: "chrome", headless: true});
const log = [];
const note = text => {
    const line = `${new Date().toISOString()} ${text}`;
    log.push(line);
    console.log(line);
};
try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const shot = name => page.screenshot({path: join(OUT, "shots", `${name}.png`), fullPage: true});
    await page.goto(login);
    await page.goto(`${base}/import`);
    await page.getByTestId("import-file").setInputFiles(file);
    await page.getByTestId("import-plan").waitFor();
    note(`预览：${(await page.getByTestId("import-plan").innerText()).replace(/\s+/gu, " ")}`);
    await shot("1-import");
    await page.getByTestId("import-start").click();
    await page.waitForURL(/\/ingest\//u);
    await page.waitForSelector('[data-testid="ingest-count"][data-committed="1"]', {timeout: 20 * 60_000});
    note("第 1 章已提交");
    await shot("2-progress-1");
    await page.getByTestId("ingest-stop").click();
    await page.getByTestId("ingest-stopped").waitFor({timeout: 120_000});
    note(`停下：${(await page.getByTestId("ingest-stopped").innerText()).replace(/\s+/gu, " ")}`);
    await shot("3-stopped");
    await page.getByTestId("ingest-resume").click();
    await page.getByTestId("ingest-current").waitFor({timeout: 60_000});
    note("继续");
    await page.waitForSelector('[data-testid="ingest-count"][data-committed="3"]', {timeout: 40 * 60_000});
    await page.getByText("已全部抽完").waitFor({timeout: 60_000});
    note("抽完 3 章");
    await shot("4-done");
    const status = await (await page.request.post(`${base}/api/rpc/ingest.status`, {data: {}})).json();
    writeFileSync(join(OUT, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
    await page.getByTestId("ingest-open-book").click();
    await page.getByTestId("book-frame").waitFor();
    await page.locator('nav[aria-label="页面"] [data-page="roster"]').click();
    await page.getByTestId("page-roster").waitFor();
    await page.waitForLoadState("networkidle");
    await shot("5-book-roster");
    note(`人物页：${(await page.getByTestId("page-roster").innerText()).slice(0, 200).replace(/\s+/gu, " ")}`);
} finally {
    writeFileSync(join(OUT, "smoke.log"), `${log.join("\n")}\n`);
    await browser.close();
    serve.kill("SIGTERM");
}
