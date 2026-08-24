use bun for package management

use bun typecheck

be concise

### Threat model

This is a **personal tool**. It runs in the user's browser, with the user's own
cookies, against hosts the user can already reach. There is no untrusted-model
boundary and no multi-tenant server.

Do not flag as security issues: broad host permissions, `webRequest`
observation of the user's own tabs, or fetching CDN media with the user's
session. Those are the mechanism, not a lapse.

### Speech-to-text

`https://quillbot.com/api/raven/stt/process-recording`, posted from the service
worker. No API key, no account, no sign-in. It takes the clip as base64 bytes
and returns `data.raw`.

Found via the sibling `reap-agent`, which uses the same endpoint server-side
(`app/services/stt_correction.py`).

Only `content-type: application/json` is required. QuillBot's own frontend also
sends `origin` and `platform-type`, but both were verified unnecessary — the
endpoint answers a `chrome-extension://` origin identically — so there is no
`declarativeNetRequest` header rewriting here. Don't add any back without
evidence it is needed.

Do flag the one real trade-off: voice clips leave the machine. They go to
QuillBot. That is other people's private messages, and it should stay stated in
the README.

Three earlier backends were tried and rejected, so don't re-propose them:

- **Puter** (`puter.ai.speech2txt`) — every auth path, temp accounts included,
  goes through `${defaultGUIOrigin}/action/sign-in` in a **popup**, which does
  not complete when opened from a `chrome-extension://` page. There is no
  headless temp-user endpoint in the SDK.
- **Driving the Gemini web app** — works (attach a `File` via a
  `ClipboardEvent`; drag-and-drop is ignored), but needs an open tab and breaks
  on any UI change. The direct RPC alternative cannot be captured: Gemini runs
  its upload and `StreamGenerate` in a Web Worker, out of reach of page-level
  hooks.
- **The browser's `SpeechRecognition`** — genuinely works on a file, because
  Chrome's `start()` accepts a `MediaStreamTrack`, so a decoded clip can be
  played into a `MediaStreamAudioDestinationNode` and passed off as a
  microphone. Rejected only because QuillBot is simpler (no offscreen document,
  no AudioContext, no playback timing to get right) and punctuates its output.
  Worth remembering if a fully local option is ever wanted: it needs no
  third-party host at all, and `processLocally` reports `downloadable`.
