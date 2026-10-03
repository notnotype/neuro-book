import {afterEach, describe, expect, it, vi} from "vitest";
import {createHttpFilesTransport} from "nbook/app/features/files/files-client";

afterEach(() => vi.unstubAllGlobals());

describe("Files event stream lifetime", () => {
    it("rejects unexpected EOF after delivering the last event", async () => {
        const event = {type: "workspace_files_changed", events: []};
        vi.stubGlobal("fetch", async () => new Response(`data: ${JSON.stringify(event)}\n\n`, {
            headers: {"Content-Type": "text/event-stream"},
        }));
        const received: unknown[] = [];
        await expect(createHttpFilesTransport().events({workspaceKind: "user-assets"}, value => received.push(value)))
            .rejects.toThrow();
        expect(received).toEqual([event]);
    });

    it("allows consumer abort to end the subscription without an interruption error", async () => {
        const controller = new AbortController();
        vi.stubGlobal("fetch", async () => new Response(new ReadableStream({
            start(stream) {
                controller.signal.addEventListener("abort", () => stream.close(), {once: true});
            },
        }), {headers: {"Content-Type": "text/event-stream"}}));
        const subscription = createHttpFilesTransport().events({workspaceKind: "user-assets"}, () => undefined, controller.signal);
        controller.abort();
        await expect(subscription).resolves.toBeUndefined();
    });
});
