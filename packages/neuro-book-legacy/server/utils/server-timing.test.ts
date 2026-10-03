import {describe, expect, it, vi} from "vitest";
import type {H3Event} from "h3";
import {createServerTiming, flushServerTiming, readServerTimingMarks} from "nbook/server/utils/server-timing";

describe("server timing", () => {
    it("把 marks 存入 event.context，并在 flush 时合并已有 Server-Timing", async () => {
        const {event, headers} = createTestEvent({"server-timing": "existing;dur=1.0"});

        const timing = createServerTiming(event);
        timing.mark("readSession", 1.24);
        timing.mark("liveState", 2.05);

        expect(readServerTimingMarks(event).map((mark) => mark.name)).toEqual(["readSession", "liveState"]);
        flushServerTiming(event);
        flushServerTiming(event);

        expect(headers["server-timing"]).toBe("existing;dur=1.0, readSession;dur=1.2, liveState;dur=2.0");
    });

    it("会合并 Nuxt dev runtime 在 res.end 前晚写入的 Server-Timing", async () => {
        const {event, headers} = createTestEvent();

        createServerTiming(event).mark("projects.total", 5);
        flushServerTiming(event);
        event.node.res.setHeader("Server-Timing", "-;dur=1;desc=\"Generate\"");

        expect(headers["server-timing"]).toBe("-;dur=1;desc=\"Generate\", projects.total;dur=5.0");
    });
});

function createTestEvent(initialHeaders: Record<string, string> = {}): {event: H3Event; headers: Record<string, string>} {
    const headers = {...initialHeaders};
    const event = {
        context: {},
        node: {
            res: {
                getHeader: (name: string) => headers[name.toLowerCase()],
                setHeader: (name: string, value: string) => {
                    headers[name.toLowerCase()] = value;
                },
                getHeaders: () => headers,
            },
        },
    } as unknown as H3Event;
    return {event, headers};
}
