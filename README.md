# DEEP DIVE

Instant-win casino game: a diver goes down through eight depth zones. Each zone has three
caves, and a shark hides in one of them. Every safe cave takes the diver 25 m deeper and up the
multiplier ladder. Surface (cash out) after any zone; the oxygen lasts eight zones, and clearing
all of them reaches the treasure at the abyss for the max win.

```sh
npm install
npm run dev      # http://localhost:5182  (add ?demo to play offline)
npm run build
```

## Graphics

The ocean is a Three.js scene (`src/scene/`) that fills the whole screen behind the HUD: a sunlit canyon the
camera follows down. The camera keeps the play column centred in the space the HUD panels leave free (the
`.stage` element), using an off-centre view, so the scene runs on under the glass panels to every edge.

- Each zone is one of six rock-ledge paintings (`public/ledges/`, two per depth band) on a lit plane spanning
  the canyon, with rippling caustic light near the surface and the deep anemones glowing.
- The canyon walls (`rock.ts`) are procedural: displaced cliff geometry, and a boulder texture generated at
  start-up and projected along the world axes. Their tone follows the ledge art (warm sandstone, blue-grey,
  dark slate). Above the waterline they are dry cliffs in evening light.
- Life on the walls (`flora.ts`), by depth: kelp and coral in the light, sea fans and purple tube sponges
  mid-water, glowing anemones and specks in the deep. Schools of fish and a manta ray swim the canyon
  (`fauna.ts`).
- The diver (`diver.ts`) is jointed: flutter kicks with knee bend and flexing fins, a hover pose, breathing
  with bubbles on each out-breath, and a torch arm that aims at the cave under the pointer.
- The shark, clams, chest, boat, jellies and anglerfish are 3D models (`models.ts`).
- Light from the caves, the torch, the shark's red flash and the open chest is a cheap glow term in the rock,
  ledge and sand shaders, not real lights (every real light costs every lit pixel on screen).
- Fog, light and water colour follow the depth. Bloom picks out pearls, eyes, torch and glow. Bloom ignores
  NaN or Inf pixels, so one bad pixel can't blank the frame.
- Rendering steps down if frames run slow: 4× multisampling first gives way to FXAA, then the resolution
  drops. Integrated GPUs start on FXAA. A step that proved too slow isn't retried until the window size
  changes.
- Multipliers and cave numbers are HTML labels pinned to the 3D positions, so they stay crisp.
- The scene loads on demand. Without WebGL2, or if it fails to start, the game uses the 2D SVG ocean
  (`src/components/Ocean.tsx`) in a frame instead. Add `?svg` to force it.

### Ledge art

The ledges come from six 1440 × 720 images on a white background. `npm run assets:ledges` cuts them out (white
and haze become transparent), finds the three cave mouths in each, and writes `public/ledges/*.webp` plus
`src/scene/ledges.ts` (the cave positions the scene uses for glow, tap targets and pearls):

```sh
npm run assets:ledges -- shallow-a=<img> shallow-b=<img> mid-a=<img> mid-b=<img> deep-a=<img> deep-b=<img> [debug=<dir>]
```

The caves must sit near 20%, 50% and 80% across, as in the current art. `debug=<dir>` writes previews with the
detected caves outlined.

## Math (RTP 97%)

| Depth          | Survive | Pays   |
|---------------:|--------:|-------:|
| 25 m           | 66.67%  | ×1.45  |
| 50 m           | 44.44%  | ×2.18  |
| 75 m           | 29.63%  | ×3.27  |
| 100 m          | 19.75%  | ×4.91  |
| 125 m          | 13.17%  | ×7.36  |
| 150 m          | 8.78%   | ×11.04 |
| 175 m          | 5.85%   | ×16.57 |
| 200 m (abyss)  | 3.90%   | ×24.86 |

Multiplier = floor(0.97 × (3/2)^k, 2 dp). Every zone is a fresh 1-in-3 risk. See `src/game/math.ts`.
Max bet is R200 so a full dive (×24.86) stays inside the R5,000 max win.

## Provably fair

See `src/game/fair.ts`. The shark's cave in zone k (0-7) is
`(first 52 bits of HMAC_SHA256(serverSeed, "clientSeed:nonce:k") × 3) >> 52`.
A fresh server seed is used for each dive, its SHA-256 hash is shown before the bet, and the
seed is revealed after the dive.

## Backend

Plays against FeedingFranzeeAPI's `api/dive` (Engine `Dive`, GameId `deep-dive`), see
`src/game/httpEngine.ts`. In dev, `/api` is proxied to <http://localhost:5003> and a player
token comes from `/api/dev-token`. In production the lobby launches the game with `?token=<jwt>`
and the API base comes from `VITE_API_BASE` (`.env.production`).

Add `?demo` to the URL (or set `VITE_DEMO=1`) to play offline against the in-browser engine
(`createLocalEngine()` in `src/game/engine.ts`) with a demo wallet.

Note: `crypto.subtle` (used by the Verify button) requires a secure context (localhost or https).
