# ai-browser

Blank browsing computer. The workspace opens the user's local Chrome or Edge as the engine, with an independent profile, and listens to in-frame actions through CDP.

The right-side hanger stays silent and sits beside the engine. It does not cover the page, steal focus, auto-navigate, or auto-submit. Same-site membership pages (for example `vip.iqiyi.com` and `www.iqiyi.com/vip/`) are one site. If the engine disconnects, status becomes not-open. Chrome cache and font cache live on disk under `~/.ai-browser/cache`, not `/dev/shm`.

## First slice

This slice implements one path:

1. The workspace can open 爱奇艺 (or another membership URL) in the engine window.
2. The user can confirm saving identity and expiry for that site. Fields are phone, username, and login method. Password is optional and never shown in the rail.
3. When a saved membership is near expiry, the rail mentions it once.
4. Clicking that mention opens the cancel page. Nothing else navigates there.

Write and autofill both wait for confirm. The engine never submits a form on its own.

```bash
npm start
```

Local data lives in `~/.ai-browser/` (override with `AI_BROWSER_HOME`). The engine profile is separate from the browser's default profile.

## Out of scope for this slice

- Chat homepage, todos, curiosity daily, engine-switch or shortcut-login homepage
- Packaging, installer, and UI polish
- Page overlays, automatic navigation, automatic submit
- Advertising a shared everyday Chrome profile
