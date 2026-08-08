import {describe, expect, it} from "vitest";

import {
    DESKTOP_UAC_BROKER_SCHEMA,
    DESKTOP_UAC_MAX_ARGUMENTS,
    DESKTOP_UAC_MAX_CONTROL_LINE_BYTES,
    DESKTOP_UAC_MAX_SECRET_BYTES,
    encodeDesktopUacBrokerLine,
    parseDesktopUacBrokerLine,
    type DesktopUacBrokerRequest,
} from "nbook/shared/desktop-uac-broker";

describe("Desktop UAC Broker protocol", () => {
    it("round-trips hello, request and event messages without carrying secret bytes", () => {
        const hello = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "hello",
            operationId: "operation-1",
            nonce: "nonce-1",
        } as const;
        const secretHello = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "secret-hello",
            operationId: "operation-1",
            nonce: "nonce-1",
        } as const;
        const request: DesktopUacBrokerRequest = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId: "operation-1",
            action: "desktop-install",
            args: ["desktop", "install", "--scope", "machine", "--password-stdin"],
            secretBytes: 12,
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        };
        const event = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: "operation-1",
            event: {
                kind: "log",
                stream: "stdout",
                message: "validating-input",
            },
        } as const;

        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine(hello).trim())).toEqual(hello);
        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine(secretHello).trim())).toEqual(secretHello);
        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine(request).trim())).toEqual(request);
        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine({
            ...request,
            action: "desktop-repair",
            args: ["desktop", "repair", "--json"],
            secretBytes: 0,
        }).trim())).toMatchObject({action: "desktop-repair"});
        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine({
            ...request,
            action: "uninstall",
            args: ["uninstall", "--yes"],
            secretBytes: 0,
        }).trim())).toMatchObject({action: "uninstall"});
        expect(parseDesktopUacBrokerLine(encodeDesktopUacBrokerLine(event).trim())).toEqual(event);
        expect(encodeDesktopUacBrokerLine(request)).not.toContain("super-secret");
        expect(encodeDesktopUacBrokerLine(request)).toContain("secretBytes");
    });

    it("rejects unknown fields, arbitrary actions, NULs and oversized frames", () => {
        const request = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId: "operation-1",
            action: "desktop-install",
            args: ["desktop", "install", "--scope", "machine"],
            secretBytes: 0,
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        };

        expect(() => parseDesktopUacBrokerLine(JSON.stringify({...request, extra: true}))).toThrow("未知字段");
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({...request, action: "shell"}))).toThrow("action");
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({...request, args: ["desktop", "install", "bad\0arg"]}))).toThrow("参数列表");
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({
            ...request,
            args: Array.from({length: DESKTOP_UAC_MAX_ARGUMENTS + 1}, () => "x"),
        }))).toThrow("参数列表");
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({...request, secretBytes: DESKTOP_UAC_MAX_SECRET_BYTES + 1}))).toThrow("secretBytes");
        expect(() => parseDesktopUacBrokerLine("x".repeat(DESKTOP_UAC_MAX_CONTROL_LINE_BYTES + 1))).toThrow("大小上限");
    });

    it("uses UTF-8 byte limits for arguments and secrets", () => {
        const argument = "中".repeat(1365);
        const request = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "request",
            operationId: "operation-1",
            action: "desktop-install",
            args: ["desktop", "install", "--scope", "machine", argument],
            secretBytes: DESKTOP_UAC_MAX_SECRET_BYTES,
            installationId: null,
            installationRoot: "C:\\Program Files\\NeuroBook",
            manifestSha256: null,
            deleteData: false,
        } as const;
        expect(parseDesktopUacBrokerLine(JSON.stringify(request))).toEqual(request);
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({
            ...request,
            args: [...request.args.slice(0, -1), `${argument}xx`],
        }))).toThrow("参数列表");
    });

    it("requires strict event shapes and bounded diagnostic text", () => {
        const base = {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: "operation-1",
        };
        expect(parseDesktopUacBrokerLine(JSON.stringify({
            ...base,
            event: {kind: "complete", exitCode: 0, signal: null},
        }))).toMatchObject({event: {kind: "complete", exitCode: 0}});
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({
            ...base,
            event: {kind: "failure", code: "x", message: " "},
        }))).toThrow("message");
        expect(() => parseDesktopUacBrokerLine(JSON.stringify({
            ...base,
            event: {kind: "log", stream: "stdout", message: "x".repeat(16 * 1024 + 1)},
        }))).toThrow("message");
    });
});
