# Design Preview

Design Preview makes Paper and MagicPath output readable inside bb on desktop
and mobile. It stores a raster preview with the bb server and renders it inline
in the agent message; the provider URL remains a secondary editing link.

This deliberately does not embed Paper or MagicPath. Paper's editor is a
desktop application, and provider pages may reject iframes or mobile browsers.
The saved preview therefore remains viewable even when the original provider
page cannot open on the current device.

## Agent workflow

The plugin registers `design_canvas_publish_preview` and selects it for agent
sessions. After creating or editing a design, agents:

1. Export a Paper artboard as PNG/JPEG/WebP, or download MagicPath's
   `previewImageUrl`.
2. Keep the image in the current bb workspace. Paper exports may remain as a
   direct file in the host's `Downloads` folder.
3. Call `design_canvas_publish_preview` with the provider, title, original URL,
   and absolute workspace path.
4. Include the returned `::design-preview{id="…"}` directive in the final
   response.

The directive becomes a native bb card with a full-width image and touch-sized
Download and Original actions. Opening the image shows the saved preview at
full size in a return-aware viewer with a persistent **Return to conversation**
control; Original may still require a desktop-capable provider client.

## Privacy and storage

- Preview bytes live in the plugin's private SQLite database under bb's data
  directory.
- The image route uses bb's local app-origin authentication and is not public.
- The plugin reads only a supplied image beneath the invoking thread's current
  workspace root, plus direct `Downloads` files for Paper exports.
- Provider credentials, browser cookies, and OAuth tokens are never read or
  stored.
- Accepted preview formats are PNG, JPEG, WebP, AVIF, and GIF, capped at 10 MB.

## Development

```sh
npm install
npm run typecheck
npm run build
bb plugin install . --yes
```

After editing an installed path source:

```sh
bb plugin reload design-canvas
```
