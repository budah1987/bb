# BB Attention

Desktop and mobile notifications for BB agents that have completed, failed,
or are waiting for input. The plugin keeps a durable attention queue aligned
with BB's native read state and opens the oldest item with <kbd>⌥L</kbd>.

## What it adds

- System notifications in the BB desktop app and supported browsers.
- Background Web Push for mobile and desktop browsers, with VAPID keys generated
  and stored locally by the plugin.
- An **Attention** sidebar page that lists unread agents oldest-first.
- <kbd>Option</kbd>+<kbd>L</kbd> / <kbd>Alt</kbd>+<kbd>L</kbd> to open and mark
  the next agent read.
- Per-device enable, test, and disconnect controls under the plugin's settings.

Notification delivery can be disabled globally, made silent, allowed while BB
is focused, or configured to include the last assistant text. Assistant text is
hidden by default so lock-screen notifications do not expose message content.

## Install

```sh
npm install
npm run check
bb plugin install .
```

Open **Settings → Plugins → BB Attention → Notification delivery** and choose
**Enable and test** on each device.

On iPhone or iPad, open the remote BB URL in Safari, use **Share → Add to Home
Screen**, launch BB from that icon, then enable notifications. Apple only
allows standards-based Web Push for home-screen web apps. Android and desktop
browsers can enable Web Push directly when their browser supports it.

## Development

```sh
npm run typecheck
bb plugin build
bb plugin dev
```

The backend listens to BB thread lifecycle events, reconciles against BB's
`latestAttentionAt` / `lastReadAt` state, and sends encrypted Web Push directly
through each browser vendor's push endpoint. No notification SaaS account or
shared application key is required.
