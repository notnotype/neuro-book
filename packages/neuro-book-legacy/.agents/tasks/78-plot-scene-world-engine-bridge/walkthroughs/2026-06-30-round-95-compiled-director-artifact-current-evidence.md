# Round 95: Compiled Director Artifact Current Evidence

## Scope

本轮只读核对 system/user compiled profile manifest 与 director artifact 的当前证据。没有运行 profile compile 或 sync。

## Current Evidence

system compiled manifest:

```json
{
  "root": "system",
  "sourceSha256": "80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6",
  "artifactSha": "33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17",
  "sourceBytes": 6978,
  "artifactBytes": 1406808,
  "generatedAt": "2026-06-29T18:51:28.866Z"
}
```

user compiled manifest:

```json
{
  "root": "user",
  "sourceSha256": "80394e5e4ada1a54c87cb920526671392e493eb4bd060621ebc4efacb0a8ceb6",
  "artifactSha": "33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17",
  "sourceBytes": 6978,
  "artifactBytes": 1406808,
  "generatedAt": "2026-06-29T18:51:30.169Z"
}
```

Both roots currently point director to the same artifact sha:

```text
33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17
```

Both artifact files exist under:

- `assets/workspace/.nbook/agent/profiles/.compiled/artifacts/33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17.mjs`
- `workspace/.nbook/agent/profiles/.compiled/artifacts/33e5a16f233b94da0cd3785ae3e770e08311d735213030990fcc9c2d03e28d17.mjs`

`rg` confirms compiled artifacts still contain old director contract strings:

- `simulator_requests`
- `Simulation gate`
- `simulator.leader`

## Interpretation

This proves the current runtime artifact state is still old. It also proves user root is not diverged from system for director at this moment: same `sourceSha256`, same `artifactSha`, same bytes. That supports the non-force user assets sync strategy from Round 88, but actual implementation must still trust sync output and sync state at that time.

## Acceptance Impact

After Slice 1, runtime activation must verify all of the following:

1. system source no longer contains `simulator_requests` / `Simulation gate`.
2. system manifest `profiles.director.sourceSha256` changes.
3. system manifest `profiles.director.artifactSha` changes.
4. system artifact no longer contains old strings and contains `world_engine_requests`.
5. non-force user assets sync updates user director, or stops with warning if user file has been modified.
6. user manifest and user artifact match the intended new source/artifact.
7. active catalog / `get_agent_profile` sees new director contract.

## Conclusion

The current compiled evidence still contradicts completion. Slice 1 cannot be considered runtime-active until both system and active user director source/manifest/artifact move off artifact `33e5a16f...` and old simulator strings disappear from the artifact selected by the active catalog.
