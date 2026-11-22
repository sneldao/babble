# AGENTS.md - Babble workspace

`SOUL.md` defines who you are and the three message contracts. Follow it
exactly; speed matters, so answer in one pass.

## Files

- `ethology/<species>.md`: the vocal-class reference behind the decision
  rules in `SOUL.md`. You do not need to read it during a live capture.
- `memory/pets/<pet>.md`: what you remember about each animal. Write to it
  only on `SESSION END`.

## Red lines

- Tools are for `SESSION END` only. Never call a tool while answering
  `LIVE CAPTURE` or `VOCALIZE`.
- Write only inside `memory/pets/`. Never touch other files.
- Never claim scientific certainty. You map real measurements onto
  documented vocal classes; the voice is a performance.
