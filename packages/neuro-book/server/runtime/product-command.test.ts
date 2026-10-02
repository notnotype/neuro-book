import {spawn, type ChildProcess} from "node:child_process";
import {watch} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createConnection} from "node:net";
import {join, resolve} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createProductRuntimeContract, PRODUCT_BUN_RUNTIME_ARGS, productRuntimeBuildPolicy} from "@notnotype/neuro-book-contracts/product-runtime";
import {ProductRuntimeImageBuilder} from "#scripts/build/product-runtime-image-builder";
import {bundleProductJavaScript} from "#scripts/build/product-reproducible-bundle";

let root: string;
let imageRoot: string;
const children = new Set<ChildProcess>();

beforeAll(async () => {
    root = await createTestTmpRoot("product-wrapper-signals", "真实产品包装链停止回归");
    await mkdir(join(root, "node_modules", "nuxt"), {recursive: true});
    await mkdir(join(root, "node_modules", "nitropack"), {recursive: true});
    await writeFile(join(root, "package.json"), JSON.stringify({name: "wrapper-fixture", version: "1.0.0"}));
    await writeFile(join(root, "bun.lock"), "wrapper fixture\n");
    await writeFile(join(root, "node_modules", "nuxt", "package.json"), JSON.stringify({version: "4.3.1"}));
    await writeFile(join(root, "node_modules", "nitropack", "package.json"), JSON.stringify({version: "2.13.4"}));
    const applicationRoot = resolve(import.meta.dirname, "../..");
    const policy = productRuntimeBuildPolicy("linux-x64-glibc");
    const image = await new ProductRuntimeImageBuilder(root).buildCandidate({
        operationId: "wrapper-signals", platform: "linux-x64-glibc", owners: policy.owners, budget: policy.budget,
        expectedSource: {revision: "a".repeat(40), dirty: false},
        async build({imageRoot: candidate}) {
            const commands = join(candidate, "server", "commands");
            await mkdir(commands, {recursive: true});
            await mkdir(join(candidate, "server", "assets", "workspace", ".nbook", "agent"), {recursive: true});
            await mkdir(join(candidate, "server", "assets", "reference"), {recursive: true});
            await writeFile(join(candidate, "server", "assets", "reference", "reference.md"), "fixture\n");
            for (const [source, output] of [["product-command.ts", "product-command.mjs"], ["product-start-command.mjs", "start.mjs"]] as const) {
                await bundleProductJavaScript({entryPoints: [join(applicationRoot, "server", "runtime", source)], outfile: join(commands, output), alias: {nbook: applicationRoot}});
            }
            const noop = "server/commands/prepare.mjs";
            await writeFile(join(candidate, noop), "process.exit(0);\n");
            const contract = createProductRuntimeContract({
                productStart: "server/commands/start.mjs", sqliteMigrate: noop, applicationStateMigration: noop,
                createAdmin: noop, profile: noop, variable: noop, workspace: noop, prepareSystemAssets: noop,
                checkMigrations: noop, profileAuthoringSmoke: noop, variableAuthoringSmoke: noop,
                imageVariantSmoke: noop, sqliteVecSmoke: noop, webFetchSmoke: noop, worldEngineConfigSmoke: noop,
            });
            await writeFile(join(candidate, "server", "runtime-contract.json"), JSON.stringify(contract));
            await writeFile(join(candidate, "server", "index.mjs"), [
                'import {writeFileSync} from "node:fs";',
                'import {createServer} from "node:net";',
                'import {join} from "node:path";',
                'const state = process.env.NEURO_BOOK_STATE_ROOT;',
                'const config = JSON.parse(await Bun.file(join(state, "scenario.json")).text());',
                'const sockets = new Set();',
                'let signals = 0;',
                'const stop = () => {signals++; for (const socket of sockets) socket.write("stopping\\n");};',
                'process.on("SIGTERM", stop); process.on("SIGINT", stop);',
                'const server = createServer((socket) => {',
                '  sockets.add(socket); let input = "";',
                '  socket.write("connected\\n");',
                '  socket.on("data", (chunk) => {',
                '    input += chunk; let end;',
                '    while ((end = input.indexOf("\\n")) >= 0) {',
                '      const command = input.slice(0, end); input = input.slice(end + 1);',
                '      if (command === "status") socket.write(`signals:${signals}\\n`);',
                '      if (command === "finish") {',
                '        writeFileSync(join(state, "service-exited"), String(config.code));',
                '        process.exit(config.code);',
                '      }',
                '    }',
                '  });',
                '  socket.on("close", () => sockets.delete(socket));',
                '});',
                'server.listen(0, "127.0.0.1", () => writeFileSync(join(state, "ready"), JSON.stringify({pid: process.pid, port: server.address().port})));',
            ].join("\n"));
        },
    });
    imageRoot = image.path;
}, 60_000);

