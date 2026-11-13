# Local development tools (never deployed)

Everything in `dev-tools/` exists only for local Challenge balancing. `npm run build` copies just the
seven runtime files into `dist/` and strips the `@dev-only` lines from `game.js`. The build fails if any
dev-only text remains.

```
dev-tools/
  build.cjs                    npm run build → dist/ (static, Cloudflare Pages-ready)
  local-server/server.cjs      npm run dev (editor + test game + save API), npm run preview (serves dist/)
  local-server/config-file.cjs read / validate / back up / atomically write challenge-config.js
  difficulty-editor/           editor UI, baseline-config.json, test-harness.js (injected into /game/ only)
  backups/                     automatic copy of challenge-config.js before every save (git-ignored)
```

## Daily workflow (macOS)

1. In Terminal: `cd ~/"Website Repositories/Vectrex Asteroid"` then `npm run dev`.
   The editor opens at http://127.0.0.1:4317/editor/. If that port is busy, the server uses the next free one; the URL is printed in Terminal.
2. Pick a wave (1–13) and drag the sliders. The exact value sits beside each slider, and you can type a precise number there.
3. Press **▶ Test wave**. The game beside the editor starts that wave immediately with your **unsaved** values.
   Click the game and fly. Clicking back into the editor pauses the game; press P or Resume to continue.
4. Read the metrics under the game. Untick "Current settings only" to compare all runs of that wave.
5. Press **Save changes** (or ⌘S). This writes `challenge-config.js` and backs up the previous file to `dev-tools/backups/`.
6. `npm run build`, then in SitePush select the **`dist`** folder.
7. Stop the server with Ctrl+C.

`npm run preview` serves the built `dist/` at http://127.0.0.1:4318/ exactly as it will be deployed. It's read-only and has no editor.

## Controls and what they change

| Control | Engine parameter (per wave) | Unit |
| --- | --- | --- |
| Large mines | number of initial large mines (`count`) | mines |
| Nominal speed | large-mine base speed; medium/small add the fragment boost per size step | world units/sec (field is 900×620; ship max 350) |
| Speed variation min/max | each mine's random speed multiplier | × |
| Steering | turn rate for Curve (steady) and Surge/Weave (oscillating); Drift ignores it | rad/s |
| Aggression (speed pulse) | Surge/Weave speed swing | ±% of base speed |
| Behavior mix | exact Drift / Curve / Surge / Weave quotas; Drift fills the remainder; fragments inherit | mines |
| Large / Medium splits into | fragments per split | pieces |
| Fragment speed boost | speed added per size step below large | u/s |
| Campaign settings | starting ships, bonus-ship waves, active-mine cap (≤ 72), record version | |

**Adjust a range of waves** can scale a setting by a percentage, add a fixed amount, ramp evenly between the two end waves, or copy the selected wave's value (or all of its settings) to the range.

**Restore saved** discards unsaved edits and reloads the file from disk. **Reset to baseline** loads the balanced-v2 values into the editor; nothing is written until you Save.

**Record version.** Players' Challenge records are stored under `minefield.challenge.<version>`. If a rebalance makes old scores incomparable, change the version so new records start fresh.

The in-game help text and menu (for example "bonus ships on 4 & 8") are static. Update `index.html` by hand if you change those campaign rules.

## Testing options

- **Fixed seed**: the same seed gives the same spawn positions, headings, speeds and behaviors on every restart.
- **Ships**: "Campaign" gives the lives a player would have on reaching that wave (3 plus earned bonuses), or pick a fixed number.
- **Stop after clear**: shows a WAVE CLEARED result instead of continuing. Press Enter to retry.
- **Restart on change**: restarts the wave whenever you change a setting.
- **⧉ Pop out**: opens the game in its own window, which stays linked to the editor.

Steering and pulse changes take effect mid-flight. Mine counts, speeds and splits take effect on the next spawn or restart.

## Safety

- The server listens on 127.0.0.1 only and rejects requests whose Host or Origin header isn't local.
- The only write the server can make is `challenge-config.js`, plus its timestamped backup. No other file can be written, and no file path is accepted from requests.
- Every save is validated (ranges, behavior totals, worst-case peak ≤ the active-mine cap, fastest mine ≤ 360 u/s), round-trip checked, written to a temp file, fsynced and renamed into place.
- The game page validates the config again at load. `npm run build` refuses to build an invalid config.
- Test runs (the `/game/` page with the injected harness) never save scores or records. Test metrics stay in the editor's local browser storage; use **Export JSON** to keep a copy.
