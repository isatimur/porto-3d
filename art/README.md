# Porto 3D art pack

AI-generated illustrations and textures (Higgsfield, 2026-10-09/10). Every file is flagged `ai_generated: true` in `manifest.json`. Show the label «Иллюстрация, создана ИИ» wherever an illustration appears. None of it is a photo of a real place. Licence status: unverified (see PROVENANCE.md).

Spend: 117.5 of 220 Higgsfield credits. 0 of 15 OpenArt credits. Balance 1037. See LEDGER.md.

## Contents and integration

| folder / file | size | purpose | plug in at |
|---|---|---|---|
| textures/calcada_wave_{1024,512,256}.webp, _normal_512, _roughness_512 | 1024 about 300 KB | black and white wave calcada | src/calcada.js (replace procedural canvas) |
| textures/calcada_grey_* | same | grey granite sett | src/calcada.js, plain streets |
| textures/rock_granite_*, ground_schist_* | same | Douro cliff, heath slope | src/scene.js terrain (slopes were flat grey) |
| textures/roof_canudo_* | same | terracotta roof tile | building roofs |
| textures/plaster_{ochre,cream,pink,blue}_* | same | weathered wall plaster | building walls (tint by hue) |
| textures/azulejo_{geo,floral,plain}_* | same | blue and white tile repeats (2x2 tiles per image) | facade accents |
| textures/sand_* | same | beach sand | beaches at Foz and Matosinhos (missing today) |
| textures/sea_foam_mask_*, sea_waves_height_*, sea_waves_normal_512 | gray masks | foam alpha (use as alpha or multiply), wave height and normal | src/water.js (replaces noisy foam and corrugated tile) |
| sky/sky_{golden,day,overcast,dusk}_2048.webp | 100-320 KB | 2:1 panoramas, wrap seamless, horizon near 0.5 (golden 0.58) | src/scene.js sky or PMREM environment |
| sky/cloud_sprites_{a,b}_2048.webp | 300 KB | RGBA 3x2 cloud sheets | sky cloud billboards |
| illustrations/story_<chapter-id>.webp (18) | 110-150 KB, 1280x720 | one per chapter in data/story.json (id matches) | src/story.js chapter panel |
| illustrations/ui_discover.webp, ui_loading.webp, ui_empty.webp, social_hero_1200x630.webp | 85-140 KB | Discover banner, loader, "no saved places", og:image | Discover tab, index.html loader, empty state, og:image meta |
| audio/amb_{surf,ribeira,tram,bells,night,rain}.ogg | about 93 KB, 23 s | seamless ambient loops (Opus mono) | audio layer, per-area or per-chapter |

Full per-file table with prompts: manifest.json and PROVENANCE.md.

## Notes for the integrator

- Texture sizes: use _1024 on desktop, _512 on mid mobile, _256 on low class. Total textures folder is 5.2 MB (cap 6 MB).
- Tiling: patterns carry visible repetition at large scale (rock, schist, plaster). Break it with a low-frequency noise tint or a second UV scale. Patterned textures (calcada, roof, grey sett) have faint seam fixes; the half-offset check is in contact_textures.jpg and contact_sky_seamcheck.jpg.
- Normal maps and roughness maps are derived from luminance by script. They are approximate. Normal maps use the OpenGL (+Y up) convention. Flip green for DirectX.
- Skies are cropped and blended panoramas of the horizon band, not true spherical captures. The zenith is not pinched. Fine for a skybox or backdrop. The golden sky mirrors its glow on the far side.
- Cloud sprites keep a faint dark halo at the edges. Shrink alpha slightly or use premultiplied blending.
- Audio: loops have a 2 s equal-power crossfade at the wrap and a numerically small seam. I did not listen to them. Audition before shipping. The tram and bells prompts may not give clear events.
- Story pictures: generic scenes. Do not caption them as documents. The 1891 and republic pictures use plain blue and green-red flags with no emblem.

## What I rejected and why

- rejected/ui_loading_v1.png: huge flat blue mass, bridge too small, unusable as loader.
- rejected/ui_social_v1_orderofchrist_cross_on_sails.png: the model put red crosses on the barge sails. That is a historic heraldic emblem and a risk of implying documentation. Regenerated with plain sails.
- Unused second candidates (calcada_wave_a/b, grey_a, granite_a, and so on) stay in /tmp/art/raw only. They are listed in LEDGER.md.
- Plain azulejo generations 1 and 2 (cloudy marble look, single tile with a rim) and the 3x3 grid: replaced by a fresh "plain" run (az_plain_r0), cropped and blended.
- calcada_wave via half-offset cross-fade: ghost double waves. Replaced by a min-cut seam blend.
- First sky seam attempt (min-cut): hard tonal step on the golden, overcast and dusk skies. Replaced by cross-fade. The day sky keeps the min-cut.

## Contact sheets

contact_textures.jpg (2x2 tiled preview of every texture), contact_illustrations.jpg (18 chapters), contact_sky_seamcheck.jpg (skies shifted by half a turn so the wrap seam sits in the middle).

The rejected/ folder is 15 MB of PNG. Delete it before committing.
