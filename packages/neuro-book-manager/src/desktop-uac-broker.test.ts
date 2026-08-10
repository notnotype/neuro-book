import {createServer, type Server, type Socket} from "node:net";
import {randomUUID} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createInterface} from "node:readline";

import {afterEach, describe, expect, it} from "vitest";

import {DESKTOP_UAC_BROKER_SCHEMA, DESKTOP_UAC_MAX_SECRET_BYTES, type DesktopUacBrokerRequest} from "nbook/shared/desktop-uac-broker";
import {
    runDesktopUacBroker,
    validateDesktopUacBrokerRequest,
} from "#manager/desktop-uac-broker";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Desktop UAC Broker Manager boundary", () => {
    it("only accepts the machine desktop install and keeps password length semantics", () => {
        const request: DesktopUacBrokerRequest = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId: "operation-1",
            action: "desktop-install",
            args: desktopInstallArgs("--password-stdin", "--enable-auth"),
            secretBytes: 7,
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        };
        expect(validateDesktopUacBrokerRequest(request, "operation-1")).toEqual(request);
        expect(() => validateDesktopUacBrokerRequest({...request, operationId: "other"}, "operation-1")).toThrow("身份");
        expect(() => validateDesktopUacBrokerRequest({
            ...request,
            args: request.args.map((value) => value === "machine" ? "user" : value),
            secretBytes: 0,
        }, "operation-1")).toThrow("参数值无效");
        expect(() => validateDesktopUacBrokerRequest({...request, args: [...request.args].filter((value) => value !== "--password-stdin"), secretBytes: 7}, "operation-1"))
            .toThrow("auth 与 password stdin");
        expect(() => validateDesktopUacBrokerRequest({...request, secretBytes: DESKTOP_UAC_MAX_SECRET_BYTES + 1}, "operation-1"))
            .toThrow("secret");
        expect(() => validateDesktopUacBrokerRequest({
            ...request,
            args: [...request.args, "--dir", "C:\\Elsewhere"],
        }, "operation-1")).toThrow("未允许参数");
        expect(() => validateDesktopUacBrokerRequest({
            ...request,
            args: [...request.args, "--scope", "machine"],
        }, "operation-1")).toThrow("参数重复");
        expect(() => validateDesktopUacBrokerRequest({
            ...request,
            args: request.args.filter((value) => value !== "--depot" && value !== "C:\\Depot\\neuro-book-desktop-depot-win-x64.zip"),
        }, "operation-1")).toThrow("发行来源");
        expect(() => validateDesktopUacBrokerRequest({
            ...request,
            installationRoot: "C:\\Elsewhere\\NeuroBook",
        }, "operation-1")).toThrow("canonical Program Files");
        const repair = {
            ...request,
            action: "desktop-repair" as const,
            args: ["--root", "C:\\Program Files\\NeuroBook", "desktop", "repair", "--json"],
            secretBytes: 0,
            installationId: "installation-1",
            manifestSha256: `sha256:${"a".repeat(64)}`,
        };
        expect(validateDesktopUacBrokerRequest(repair, "operation-1", "desktop-repair")).toEqual(repair);
        expect(() => validateDesktopUacBrokerRequest(repair, "operation-1", "desktop-install")).toThrow("action");
        const uninstall = {
            ...repair,
            action: "uninstall" as const,
            args: ["--root", "C:\\Program Files\\NeuroBook", "uninstall", "--yes"],
        };
        expect(validateDesktopUacBrokerRequest(uninstall, "operation-1", "uninstall")).toEqual(uninstall);
        expect(() => validateDesktopUacBrokerRequest({
            ...uninstall,
            args: ["uninstall", "--yes"],
        }, "operation-1", "uninstall")).toThrow("必须显式绑定 --root");
    });

    it.runIf(process.platform === "win32")("passes UTF-8 stdin bytes to the delegated CLI without putting them in control events", async () => {
        const secret = "密\n码";
        const lines = await runBrokerFixture([
            "const chunks = [];",
            "for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));",
            "const bytes = Buffer.concat(chunks).byteLength;",
            "process.stdout.write(JSON.stringify({kind: 'stdin-bytes', bytes}) + '\\n');",
        ].join("\n"), secret);
        expect(lines.some((value) => JSON.stringify(value).includes(String(Buffer.byteLength(secret, "utf8"))))).toBe(true);
        expect(JSON.stringify(lines)).not.toContain(secret);
    });

    it.runIf(process.platform === "win32")("fails closed when the delegated CLI attempts to echo the password", async () => {
        const secret = "super\nsecret-password";
        const lines = await runBrokerFixture([
            "const chunks = [];",
            "for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));",
            `process.stdout.write(${JSON.stringify(secret)} + '\\n');`,
        ].join("\n"), secret);
        expect(lines).toContainEqual(expect.objectContaining({
            event: expect.objectContaining({kind: "failure", code: "broker-output-failure"}),
        }));
        expect(JSON.stringify(lines)).not.toContain(secret);
    });

    it.runIf(process.platform === "win32")("fails closed when delegated JSON escapes the password", async () => {
        const secret = "super\nsecret-password";
        const lines = await runBrokerFixture([
            "const chunks = [];",
            "for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));",
            "const password = Buffer.concat(chunks).toString('utf8');",
            "process.stdout.write(JSON.stringify({kind: 'leak', password}) + '\\n');",
        ].join("\n"), secret);
        expect(lines).toContainEqual(expect.objectContaining({
            event: expect.objectContaining({kind: "failure", code: "broker-output-failure"}),
        }));
        expect(JSON.stringify(lines)).not.toContain("super\\nsecret-password");
    });

});

