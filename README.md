# Shajara

The ‘ala bab allah music tree: a phone app for passing musical ideas around a track, layer by layer.

- **Flowers & Leaves** — melody & ornaments
- **Tree Bark** — harmony
- **Ground** — bass & low line
- **Substrate** — pulse & rhythm

Anyone can hold any layer, on any instrument.

App: `index.html` (GitHub Pages). API: `worker/` (Cloudflare Worker `shajara-api`, D1 `shajara`, KV `AUDIO`).
Deploy the API with `cd worker && npx wrangler deploy`. The band passcode is the `BAND_KEY` Worker secret.
