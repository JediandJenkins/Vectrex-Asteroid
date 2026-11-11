# Challenge balance — balanced-v2

Implemented after player feedback that Option B's finale exceeded Impossible's opening pressure. These are engine parameters chosen from mine-family budgets, existing movement behavior, and firing/collision mechanics; the requested 1.0–8.2 ratings are design goals, not measured scores or direct parameter multipliers.

## Actual 13-wave schedule

| Wave | Large mines | Nominal speed | Turn | Drift / Curve / Surge / Wave | Peak small mines |
| --- | ---: | ---: | ---: | --- | ---: |
| 1 | 3 | 30 | 0.28 | 3 / 0 / 0 / 0 | 18 |
| 2 | 3 | 32 | 0.28 | 3 / 0 / 0 / 0 | 18 |
| 3 | 4 | 34 | 0.28 | 4 / 0 / 0 / 0 | 24 |
| 4 | 4 | 37 | 0.30 | 3 / 1 / 0 / 0 | 24 |
| 5 | 4 | 40 | 0.32 | 2 / 2 / 0 / 0 | 24 |
| 6 | 5 | 44 | 0.34 | 3 / 2 / 0 / 0 | 30 |
| 7 | 5 | 48 | 0.36 | 2 / 2 / 1 / 0 | 30 |
| 8 | 6 | 52 | 0.38 | 3 / 2 / 1 / 0 | 36 |
| 9 | 6 | 56 | 0.40 | 2 / 2 / 2 / 0 | 36 |
| 10 | 6 | 60 | 0.42 | 2 / 2 / 1 / 1 | 36 |
| 11 | 7 | 64 | 0.44 | 3 / 2 / 1 / 1 | 42 |
| 12 | 7 | 68 | 0.47 | 2 / 2 / 2 / 1 | 42 |
| 13 | 8 | 72 | 0.50 | 3 / 2 / 2 / 1 | 48 |

Every wave uses **large → 3 medium; medium → 2 small**. Each initial family requires 10 destructions and awards 770 points. Fewer initial families offset the extra medium in the opening waves: wave 1 needs 30 destructions versus 28 in Option B. It has fewer large mines and lower speeds, although its theoretical small-mine peak is 18 rather than 16. Constant splitting removes the old wave-9 fragmentation discontinuity. Initial counts grow by at most one per wave; nominal speeds rise by 2–4 world units/sec.

Speed is still `(nominal + 26 × size stages below large) × random(0.85, 1.2)`. Turn is radians/sec before the existing phase factor. Surge and Wave retain their 0.78–1.22 speed modulation. The existing engine calls Wave behavior `weave`; its movement formula is unchanged. Curves start on wave 4, Surge on 7, and Wave on 10. Wave 10 replaces one Surge with one Wave rather than adding another aggressive family. Later waves never exceed two Surge and one Wave initial families. Assignment order, headings, speed multipliers and phases remain randomized; quotas and inherited child behaviors are deterministic.

## Finale comparison

| Parameter | Option B wave 13 | Revised wave 13 | Impossible wave 1 (unchanged) |
| --- | ---: | ---: | ---: |
| Initial large mines | 12 | 8 | 10 |
| Nominal large / medium / small speed | 190 / 216 / 242 | 72 / 98 / 124 | 88 / 122 / 156 |
| Turn coefficient | 0.80 | 0.50 | 0.80 |
| Drift / Curve / Surge / Wave families | 1 / 2 / 6 / 3 | 3 / 2 / 2 / 1 | 0 / 0 / random / random |
| Aggressive Surge + Wave families | 9 (75%) | 3 (37.5%) | 10 (100%) |
| Large / medium split counts | 3 / 2 | 3 / 2 | 3 / 3 |
| Peak live small mines | 72 | 48 | 72 under existing cap; 90 uncapped |
| Destructions if no fragments suppressed | 120 | 80 | 130 uncapped; actual depends on kill order/cap |
| Life opportunities over run | 3 initial + bonuses on 4/8 | 3 initial + bonuses on 4/8 | 1, no bonuses |

