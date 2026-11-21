# Translation in code: how to wrap a sentence

One function for the whole app: `tr()` from `src/shared/i18n` (no React, no Electron, works in
the screens, the main process and `core`). The English sentence is the key; a missing translation
shows the English sentence.

```ts
import { tr, trPlural } from '../../shared/i18n';

tr('The VPN service is off.')
tr('Switching to {place}…', { place })                 // placeholders: {name}, never ${…}
tr('Open', undefined, 'menu')                          // context tag: same words, other meaning
trPlural({ one: '{n} server', other: '{n} servers' }, count)
```

## Rules

1. **The first argument is a plain string.** No `${…}`, no `+`, no variable: the extract script
   must read it. Values go in as `{name}` placeholders with a `vars` object. The script fails on
   anything else and names the line.
2. **Whole sentences, never pieces.** `tr('Paid {amount} to {server}.')`, not
   `tr('Paid') + amount + tr('to') + …`. Word order differs between languages.
3. **One or two words get a context tag** when the same words can mean two things (`Open` a menu
   vs `Open` status, `Close` a window vs a deposit that `closes`). The tag is a short plain word:
   `'menu'`, `'status'`, `'button'`, `'deposit'`. `node scripts/i18n-extract.mjs --short` lists
   every one- or two-word key with no tag; each one is either tagged or confirmed as unambiguous.
4. **Counts use `trPlural`** with `one` and `other` in English; each language supplies its own forms
   (Arabic has six). `{n}` is filled with the count in that language's digits.
5. **Numbers, dates, lists** use `formatNumber`, `formatDate`, `formatList` from the same module.
   Amounts in tDVPN / SOL keep the existing formatters (`shared/format.ts`) and go into a sentence
   as a placeholder.
6. **A sentence held in a module constant becomes a function read at use** (`const titleOff = () =>
   tr('…')`), or the language is frozen at start. After a language change the main process re-sends
   its current state, so a sentence composed there arrives in the new language.
7. **Saved text stores a reason code**, and the sentence is composed when it is shown. History,
   last-ended notes and anything written to disk never hold a translated sentence.

## Never wrapped

- **Log lines** (`log.*`, `console.*`): logs stay English.
- **The terminal** (`src/cli/**`): its sentences, JSON codes and field names stay as they are; it
  belongs to another session and agents parse it.
- **Names**: Devnet dVPN, Sentinel, Solana, tDVPN, SOL, protocol names (WireGuard, AmneziaWG,
  OpenVPN, V2Ray, Xray …). They sit inside a sentence as written.
- **Machine text**: addresses, hashes, commands (`devnet-dvpn daemon install --yes`), error codes,
  URLs, file paths, IPC channels, settings keys, `data-*` hooks, test ids.
- **Programmer invariants** a person never sees: mark the line `// copy:internal`.
- A string the census picks up wrongly: mark the line `// i18n:skip` and say why in the commit.

## Working in parallel (B3)

- B3 is split by folder (screens / `core` and `shared` / main process). Each session wraps only the
  files it was given, **one file per commit**, suite green each time.
- **The English files `src/shared/i18n/locales/en/{screens,core,main}.json` are generated, never
  edited by hand.** Before each commit run `node scripts/i18n-extract.mjs`. Keys are sorted, so the
  files come out the same whatever order the commits land in; on a conflict, take either side and
  run the script again.
- **Chunks by origin:** `screens` = `src/renderer`, `core` = `src/core` + `src/shared`, `main` =
  `src/main` + `src/preload`. A sentence used in two places lives in the first of screens, core,
  main. Every language has the same three files (`locales/<code>/<chunk>.json`), so translators
  can work on different chunks or languages at once. When a sentence moves chunk, or English drops
  one, `node scripts/i18n-extract.mjs --sync` lays every language out like English again and lists
  what it dropped.
- **Money and safety sentences** (paying, deposits, refunds, the recovery phrase, the kill switch,
  blocked internet) are tagged from their English words by the script (`--all` → `safety`). Where the
  words do not show it, add `// i18n:safety=<money|refund|recovery-phrase|kill-switch|blocked-internet>`
  on the line, or use a context tag that starts with that name. Every sentence is translated back
  by a session other than the translator; tagged sentences get a second translate-back by a third
  session.
- After converting a file, add it to `CONVERTED` in `tests/unit/i18n-wrapped.test.ts` (one line
  per file, kept in alphabetical order so two sessions' lines do not collide). That test fails on any
  sentence in a converted file that does not go through `tr()`
  (`node scripts/i18n-extract.mjs --unwrapped <file>` shows them).
- Tests that pin an English sentence stay valid: English is the key and the default.

## Language files and term sheets

- `locales/<code>/<chunk>.json`: one flat object; key = the English key exactly as in the English
  chunk, value = the translation. `{name}` placeholders kept, never translated. A context key is
  `<tag>\u0004<English>`; a plural key ends in `\u0005plural` and holds that language's own forms
  (`zero one two few many other`, as `Intl.PluralRules` gives them). An empty value shows English.
- `docs/i18n/terms/<code>.json`: `{ language, reviewed, rules, terms: [{ id, en: [English forms],
  word, forms: [accepted spellings], status: confirmed|unconfirmed, examples, rejected: [{ word, why }] }] }`.
  `en` forms match whole words in any case; `forms` match as substrings (stems are fine). An entry
  with `"kind": "phrase"` is checked by the translate-back, not by `i18n-terms.mjs`.

## Checks

| Command | What |
|---|---|
| `node scripts/i18n-extract.mjs` | write the English chunks |
| `node scripts/i18n-extract.mjs --check` | fail if they are out of date |
| `node scripts/i18n-extract.mjs --sync` | lay every language out like English, list dropped entries |
| `node scripts/i18n-extract.mjs --all` | every sentence (wrapped or not) with file:line, folder, safety tags; word frequencies |
| `node scripts/i18n-terms.mjs <code>` / `--all` | translated sentences that lack the term sheet's chosen word |
| `node scripts/i18n-banned.mjs [--diff <file>]` | banned names: fails in the language work and in a diff's added lines (`git diff -U0 <FINAL>`), lists other files |
| `node scripts/i18n-extract.mjs --census` | sentences still unwrapped, per folder; left/right classes |
| `node scripts/i18n-extract.mjs --unwrapped <files>` | the unwrapped sentences in those files |
| `node scripts/i18n-extract.mjs --short` | one- and two-word keys without a context tag |
| `npx vitest run tests/unit/i18n-gates.test.ts` | same entries in every file, placeholders, right-to-left guard, switched-off language loads |
