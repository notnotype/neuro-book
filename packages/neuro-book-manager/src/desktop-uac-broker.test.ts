import {createServer, type Server, type Socket} from "node:net";
import {randomUUID} from "node:crypto";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createInterface} from "node:readline";

import {afterEach, describe, expect, it} from "vitest";

import {DESKTOP_UAC_BROKER_SCHEMA, DESKTOP_UAC_MAX_SECRET_BYTES, type DesktopUacBrokerRequest} from "nbook/shared/desktop-uac-broker";
import {runDesktopUacBroker, validateDesktopUacBrokerRequest} from "#manager/desktop-uac-broker";

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
            args: ["desktop", "install", "--scope", "machine", "--password-stdin"],
            secretBytes: 7,
        };
        expect(validateDesktopUacBrokerRequest(request, "operation-1")).toEqual(request);
        expect(() => validateDesktopUacBrokerRequest({...request, operationId: "other"}, "operation-1")).toThrow("身份");
        expect(() => validateDesktopUacBrokerRequest({...request, args: ["desktop", "install", "--scope", "user"], secretBytes: 0}, "operation-1"))
            .toThrow("machine scope");
        expect(() => validateDesktopUacBrokerRequest({...request, args: [...request.args].filter((value) => value !== "--password-stdin"), secretBytes: 7}, "operation-1"))
            .toThrow("secretBytes");
        expect(() => validateDesktopUacBrokerRequest({...request, secretBytes: DESKTOP_UAC_MAX_SECRET_BYTES + 1}, "operation-1"))
            .toThrow("secret");
        const repair = {
            ...request,
            action: "desktop-repair" as const,
            args: ["desktop", "repair", "--json"],
            secretBytes: 0,
        };
        expect(validateDesktopUacBrokerRequest(repair, "operation-1", "desktop-repair")).toEqual(repair);
        expect(() => validateDesktopUacBrokerRequest(repair, "operation-1", "desktop-install")).toThrow("action");
        const uninstall = {...repair, action: "uninstall" as const, args: ["uninstall", "--yes"]};
        expect(validateDesktopUacBrokerRequest(uninstall, "operation-1", "uninstall")).toEqual(uninstall);
    });

    it("passes UTF-8 stdin bytes to the delegated CLI without putting them in control events", async () => {
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

    it("fails closed when the delegated CLI attempts to echo the password", async () => {
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
            args: ["desktop", "install", "--scope", "machine", "--password-stdin"],
            secretBytes: Buffer.byteLength(secret, "utf8"),
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
