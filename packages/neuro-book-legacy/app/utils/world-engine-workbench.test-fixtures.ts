import type {
    SubjectStateDto,
    WorldIssueDto,
    WorldSchemaProjectionDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSnapshot,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectSystemSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type MockIssueCatalogItem = Pick<WorldIssueDto, "label" | "severity" | "title" | "explanation">;

/**
 * 仅供浏览器 mock preview 使用的 fixture。
 * 生产 issue catalog 的唯一真相在后端 `server/world-engine/world-issue-catalog.ts`。
 */
const mockIssueCatalog: Record<WorldIssueDto["code"], MockIssueCatalogItem> = {
    "broken-relative": {
        label: "E1",
        severity: "error",
        title: "相对变更没有可用基准",
        explanation: {
            whatHappened: "某条相对 patch 无法在当前时间线中找到可安全应用的已有值。",
            whyItMatters: "这是持久数据错误，必须修。",
            suggestedAction: "在更早时间补 replace 初始化，或修正当前 patch。",
        },
    },
    "dangling-ref": {
        label: "E2",
        severity: "error",
        title: "引用目标无效",
        explanation: {
            whatHappened: "ref 值没有指向有效 subject，或目标类型不符合 schema。",
            whyItMatters: "这是持久数据错误，必须修。",
            suggestedAction: "创建或修正目标 subject，或改掉当前 ref。",
        },
    },
    "invalid-path": {
        label: "E3",
        severity: "error",
        title: "patch 路径无法应用",
        explanation: {
            whatHappened: "JSON Pointer 路径或目标容器形状不符合当前状态。",
            whyItMatters: "patch 无法可靠改变世界状态。",
            suggestedAction: "修正 path 或先补齐父路径。",
        },
    },
    "cross-ref": {
        label: "E4",
        severity: "error",
        title: "patch 试图穿过引用目标",
        explanation: {
            whatHappened: "patch 路径试图穿过 subject:// 引用。",
            whyItMatters: "跨引用写会破坏 subject 边界。",
            suggestedAction: "分别修改引用值和目标 subject 自己的属性。",
        },
    },
    "embedding-whole-replace": {
        label: "E5",
        severity: "error",
        title: "EmbeddingText 字段不能整块写入非空内容",
        explanation: {
            whatHappened: "EmbeddingText 容器被非空整块 replace。",
            whyItMatters: "一条 EmbeddingText 必须对应一行 WorldPatch/vector。",
            suggestedAction: "空容器可 replace 初始化；真实文本用 append 或 key 级 replace 单条写入。",
        },
    },
    "base-shifted": {
        label: "A1",
        severity: "advisory",
        title: "下游相对变更的基准可能改变",
        explanation: {
            whatHappened: "本次对过去的绝对修改会改变后续相对 op 的基准。",
            whyItMatters: "这是一次性提醒，确认语义即可。",
            suggestedAction: "检查相关 patch，确认结果符合剧情。",
        },
    },
    masked: {
        label: "A2",
        severity: "advisory",
        title: "本次改动可能被后续绝对变更覆盖",
        explanation: {
            whatHappened: "本次对过去的修改后面还有绝对 op 覆盖相关路径。",
            whyItMatters: "这是一次性提醒，确认语义即可。",
            suggestedAction: "检查后续覆盖 patch，确认覆盖是有意的。",
        },
    },
};

function mockIssue(input: Pick<WorldIssueDto, "code" | "sliceId" | "subjectId" | "attr" | "message">): WorldIssueDto {
    const catalogItem = mockIssueCatalog[input.code];
    return {
        ...input,
        label: catalogItem.label,
        severity: catalogItem.severity,
        title: catalogItem.title,
        explanation: catalogItem.explanation,
    };
}

export const mockWorkbenchSchema: WorldSchemaProjectionDto = {
    calendar: {
        format: "C{chapter}:{minute}:{second}",
        examples: ["C01:00:00", "C02:12:30", "C03:24:00"],
    },
    subjectTypes: [
        {
            type: "world",
            desc: "全局世界状态，承载气候、时代、公共事件。",
            attrs: [
                {name: "era", kind: "scalar", type: "text", default: "雨城纪元"},
                {name: "events", kind: "list", itemType: "text", default: []},
                {name: "weather", kind: "scalar", type: "text"},
            ],
        },
        {
            type: "location",
            desc: "地点或区域主体。",
            attrs: [
                {name: "name", kind: "scalar", type: "text"},
                {name: "security", kind: "object", fields: {
                    level: {name: "level", kind: "scalar", type: "text"},
                    locked: {name: "locked", kind: "scalar", type: "bool"},
                }},
                {name: "events", kind: "list", itemType: "text", default: []},
            ],
        },
        {
            type: "character",
            desc: "人物状态，包括位置、背包、关系与记忆。",
            attrs: [
                {name: "location", kind: "scalar", type: "ref(location)"},
                {name: "inventory", kind: "collection", itemType: "ref(item)", default: []},
                {name: "hp", kind: "scalar", type: "int", default: 100},
                {name: "memory", kind: "object", itemType: "text"},
                {name: "events", kind: "list", itemType: "text", default: []},
            ],
        },
        {
            type: "item",
            desc: "可被持有、使用或追踪来源的物品。",
            attrs: [
                {name: "owner", kind: "scalar", type: "ref(character)"},
                {name: "durability", kind: "scalar", type: "int", default: 100},
                {name: "provenance", kind: "scalar", type: "text"},
                {name: "events", kind: "list", itemType: "text", default: []},
            ],
        },
    ],
};

export const mockWorkbenchSubjects: WorldWorkbenchPreviewSubject[] = [
    {id: "world", type: "world", name: "雨城"},
    {id: "capital", type: "location", name: "王都"},
    {id: "east-tower", type: "location", name: "东塔"},
    {id: "erina", type: "character", name: "艾莉娜"},
    {id: "moran", type: "character", name: "莫然"},
    {id: "old-sword", type: "item", name: "旧剑"},
];

export const mockWorkbenchSubjectSystemSummaries: WorldWorkbenchPreviewSubjectSystemSummary[] = [
    {
        actorImportPath: "simulation/subjects/erina/soul.md",
        canonicalSource: "reference/mock/erina.md",
        controlledBy: "simulator",
        directStatePath: "simulation/subjects/erina/state.md",
        displayName: "艾莉娜",
        eventCount: 8,
        leaderOnlyPath: "simulation/subjects/erina/subject.md",
        legacyKind: "npc",
        memoryCount: 3,
        mindFileExists: true,
        profile: "simulator.actor",
        ragIndexSources: [
            {label: "events", path: "simulation/subjects/erina/events.jsonl"},
            {label: "memory", path: "simulation/subjects/erina/memory.jsonl"},
        ],
        sourcePath: "simulation/subjects/erina",
        sourceStatuses: [
            {source: "events", status: "dirty", recordCount: 8, indexedAt: null, lastError: null},
            {source: "memory", status: "synced", recordCount: 3, indexedAt: "2026-06-22T00:00:00.000Z", lastError: null},
        ],
        stateFileExists: true,
        subjectFileExists: true,
        subjectFiles: [
            {label: "subject", path: "simulation/subjects/erina/subject.md"},
            {label: "soul", path: "simulation/subjects/erina/soul.md"},
            {label: "mind", path: "simulation/subjects/erina/mind.md"},
            {label: "state", path: "simulation/subjects/erina/state.md"},
            {label: "events", path: "simulation/subjects/erina/events.jsonl"},
            {label: "memory", path: "simulation/subjects/erina/memory.jsonl"},
        ],
        subjectId: "erina",
        subjectSystemVersion: "mock-simulation-subjects",
        syncStatus: "linked",
        soulFileExists: true,
    },
    {
        actorImportPath: "simulation/subjects/moran/soul.md",
        canonicalSource: "reference/mock/moran.md",
        controlledBy: "simulator",
        directStatePath: "simulation/subjects/moran/state.md",
        displayName: "莫然",
        eventCount: 4,
        leaderOnlyPath: "simulation/subjects/moran/subject.md",
        legacyKind: "npc",
        memoryCount: 2,
        mindFileExists: true,
        profile: "simulator.actor",
        ragIndexSources: [
            {label: "events", path: "simulation/subjects/moran/events.jsonl"},
            {label: "memory", path: "simulation/subjects/moran/memory.jsonl"},
        ],
        sourcePath: "simulation/subjects/moran",
        sourceStatuses: [],
        stateFileExists: true,
        subjectFileExists: true,
        subjectFiles: [
            {label: "subject", path: "simulation/subjects/moran/subject.md"},
            {label: "soul", path: "simulation/subjects/moran/soul.md"},
            {label: "mind", path: "simulation/subjects/moran/mind.md"},
            {label: "state", path: "simulation/subjects/moran/state.md"},
            {label: "events", path: "simulation/subjects/moran/events.jsonl"},
            {label: "memory", path: "simulation/subjects/moran/memory.jsonl"},
        ],
        subjectId: "moran",
        subjectSystemVersion: "mock-simulation-subjects",
        syncStatus: "linked",
        soulFileExists: true,
    },
];

export const mockWorkbenchSlices: WorldWorkbenchPreviewSlice[] = [
    {
        id: "slice-world-init",
        time: "C01:00:00",
        title: "世界初始化：雨城进入持续暴雨",
        summary: "建立世界、王都与东塔的初始状态；暴雨成为后续行动限制。",
        kind: "init",
        mutations: [
            {subjectId: "world", path: "/era", op: "replace", value: "雨城纪元"},
            {subjectId: "world", path: "/weather", op: "replace", value: "持续暴雨"},
            {subjectId: "capital", path: "/name", op: "replace", value: "王都"},
            {subjectId: "east-tower", path: "/security", op: "replace", value: {level: "normal", locked: true}},
        ],
    },
    {
        id: "slice-erina-arrives",
        time: "C01:18:20",
        title: "艾莉娜抵达王都",
        summary: "艾莉娜进入王都并拾起旧剑；王都事件列表记录她的抵达。",
        kind: "event",
        mutations: [
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://capital"},
            {subjectId: "erina", path: "/inventory", op: "append", value: "subject://old-sword"},
            {subjectId: "erina", path: "/events", op: "append", value: "抵达王都并拾起旧剑"},
            {subjectId: "old-sword", path: "/owner", op: "replace", value: "subject://erina"},
            {subjectId: "old-sword", path: "/durability", op: "increment", value: -5},
            {subjectId: "capital", path: "/events", op: "append", value: "艾莉娜抵达王都"},
        ],
    },
    {
        id: "slice-moran-tip",
        time: "C02:09:10",
        title: "莫然交出东塔门禁线索",
        summary: "莫然告诉艾莉娜东塔地下层仍可通过旧钥匙进入，补充了人物记忆和物品来源。",
        kind: "event",
        mutations: [
            {subjectId: "moran", path: "/location", op: "replace", value: "subject://capital"},
            {subjectId: "moran", path: "/memory/东塔", op: "replace", value: "旧门禁记录仍可用"},
            {subjectId: "erina", path: "/memory/东塔线索", op: "replace", value: "莫然提到东塔地下层"},
            {subjectId: "old-sword", path: "/provenance", op: "replace", value: "东塔档案室旧物"},
        ],
    },
    {
        id: "slice-east-tower-opened",
        time: "C03:00:15",
        title: "东塔地下层被打开",
        summary: "艾莉娜使用旧剑柄内的钥匙进入东塔地下层，地点安全等级升高。",
        kind: "event",
        mutations: [
            {subjectId: "erina", path: "/location", op: "replace", value: "subject://east-tower"},
            {subjectId: "erina", path: "/events", op: "append", value: "进入东塔地下层"},
            {subjectId: "east-tower", path: "/security", op: "replace", value: {level: "alert", locked: false}},
            {subjectId: "old-sword", path: "/durability", op: "increment", value: -15},
        ],
        issues: [
            mockIssue({code: "base-shifted", sliceId: "slice-east-tower-opened", subjectId: "old-sword", attr: "durability", message: "旧剑耐久被提前消耗，后续相对变更需要确认。"}),
        ],
    },
    {
        id: "slice-old-sword-backstory",
        time: "C03:12:40",
        title: "旧剑旧伤浮现",
        summary: "补充旧剑在东塔开启前后的暗伤来源，并把耐久设为人工复核后的绝对值。",
        kind: "backstory",
        mutations: [
            {subjectId: "old-sword", path: "/durability", op: "replace", value: 82},
            {subjectId: "old-sword", path: "/events", op: "append", value: "旧伤来源经复核补入时间线"},
            {subjectId: "erina", path: "/memory/旧剑状况", op: "replace", value: "剑柄机关造成额外磨损但仍可使用"},
        ],
        issues: [
            mockIssue({code: "masked", sliceId: "slice-old-sword-backstory", subjectId: "erina", attr: "memory.旧剑状况", message: "旧剑旧伤补充可能遮蔽艾莉娜此前对东塔线索的理解，需要确认人物记忆是否仍连贯。"}),
        ],
    },
    {
        id: "slice-erina-hands-sword",
        time: "C03:24:30",
        title: "艾莉娜把旧剑交给莫然",
        summary: "艾莉娜把旧剑交给莫然保管，人物背包和物品 owner 同步变化，用于验证 remove/append 编辑路径。",
        kind: "event",
        mutations: [
            {subjectId: "erina", path: "/inventory/0", op: "remove"},
            {subjectId: "moran", path: "/inventory", op: "append", value: "subject://old-sword"},
            {subjectId: "old-sword", path: "/owner", op: "replace", value: "subject://moran"},
            {subjectId: "moran", path: "/events", op: "append", value: "接过旧剑保管"},
        ],
    },
];

export const mockWorkbenchSnapshots: WorldWorkbenchPreviewSnapshot[] = [
    {
        sliceId: "slice-world-init",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: []}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "normal", locked: true}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, inventory: [], events: []}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, inventory: [], events: []}},
            {subjectId: "old-sword", type: "item", attrs: {durability: 100, events: []}},
        ],
    },
    {
        sliceId: "slice-erina-arrives",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: ["艾莉娜抵达王都"]}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "normal", locked: true}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://capital", inventory: ["subject://old-sword"], events: ["抵达王都并拾起旧剑"]}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, inventory: [], events: []}},
            {subjectId: "old-sword", type: "item", attrs: {owner: "subject://erina", durability: 95, events: []}},
        ],
    },
    {
        sliceId: "slice-moran-tip",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: ["艾莉娜抵达王都"]}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "normal", locked: true}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://capital", inventory: ["subject://old-sword"], memory: {"东塔线索": "莫然提到东塔地下层"}, events: ["抵达王都并拾起旧剑"]}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, location: "subject://capital", memory: {"东塔": "旧门禁记录仍可用"}, inventory: [], events: []}},
            {subjectId: "old-sword", type: "item", attrs: {owner: "subject://erina", durability: 95, provenance: "东塔档案室旧物", events: []}},
        ],
    },
    {
        sliceId: "slice-east-tower-opened",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: ["艾莉娜抵达王都"]}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "alert", locked: false}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://east-tower", inventory: ["subject://old-sword"], memory: {"东塔线索": "莫然提到东塔地下层"}, events: ["抵达王都并拾起旧剑", "进入东塔地下层"]}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, location: "subject://capital", memory: {"东塔": "旧门禁记录仍可用"}, inventory: [], events: []}},
            {subjectId: "old-sword", type: "item", attrs: {owner: "subject://erina", durability: 80, provenance: "东塔档案室旧物", events: []}},
        ],
    },
    {
        sliceId: "slice-old-sword-backstory",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: ["艾莉娜抵达王都"]}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "alert", locked: false}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://east-tower", inventory: ["subject://old-sword"], memory: {"东塔线索": "莫然提到东塔地下层", "旧剑状况": "剑柄机关造成额外磨损但仍可使用"}, events: ["抵达王都并拾起旧剑", "进入东塔地下层"]}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, location: "subject://capital", memory: {"东塔": "旧门禁记录仍可用"}, inventory: [], events: []}},
            {subjectId: "old-sword", type: "item", attrs: {owner: "subject://erina", durability: 82, provenance: "东塔档案室旧物", events: ["旧伤来源经复核补入时间线"]}},
        ],
    },
    {
        sliceId: "slice-erina-hands-sword",
        subjects: [
            {subjectId: "world", type: "world", attrs: {era: "雨城纪元", weather: "持续暴雨", events: []}},
            {subjectId: "capital", type: "location", attrs: {name: "王都", events: ["艾莉娜抵达王都"]}},
            {subjectId: "east-tower", type: "location", attrs: {security: {level: "alert", locked: false}, events: []}},
            {subjectId: "erina", type: "character", attrs: {hp: 100, location: "subject://east-tower", inventory: [], memory: {"东塔线索": "莫然提到东塔地下层", "旧剑状况": "剑柄机关造成额外磨损但仍可使用"}, events: ["抵达王都并拾起旧剑", "进入东塔地下层"]}},
            {subjectId: "moran", type: "character", attrs: {hp: 100, location: "subject://capital", memory: {"东塔": "旧门禁记录仍可用"}, inventory: ["subject://old-sword"], events: ["接过旧剑保管"]}},
            {subjectId: "old-sword", type: "item", attrs: {owner: "subject://moran", durability: 82, provenance: "东塔档案室旧物", events: ["旧伤来源经复核补入时间线"]}},
        ],
    },
];

/** 克隆 mock slice，避免预览页本地编辑污染模块级常量。 */
export function cloneMockWorkbenchSlices(): WorldWorkbenchPreviewSlice[] {
    return JSON.parse(JSON.stringify(mockWorkbenchSlices)) as WorldWorkbenchPreviewSlice[];
}

/** 克隆 mock snapshot，保持预览页状态与常量隔离。 */
export function cloneMockWorkbenchSnapshots(): WorldWorkbenchPreviewSnapshot[] {
    return JSON.parse(JSON.stringify(mockWorkbenchSnapshots)) as WorldWorkbenchPreviewSnapshot[];
}

/** 返回指定 slice 的 State Snapshot；找不到时返回空结果。 */
export function findMockSnapshot(sliceId: string, snapshots: WorldWorkbenchPreviewSnapshot[]): SubjectStateDto[] {
    return snapshots.find((snapshot) => snapshot.sliceId === sliceId)?.subjects ?? [];
}
