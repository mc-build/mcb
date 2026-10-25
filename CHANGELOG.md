# Changelog

All notable changes to `mc-build`.

## 4.3.0

### New

- **More data pack file types.** Added keywords for `banner_pattern`,
  `painting_variant` ([#27](https://github.com/mc-build/mcb/issues/27)), `jukebox_song`, `trim_material`, `trim_pattern`,
  `instrument`, `dialog`, `timeline`, `world_clock`, the mob `*_variant` types
  and more. Each one writes to the folder of the same name.
- **`json <folder> <name>`** writes any data pack JSON file, so you can use a new
  file type before mcb has a keyword for it.

  ```mcb
  json some_new_type foo { "a": 1 }
  # -> data/<namespace>/some_new_type/foo.json
  ```

- **Single-line bodies.** Tags, JSON files and `worldgen` files can now fit on one
  line. Separate tag entries with commas.

  ```mcb
  damage_type foo { "message_id": "generic", "scaling": "never", "exhaustion": 0 }
  tag blocks bar { minecraft:stone, minecraft:dirt replace, #minecraft:logs }
  ```

- **Top-level template calls.** A template can now have a `tld with` overload.
  You can call it at the top level of a `.mcb` file, and its body can hold
  anything a file can: functions, `dir`s, JSON files, tags and more. Calls inside
  `dir` blocks use that path. A template can have both `tld with` and `with`
  overloads.

  ```mcb
  # lib.mcbt
  template counter {
      tld with name:word {
          function <%name%>_inc {
              scoreboard players add #<%name%> counters 1
          }
      }
  }

  # main.mcb
  import ./lib.mcbt
  counter kills
  counter deaths
  ```

### Fixes

- `worldgen` files with nested objects across several lines no longer fail with
  "Unexpected extra data in json tag" ([#33](https://github.com/mc-build/mcb/issues/33)).
- `damage_type` files now go to `damage_type/`, not `damage/`
  ([#33](https://github.com/mc-build/mcb/issues/33)). You can drop any
  `../damage_type/` path workaround.
- `chat_type` files now go to `chat_type/`, not `chat/`.
- Before pack format 48, tags such as `worldgen/biome` and `damage_type` no longer
  get an extra `s` (`tags/worldgen/biomes`). Only `blocks`, `items`,
  `entity_types`, `fluids` and `game_events` were ever plural.
- Text after an `execute if/unless { ... }` block's closing brace now joins the same
  command, so `} run say hi` gives `execute if function ... run say hi`, not two
  lines ([#23](https://github.com/mc-build/mcb/issues/23)).
- `mcb watch` now detects changes in projects whose path contains glob characters
  such as `[` and `]` ([#32](https://github.com/mc-build/mcb/issues/32)).
- `.mcb/fs-cache.txt` now uses `/` on every OS, so it no longer changes between
  Windows and macOS/Linux ([#31](https://github.com/mc-build/mcb/issues/31)).

## 4.2.0

First release published to the stable (`latest`) tag, and the first built on the
new TypeScript compiler. This release focuses on the language itself — richer
templates and a number of parsing/syntax improvements — since **3.5.1**.

### Breaking changes

- **Implicit function resolution has been removed.** References to a bare function
  name are no longer auto-resolved to the current namespace/path. Prefix the name
  with `./` (or use an explicit `namespace:path`) to get the previous behavior.

  ```mcb
  function test {
      # Before 4.2.0 — implicitly resolved to this file's namespace/path:
      function demo          # ❌ now a compile error

      # After — be explicit:
      function ./demo        # relative to the current file
      schedule function ./demo 1t
  }
  ```

### Templates

- Templates can now contain comments.
- Added `isMacro` to the template context, enabling basic macro-syntax
  interactivity inside templates.
- Templates now correctly receive arguments from parent scopes.
- Raw tokens passed as template parameters are resolved to their string value.
- Fixed template matching so it no longer requires a space after the matched
  token.

### Language & syntax

- Added support for **escaped comments** in the compiler and parser. A normal `#`
  comment is stripped at build time; prefix it with `\` to keep it in the
  generated `.mcfunction` output (e.g. as an in-game comment).

  ```mcb
  function test {
      # discarded at build time
      \# kept in the generated output
  }
  ```

- Kept comments (an escaped `\#`, or a `###` comment) now have their `<% %>`
  expressions evaluated, so an emitted comment can include computed values.
  Discarded `#` comments are left untouched.

  ```mcb
  function test {
      \# spawn count: <% 4 * 5 %>
  }
  # emits the comment: # spawn count: 20
  ```

- Multi-line commands: a trailing `\` continuation now joins lines correctly
  without inserting an unexpected extra space.

  ```mcb
  function foobarbazboo {
      say \
      hi
  }
  # compiles to a single command: "say hi"
  ```

- `REPEAT` now allows underscores in variable names, and no longer hangs on loops
  that previously ran forever.
- `emit.mcb` can inline-emit `BoundBlock` instances and pulls in templates from
  the surrounding execution scope; clearer errors when `emit`/`embed` are misused.
- McMath: fixed identifier parsing, including identifiers that begin with a digit.
- Text placed immediately after a block is now handled correctly.
- Fixed multi-line command handling when the command sentinel length is changed.
- Inline JS blocks now report the correct line numbers in errors.
- Fixed a function-ID allocation bug that could misgenerate self-referencing
  `schedule` blocks.
- JSON file names may now contain script expressions.
- `config.setup` may now use async callbacks.

### CLI & workflow

- Added a `--version` / `-v` flag, and mcb's console log prefix now shows its
  version (e.g. `[MCB 4.2.0]`).
- Faster, more reliable file watching (reduced debounce, `awaitWriteFinish`).
- Now ships generated TypeScript type definitions for the API.
- Fixed resolving `pack.mcmeta` relative to the project's base directory rather
  than the current working directory.
- Removed a top-level `createRequire` call so mcb runs in environments that don't
  support or allow `node:module`.

---

_Under the hood, the compiler was rewritten from Haxe to TypeScript; the legacy
Haxe implementation and mc-build language library support were removed._

_Previous baseline: 3.5.1 (2024-12-30)._
