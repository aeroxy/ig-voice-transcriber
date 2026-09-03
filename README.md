<p align="center">
  <img src="public/assets/icon-128.png" width="96" height="96" alt="">
</p>

<h1 align="center">IG Voice Transcriber</h1>

<p align="center">
  Transcribes Instagram voice messages in place, because Instagram's own
  transcription is broken server-side and its "try again" cannot succeed.
</p>

<p align="center">
  <em>No account, no API key, nothing to sign into.</em>
</p>

## Why

Instagram's `IGDAudioTranscriptionButtonOffMsysMutation` returns
`xig_media_message_transcription: null` with a CRITICAL `field_exception`,
`is_transient: false`, `allow_user_retry: false`. Its whole input is
`{actor_id, media_id}` — there is no client-side audio path, so re-encoding and
re-uploading the clip cannot repair an existing message. And the audio is fine
anyway: standard MP4/HE-AAC, 44.1 kHz, `probe_score=100`, decodes with zero
ffmpeg errors, carrying Meta's own `Lavf` encoder tag.

So the fix is to transcribe it ourselves.

## How it works

Three constraints shaped this, each found the hard way.

**Finding the audio.** The clip's URL is nowhere in the DOM and nowhere in any
of Instagram's ~30 IndexedDB stores — but it is in the page's Relay store, as an
`XFBSlideAudioAttachment` record with an `attachment_cdn_url`. Instagram stamps
that record's `attachment_fbid` into the bubble's waveform SVG as
`<clipPath id="waveform-clip-path-<fbid>">`, so the bubble names its own audio
exactly. A main-world content script reads the store and answers the isolated
one over a DOM event.

**Fetching the audio.** A page-context fetch of the CDN URL from instagram.com
fails CORS, so the background worker does it under `host_permissions`.

**Keeping the transcript.** Instagram virtualises the thread, so scrolling a
clip out of view destroys the bubble and everything injected into it. Transcripts
are cached in the background against the attachment fbid and restored when the
bubble comes back. A quoted reply to a voice note carries the original's fbid,
so it shows the same transcript without a second upload.

**Transcribing it.** `POST` the bytes to
`https://quillbot.com/api/raven/stt/process-recording` and read `data.raw`. No
key, no account; only `content-type` is a required header, so it works straight
from the service worker with no header rewriting and no offscreen document.

| File | Role |
| --- | --- |
| `src/entrypoints/background.ts` | Fetches the clip, routes to the recognizer, caches |
| `src/entrypoints/instagram.content.ts` | Finds clips, injects the button, renders transcripts |
| `src/entrypoints/instagram-main.content.ts` | Main world: reads the clip url out of Instagram's Relay store |
| `src/lib/quillbot.ts` | Bytes → text |
| `src/lib/relay-store.ts` | fbid → URL, from the Relay store |
| `src/lib/clips.ts` | Voice-clip discovery in Instagram's markup |
| `src/lib/transcript-store.ts` | Caches transcripts so scrolling doesn't lose them |

## Setup

```bash
bun install
bun run build
```

Load `.output/chrome-mv3` unpacked. There is nothing to configure and nothing to
sign into — Transcribe buttons appear under every voice message in
`instagram.com/direct/*`.

For development, `bun run dev` launches a browser with the extension loaded.

## The trade-off

Voice clips are uploaded to QuillBot. They are other people's private messages;
decide whether that's acceptable before using this.

A fully local alternative exists and was deliberately not used: Chrome's own
`SpeechRecognition` can transcribe a file if you play it into a
`MediaStreamTrack`. It needs no third-party host, but it needs an offscreen
document, an `AudioContext`, careful playback timing, and it returns unpunctuated
text. See AGENTS.md if you want it back.

## Limits

- Language follows the browser's locale (`en-GB` → language `en`, dialect `GB`),
  falling back to `en`/`US`. A clip in another language will transcribe poorly.
- No known size limit for the endpoint. Long voice notes are untested.
- The audio lookup depends on two Instagram internals: the page's
  `PolarisRelayEnvironment` module and the `XFBSlideAudioAttachment` record's
  field names. If either changes, the extension says it cannot find the audio
  rather than guessing.
