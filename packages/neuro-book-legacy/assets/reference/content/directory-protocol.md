# Directory Protocol

This file is a compatibility index for older references to the former all-in-one directory protocol.

Current canonical documents are split by responsibility:

- [project-structure.md](project-structure.md): Project Workspace overview, first two levels and top-level directory boundaries.
- [lorebook.md](lorebook.md): `lorebook/` as mostly stateless canon, prototypes, rules and AI instructions.
- [manual.md](manual.md): `manual/` as play handbooks, player guide, GM guide, rules guide and quick reference.
- [manuscript.md](manuscript.md): `manuscript/` volumes, chapters, drafts and chapter-local notes.
- [simulation.md](simulation.md): `simulation/`, subjects, entities, runs and simulation profile contracts.
- [information-control.md](information-control.md): Prototype / Entity / Subject information-control model.
- [content-references.md](content-references.md): Inline Markdown links, structured refs and validation rules.
- [retrieval.md](retrieval.md): Retrieval / inject frontmatter and writer handoff contract.
- [state.md](state.md): Legacy content-node `state.md` compatibility.

## Reading Rule

Do not extend this compatibility file with new protocol details. Add new stable rules to the narrow document that owns the topic, then link it here only when older readers need a bridge.

For profile imports, prefer importing the narrow document directly. For example:

- `simulator.leader` should import [project-structure.md](project-structure.md) and [simulation.md](simulation.md).
- lorebook migration tools should import [lorebook.md](lorebook.md) and [information-control.md](information-control.md).
- content validators should import [content-references.md](content-references.md).
