# Dampen — Architecture

> A Spotify player that muffles your music so it sits *behind* your attention
> instead of competing with it.

## The core problem

Spotify's Web Playback SDK plays audio through an EME/Widevine-protected media
element. A `MediaElementAudioSourceNode` attached to a DRM-protected element
yields **silence** (zeroed samples) — by design. So you cannot low-pass
Spotify's own in-browser stream.

Dampen solves this by having **three input paths** that all feed the *same*
DSP engine and the *same* UI. Spotify metadata (playlists, recents, top
tracks, now-playing, artwork) is always live regardless of path.

| Path | Source | DSP | Needs |
|---|---|---|---|
| **A — Spotify Web Playback** | Web Playback SDK in-browser | Volume contour + masking ambience bed only (stream is DRM) | Spotify Premium |
| **B — System Capture** ★ | Virtual audio device (BlackHole / VB-Cable / Loopback) carrying the Spotify desktop app's output | **Full chain, on real Spotify audio** | Virtual device installed |
| **C — Local audio** | File / drag-drop / demo track | **Full chain** | nothing |

Path B is the headline: Spotify desktop → BlackHole → Dampen captures via
`getUserMedia({audio:{deviceId}})` → full DSP → speakers. Genuinely muffled
Spotify, no DRM involved, no stream ever leaves the machine or is recorded.

## Signal chain (the Dampen Engine)

```
source ──▶ inputGain ──▶ [analyser:in]
                            │
                            ▼
                     highpass (wall/structure)
                            │
                     lowShelf  (structural bass lift)
                            │
                  lowpass × N stages (the "wall")
                            │
                     presenceDip  (kill 1–5k attention band)
                            │
                        tilt shelf
                            │
                      saturation (WaveShaper)
                            │
                   wow/flutter (AudioWorklet delay mod)
                            │
                      bitcrush (AudioWorklet)
                            │
              ┌─────────────┴─────────────┐
              │                           │
           dry gain                  convolver (synth IR)
              │                           │
              └─────────────┬─────────────┘
                            │
                  M/S width control
                            │
                      compressor
                            │
                    drift LFO (slow gain breathe)
                            │
            ┌───────────────┴───── ambience bed (noise/rain/vinyl) ──┐
            │                                                        │
            └──────────────▶ outputGain ──▶ [analyser:out] ──▶ dest ─┘
```

Every parameter is ramped (`setTargetAtTime` / `linearRampToValueAtTime`) —
never assigned — so there is no zipper noise when dragging a slider.

## Module ownership

```
lib/types.ts            shared contract — DampenParams, Preset, DampenSource
lib/audio/              the engine. engine.ts, presets.ts, ir.ts, ambience.ts
public/worklets/        AudioWorklet processors (bitcrush, wowflutter, noise)
lib/spotify/            OAuth PKCE, typed Web API client, React hooks, SDK wrapper
app/api/spotify/        server-side token exchange + refresh (secret stays server-side)
components/player/      transport, now-playing, device picker, source switcher
components/library/     playlists, saved tracks, recently played, top, search
components/dampen/      the dampen console — macro dial, preset rack, param sliders
components/viz/         spectrum analyser + live filter-response curve overlay
```

## Rules every module follows

1. **No `any`.** Strict TypeScript. `npm run typecheck` must pass clean.
2. **No secrets in the client.** `SPOTIFY_CLIENT_SECRET` is referenced only in
   `app/api/spotify/**`. The browser uses PKCE and talks to our route handlers.
3. **The engine never touches React.** `lib/audio/engine.ts` is a plain class.
   React talks to it through one hook.
4. **No audio is ever recorded, uploaded, or persisted.** Capture is realtime,
   in-memory, local-only. This is a hard product constraint, not a preference.
5. **Graceful degradation.** Not signed in → the app still works on Path C with
   demo audio. No Premium → Path A hides itself, B and C still work.
