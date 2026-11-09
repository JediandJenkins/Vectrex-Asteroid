# Minefield — Vector Arcade

An original vector arcade game inspired by the early 1980s. No copied artwork, libraries, network requests, build step, or server required.

Open `index.html` in a modern browser to play. For Cloudflare Pages, upload `index.html`, `style.css`, `controls.js`, and `game.js` using a Direct Upload project, or upload the included `minefield-cloudflare.zip`. For Git integration, choose no framework, leave the build command empty, and use `.` as the output directory.

## Controls

- Left arrow / A: rotate left
- Right arrow / D: rotate right
- Up arrow / W: thrust
- Space / J: fire (hold for repeat fire)
- P / Escape: pause / resume
- Enter: start / resume / play again
- M: mute, F: fullscreen where supported (available when not assigned to a gameplay action)

Open **Settings → Keyboard Controls** to change either binding for any action. Select a binding, then press its replacement key; Escape cancels capture. Duplicate assignments are rejected without changing your existing controls. Restore Default Keybinds restores all ten slots. Bindings use physical key positions, support simultaneous keys, and save locally. Browser/system modifier shortcuts are left available outside binding capture.

The mobile joystick rotates proportionally to horizontal travel. Push upward to thrust; diagonals rotate and thrust together. Releasing it stops those inputs while preserving the ship's momentum. Hold the circular Fire button for continuous shooting while steering with another finger. Portrait controls sit below the field; landscape controls sit beside it. A portrait hint recommends rotation without blocking play. No device permissions are requested.

Settings also includes sound and **Mobile Control Visibility: Auto / Show / Hide**. Auto uses touch capability, including touch-enabled laptops. Show enables the controller even with a mouse; Hide provides a larger field for keyboard play. Settings changes save automatically. Opening settings pauses the game; close settings and resume when ready. Pausing, backgrounding, game over, resizing, and orientation changes reset held inputs so they cannot stick. After resizing, lift and press the controls again.

## Game modes

Select a mode on the main menu, then Start Game. Restart and Play Again repeat the selected mode. Results and the pause screen include Return to Main Menu. On very small screens, the mode menu scrolls; gameplay stays fixed in place.

- **Classic:** endless waves, three starting ships, two fragments per split, steady difficulty progression. Earn a ship after every four completed waves. Records: highest score and highest wave reached.
- **Challenge:** a 13-wave campaign, three starting ships, and a bonus ship after waves 4, 8, and 12. Curved-course mines appear from wave 4; surging mines appear from wave 8. Clear wave 13 for the animated MINEFIELD CLEARED screen with final score, remaining ships, and completion time. Records: highest score, campaign completion, fastest clear time.
- **Impossible:** one ship, no bonuses, ten fast mines in the opening wave, three fragments per split, and smooth weaving/surging trajectories. Speed and steering difficulty keep increasing with each wave; the enemy-count budget does not impose a difficulty ceiling. Records: highest score, highest wave fully cleared, and longest survival.

All modes preserve the ship's acceleration, momentum, maximum speed, firing cadence and scoring: large / medium / small mines award 20 / 50 / 100 points. Destroy every mine to advance. A three-second spawn shield has a visible countdown; new waves also provide brief protection and keep new enemies away from the ship. Timers measure active game time, excluding pauses, settings, and result screens.

Each mode has independent local records. Existing `minefield.best` scores migrate to Classic without deleting keyboard or sound preferences. Storage is optional: play and settings remain usable if it is blocked. Sound starts after interaction.

## Vector glow

**Settings → VECTOR GLOW → ON / OFF** applies immediately and saves locally; it defaults to ON. ON combines broad saturated royal-blue phosphor bloom, luminous cyan rims, and sharp white vector cores. Nearby emitters add light, so shots and explosions flare together like the supplied CRT reference. OFF renders crisp white lines and removes interface text glow. Changing glow pauses through the existing settings flow and never restarts the run or changes collisions.

## Implementation

Canvas uses device pixel ratio scaling (capped at 2 on touch/small or low-core layouts and 3 otherwise for performance). Physics runs at 120 fixed steps per second, with requestAnimationFrame rendering. The small `controls.js` module combines keyboard and pointer sources into one shared state; gameplay reads no device-specific events. Collision checks use toroidal distances and swept projectile segments. Resize and orientation changes preserve object positions relative to the field.

Difficulty lives in the `MODES` configuration at the top of `game.js`; one shared engine handles all modes. At most 72 mines and 300 particles (180 on mobile/low-power layouts) are active. Fragment production respects this budget. Glow batches cached vector geometry into four `Path2D` opacity groups, avoiding per-object shadow passes and full-screen blur filters. A cached radial light sprite and additive blue/cyan halo strokes are composited in a quarter-CSS-resolution light buffer beneath sharp cores on both desktop and mobile. Only emitted light is softened; the game itself is never blurred. Broad particle light spill is sampled above 40 particles while every particle retains its vector and line halo, keeping dense scenes bounded. Victory animation respects reduced-motion preferences.

For verification, `window.render_game_to_text()` exposes current state and `window.advanceTime(ms)` advances the simulation. These require no dependency and do not modify normal play.