async function runBrokerFixture(managerSource: string, secret: string): Promise<unknown[]> {
    const root = await mkdtemp(join(tmpdir(), "nbook-uac-broker-"));
    roots.push(root);
    const managerExecutable = join(root, "fake-manager.mjs");
    await writeFile(managerExecutable, managerSource, "utf8");
    const controlPipe = `\\\\.\\pipe\\nbook-uac-control-${randomUUID()}`;
    const secretPipe = `\\\\.\\pipe\\nbook-uac-secret-${randomUUID()}`;
    const controlServer = await listenPipe(controlPipe);
    const secretServer = await listenPipe(secretPipe);
    const lines: unknown[] = [];
    try {
        const controlSocketPromise = acceptOne(controlServer);
        const secretSocketPromise = acceptOne(secretServer);
        const brokerPromise = runDesktopUacBroker({
            pipe: controlPipe,
            secretPipe,
            nonce: "nonce-1",
            operationId: "operation-1",
            action: "desktop-install",
            managerExecutable,
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        });
        const control = await controlSocketPromise;
        const reader = createInterface({input: control, crlfDelay: Infinity});
        let resolveHello: ((value: {type: string; operationId: string; nonce: string}) => void) | undefined;
        const helloPromise = new Promise<{type: string; operationId: string; nonce: string}>((resolvePromise) => {
            resolveHello = resolvePromise;
        });
        const closedPromise = new Promise<void>((resolvePromise) => {
            reader.once("close", () => resolvePromise());
        });
        reader.on("line", (line) => {
            if (!line.trim()) return;
            const value = JSON.parse(line) as {type?: string; operationId?: string; nonce?: string};
            if (value.type === "hello" && resolveHello) {
                resolveHello(value as {type: string; operationId: string; nonce: string});
                resolveHello = undefined;
                return;
            }
            lines.push(value);
        });
        const hello = await helloPromise;
        expect(hello).toMatchObject({type: "hello", operationId: "operation-1", nonce: "nonce-1"});
        control.write(`${JSON.stringify({
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId: "operation-1",
            action: "desktop-install",
            args: desktopInstallArgs("--password-stdin", "--enable-auth"),
            secretBytes: Buffer.byteLength(secret, "utf8"),
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        })}\n`);
        const secretSocket = await secretSocketPromise;
        const secretReader = createInterface({input: secretSocket, crlfDelay: Infinity});
        const secretHello = JSON.parse(await nextLine(secretReader)) as {
            type: string;
            operationId: string;
            nonce: string;
        };
        expect(secretHello).toMatchObject({type: "secret-hello", operationId: "operation-1", nonce: "nonce-1"});
        secretReader.close();
        secretSocket.end(Buffer.from(secret, "utf8"));
        await brokerPromise;
        await closedPromise;
        return lines;
    } finally {
        controlServer.close();
        secretServer.close();
    }
}

function desktopInstallArgs(...extra: string[]): string[] {
    return [
        "desktop", "install",
        "--depot", "C:\\Depot\\neuro-book-desktop-depot-win-x64.zip",
        "--scope", "machine",
        "--channel", "canary",
        "--runtime-provider", "managed",
        "--git-provider", "managed",
        "--rg-provider", "managed",
        "--envelope", "electron",
        "--yes",
        "--json",
        ...extra,
    ];
}

async function listenPipe(path: string): Promise<Server> {
    const server = createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(path, () => resolvePromise());
    });
    return server;
}

async function acceptOne(server: Server): Promise<Socket> {
    return await new Promise<Socket>((resolvePromise) => server.once("connection", resolvePromise));
}

async function nextLine(reader: AsyncIterable<string>): Promise<string> {
    for await (const line of reader) return line;
    throw new Error("pipe closed before line");
}
