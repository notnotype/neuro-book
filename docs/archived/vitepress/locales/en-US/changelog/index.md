# Release History

Past release notes, grouped by release line. Notes for the **current** version are not here — they live in [`RELEASE.md`](https://github.com/notnotype/neuro-book/blob/master/RELEASE.md) at the repository root.

| Release line | Versions | Dates |
| --- | --- | --- |
| [0.9.x](./v0.9.md) | 0.9.0 – 0.9.3-canary | 2026-08-02 – 2026-08-07 |
| [0.8.x](./v0.8.md) | 0.8.0 – 0.8.19 | 2026-07-15 – 2026-07-25 |
| [0.7.x](./v0.7.md) | 0.7.0 – 0.7.10 | 2026-07-10 – 2026-07-13 |
| [0.5.x](./v0.5.md) | 0.5.0 – 0.5.7 | 2026-06-30 – 2026-07-06 |

## Reading the version number

Every version so far carries a `-canary` suffix, meaning "early validation build": the features work, but they may not have been through full manual acceptance yet. A full version number looks like this:

```
0.8.19-canary.20260720.112718Z.1b4c9685
└─┬──┘ └─┬──┘ └──────┬───────┘ └───┬──┘
version channel   release time    code
                     (UTC)      snapshot
```

The middle block is when it was published; the tail identifies the exact code it was built from. The installer (NeuroBook Manager) has its own version number, like `0.1.0-canary.30` — that is a separate thing from the app version.

## Missing a version?

0.5.4, 0.5.5, 0.6.x, 0.7.3 – 0.7.8, 0.8.1, 0.8.7 and 0.8.8 have no public release notes: they either failed during the build or never left internal candidate status. The gaps are intentional, not missing documentation.
