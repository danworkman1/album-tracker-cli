# Rust Learning Plan — porting album-tracker-cli

The JS version stays as-is (this repo, deployable to npm). The Rust port lives in a
**sibling directory** (`~/album-tracker-rs`) and exists purely to learn Rust by
rebuilding a tool whose behaviour is already known. Every bug becomes a language
lesson rather than a design problem.

**Why this is a learning project, not an engineering win:** the tool is I/O-bound
(Wikipedia fetches, Spotify/Google API calls) and human-bound (interactive
multiselect). Rust only speeds up CPU work, of which this app has ~50–100ms worth.
The port is for learning the language, not performance.

---

## Setup status

- [x] Toolchain installed via rustup (`curl ... https://sh.rustup.rs | sh`)
- [ ] Verify: `cargo --version` (restart shell or `source ~/.cargo/env` first)
- [ ] Create project: `cd ~ && cargo new album-tracker-rs && cd album-tracker-rs && cargo run`
- [ ] VS Code: install the **rust-analyzer** extension (official, by "The Rust
      Programming Language" — not the deprecated "Rust" extension)
- [ ] VS Code settings:
  - `rust-analyzer.check.command` → `"clippy"` (inline lint hints on save)
  - format-on-save for Rust (rustfmt, zero config)

### What the toolchain gives you

- **rustup** — version manager (like nvm)
- **cargo** — the everything-tool: pnpm + node + test runner + linter driver.
  You live in cargo; you almost never call `rustc` directly.
- **clippy / rustfmt** — bundled linter and formatter, invoked through cargo

### Project layout after `cargo new`

```
album-tracker-rs/
├── Cargo.toml      # package.json equivalent
├── Cargo.lock      # pnpm-lock.yaml equivalent, auto-managed
└── src/main.rs     # entry point; fn main() is cli.js
```

---

## Porting order (escalating difficulty, one Rust concept cluster each)

Add dependencies with `cargo add` **only when you reach each module** — that's how
you learn what each one is for.

### Module 1 — `calendar.js` (parseWikiDate + ICS formatting)

Pure functions, zero I/O. Teaches structs, `Option`, pattern matching, string
formatting, and `cargo test`. Port the JS behaviour into unit tests first so the
Rust version is verified before it ever runs for real.

```bash
cargo add chrono
```

### Module 2 — `scraper.js`

`reqwest` with the **blocking** feature (deliberately skip async — the app is
sequential; async Rust is a second mountain to climb separately) and the `scraper`
crate for CSS selectors. Teaches `Result`, the `?` operator, `anyhow`. This is
where Rust's friction is most honest: every `.find()` that can fail must be handled.

```bash
cargo add reqwest --features blocking
cargo add scraper anyhow
```

### Module 3 — interactive selection (from `cli.js`)

`inquire` gives a filterable `MultiSelect` close to the `prompts`
autocompleteMultiselect. Teaches closures, `sort_by`, ownership when moving album
data into choices.

```bash
cargo add inquire
```

### Module 4 — `spotify.js` OAuth (do Google Calendar after, or skip — same patterns)

`serde`/`serde_json` for the token file — a genuine upgrade over JS: define the
auth file's shape as a struct and parsing is one line. `tiny_http` for the
localhost callback server; the `open` crate exists in Rust too.

```bash
cargo add serde --features derive
cargo add serde_json tiny_http open
```

### Deliberate simplifications while learning

- **Blocking reqwest, no tokio** — no async until the port works
- **`anyhow` for errors** — hand-rolled error enums are a later topic

---

## The daily loop

JS loop is *edit → node → look*. Rust equivalent:

```bash
cargo check    # fast "does it compile?" — no binary. Run constantly.
cargo run      # compile + run
cargo test     # unit tests
cargo clippy   # lint with explanations
```

`cargo check` is the habit to build. In Rust, "it compiles" carries far more
meaning than in JS — most bugs Node would surface at runtime are caught there.

**Clippy is the tutor.** It names the idiom you should have used and links docs.
Example — porting a JS null-check habit literally:

```rust
if month_index.is_none() { return None; }
let idx = month_index.unwrap();
```

Clippy flags it and suggests the idiomatic form:

```rust
let idx = month_index?;
// or: let Some(idx) = month_index else { return None; };
```

Every clippy warning fixed is one JS-ism unlearned. `cargo clippy --fix` applies
the mechanical ones, but read them first — that's where the learning is.

When a compiler error is baffling: `rustc --explain E0308` (whatever the code is)
gives a long-form explanation with examples.

---

## The Book, mapped to modules

doc.rust-lang.org/book — also offline via `rustup doc --book`. Don't read
cover-to-cover; read each chapter when the port forces the topic.

| Before you port | Read | Because |
|---|---|---|
| Anything | Ch. 1–3 (syntax) + **Ch. 4 (ownership)** | Ch. 4 is *the* chapter — the borrow checker makes no sense without it. Read it slowly, twice. |
| Module 1 (`calendar.js`) | Ch. 5 (structs), Ch. 6 (enums & `Option`), Ch. 11 (tests) | Album object → `struct Album`; parseWikiDate's "maybe null" → `Option`; port JS behaviour as tests first. |
| Module 2 (`scraper.js`) | Ch. 9 (errors, `Result`, `?`) | Fetch, missing table, malformed rows all return `Result`; `?` propagation replaces try/catch. |
| Module 3 (multiselect) | Ch. 13 (closures & iterators) | `.map/.filter/.sort` chains have direct iterator equivalents — where Rust starts feeling nice instead of strict. |
| Module 4 (OAuth) | Ch. 8 (collections/Strings) + serde docs | JSON handling; serde isn't in the Book but its docs are excellent. |

**Rhythm:** read ch. 1–4, start module 1 immediately. Then: port a function → hit
a wall → read the chapter the wall belongs to → fix → `cargo clippy` → next function.

**Supplement:** Rustlings (rustlings.rust-lang.org) — fill-in-the-blank exercises
keyed to Book chapters. The ownership and error-handling sets are a gentler on-ramp
before modules 1–2.

---

## The one rule

**Don't peek at the JS and translate line-by-line.** Read what a module *does*,
then write it Rust-natively — otherwise you'll write JavaScript in Rust syntax and
fight the borrow checker constantly.