afterAll(async () => {
    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null && child.pid) {
            const completion = Promise.withResolvers<void>();
            child.once("exit", () => completion.resolve());
            process.kill(-child.pid, "SIGKILL");
            await completion.promise;
        }
    }
    if (root) await rm(root, {recursive: true, force: true});
});

async function launch(id: string, code: number) {
    const stateRoot = join(root, id);
    await mkdir(stateRoot);
    await writeFile(join(stateRoot, "scenario.json"), JSON.stringify({code}));
    const ready = Promise.withResolvers<{pid: number; port: number}>();
    const watcher = watch(stateRoot, (_event, name) => {
        if (name === "ready") void readFile(join(stateRoot, "ready"), "utf8").then((text) => ready.resolve(JSON.parse(text)), ready.reject);
    });
    const child = spawn("bun", [...PRODUCT_BUN_RUNTIME_ARGS, join(imageRoot, "server", "commands", "product-command.mjs"), "command", "start"], {
        cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"],
        env: {...process.env, NEURO_BOOK_APPLICATION_ROOT: root, NEURO_BOOK_STATE_ROOT: stateRoot,
            NEURO_BOOK_CACHE_ROOT: join(stateRoot, "cache"), NEURO_BOOK_PRODUCT_IMAGE_ROOT: imageRoot,
            NUXT_SESSION_PASSWORD: "wrapper-regression-password-1234567890", NODE_PATH: ""},
    });
    children.add(child);
    const completed = Promise.withResolvers<{code: number | null; signal: string | null}>();
    let output = "";
    child.stdout?.on("data", (chunk) => {output += String(chunk);});
    child.stderr?.on("data", (chunk) => {output += String(chunk);});
    child.once("error", (error) => {completed.reject(error); ready.reject(error);});
    child.once("exit", (exitCode, signal) => {
        completed.resolve({code: exitCode, signal});
        ready.reject(new Error(`包装链就绪前退出：${output}`));
    });
    let service: {pid: number; port: number};
    try { service = await ready.promise; } finally { watcher.close(); }
    const socket = createConnection({port: service.port, host: "127.0.0.1"});
    const connected = Promise.withResolvers<void>();
    socket.once("connect", connected.resolve);
    socket.once("error", connected.reject);
    let input = "";
    const messages: string[] = [];
    const pending: Array<{resolve: (line: string) => void; reject: (error: unknown) => void}> = [];
    socket.on("data", (chunk) => {
        input += String(chunk);
        let end: number;
        while ((end = input.indexOf("\n")) >= 0) {
            const line = input.slice(0, end);
            input = input.slice(end + 1);
            const waiter = pending.shift();
            if (waiter) waiter.resolve(line);
            else messages.push(line);
        }
    });
    socket.on("error", (error) => {for (const waiter of pending.splice(0)) waiter.reject(error);});
    socket.on("close", () => {for (const waiter of pending.splice(0)) waiter.reject(new Error("服务控制连接已关闭"));});
    await connected.promise;
    const next = (): Promise<string> => {
        const message = messages.shift();
        if (message !== undefined) return Promise.resolve(message);
        const waiting = Promise.withResolvers<string>();
        pending.push(waiting);
        return waiting.promise;
    };
    if (await next() !== "connected") throw new Error("服务控制连接未建立");
    return {child, stateRoot, completion: completed.promise, socket, next};
}

describe.skipIf(process.platform === "win32")("产品包装链真实信号与退出码", () => {
    it.each([0, 1, 75])("进程组重复 SIGTERM 后等待服务关闭并原样传递退出码 %i", async (code) => {
        const {child, stateRoot, completion, socket, next} = await launch(`group-${code}`, code);
        try {
            process.kill(-child.pid!, "SIGTERM");
            expect(await next()).toBe("stopping");
            process.kill(-child.pid!, "SIGTERM");
            expect(await next()).toBe("stopping");
            expect(child.exitCode).toBeNull();
            expect(child.signalCode).toBeNull();
            await expect(readFile(join(stateRoot, "service-exited"))).rejects.toMatchObject({code: "ENOENT"});
            socket.write("finish\n");
            expect(await completion).toEqual({code, signal: null});
            expect(await readFile(join(stateRoot, "service-exited"), "utf8")).toBe(String(code));
        } finally {socket.destroy();}
    }, 15_000);

    it("只向外层重复发停止信号时，两层各只转发一次", async () => {
        const {child, completion, socket, next} = await launch("parent-only", 0);
        try {
            child.kill("SIGTERM");
            expect(await next()).toBe("stopping");
            child.kill("SIGTERM");
            child.kill("SIGINT");
            socket.write("status\n");
            expect(await next()).toBe("signals:1");
            socket.write("finish\n");
            expect(await completion).toEqual({code: 0, signal: null});
        } finally {socket.destroy();}
    }, 15_000);
});