Impossible's initial behavior is independently 55% Wave, 45% Surge; all ten are aggressive. Revised Challenge has 20% fewer opening large mines, 33% fewer peak active small mines, slower enemies at every size, gentler steering, and five predictable Drift/Curve families. At the actual finale, surviving players have 1–5 ships, not five guaranteed. New-wave protection remains at least 2 seconds; Impossible's initial protection is 3 seconds. Challenge can respawn with 3 seconds of protection after a lost ship; Impossible cannot respawn. Player physics, weapons, collision radii, both other modes, and all protection timings are unchanged.

The global cap remains 72. A Challenge large has a six-leaf descendant budget; every intermediate object consumes at least one leaf. With at most eight families, no destruction order can exceed 48 live objects or clip a fragment. Mixed-size scenes fit this bound too.

## Verification and repeatable pressure probes

Run `node --test tests/*.test.cjs`: **45 tests passed**, including existing audio tests, all profiles/quotas, randomized assignment, actual spawning, 221 actual-engine destruction-order runs (13 waves × 17 orders), inherited fragment behavior and speed ranges, safe spawns, swept bullets, ship collisions, bonus rewards, final warning/sound and pause/resume, campaign completion, versioned records, and unchanged Classic/Impossible parameters through wave 100. Full scripted engine clears produce 680 destructions and 52,360 points. These controlled clears verify the completion path, not a human playthrough.

Chromium and WebKit additionally passed full engine campaign integration, legacy and Hard record preservation, new record persistence, and collision checks. Existing browser regression suites passed custom keybindings, simultaneous keyboard/pointer input, analog joystick and diagonal thrust/fire, independent releases, orientation reset, glow persistence, native Chromium fullscreen, WebKit immersive fallback, current instructions, direct file startup and blocked storage. The bundled game client completed a normal thrust/rotate/fire run. Screenshots and state were inspected; no page errors occurred in these suites.

Run `node tests/challenge-pressure.cjs` for JSON metrics. It executes the actual 120Hz engine at 900×620 with seeds 1–12, for 30 seconds per trial, excluding the first 3 seconds. Large, medium and small stage snapshots are formed through actual splitting. The same stationary, straight-thrust and turning-thrust policies run with no firing/dodging and an infinite test shield; contacts are counted with the real collision radius. **These are separate overlap entries during 27 observed seconds, not deaths, win rates, or normal-game encounter counts.**

| Snapshot / fixed movement | Challenge 13 contacts | Impossible 1 contacts |
| --- | ---: | ---: |
| large / stationary | 2.58 | 3.50 |
| large / straight-thrust | 8.58 | 13.17 |
| large / turn-thrust | 10.58 | 13.17 |
| medium / stationary | 7.17 | 8.83 |
| medium / straight-thrust | 25.17 | 27.42 |
| medium / turn-thrust | 22.67 | 28.08 |
| small / stationary | 9.50 | 18.42 |
| small / straight-thrust | 30.33 | 46.58 |
| small / turn-thrust | 32.50 | 44.42 |

All nine matched contact-entry scenarios were lower for revised Challenge. Exposure duration was not uniformly lower: stationary medium-stage overlap time was 10.85% for Challenge versus 10.62% for Impossible. Geometry, timing and clustering still matter. These probes support a lower-pressure design but do not prove subjective difficulty or achieve the conceptual ratings. Further human playtesting, especially on phones and in waves 9–13 after life losses, remains necessary. Campaign attrition and the added Wave on 10 may still need adjustment based on that feedback. Physical-device balance/performance was not certified.

## Records and deployment

New scores/times use `minefield.challenge.balanced-v2`. The Option B `minefield.challenge.hard-v1` record and original `minefield.records.challenge` record stay stored separately and are not treated as comparable. Classic/Impossible records and all preferences are preserved. Updated menu/help text describes the consistent split rule. FINAL MINEFIELD, its warning tone, and the victory screen are retained. Six dependency-free runtime files remain static/file-compatible; the deployment ZIP includes them at its root.
