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

**Finding the audio.** The clip's URL is nowhere in the DOM, and nowhere in any
of Instagram's ~30 IndexedDB stores. It exists only as a network request — but
Instagram *prefetches* every clip when it renders a thread, so the background
worker observes it with `webRequest` and never needs to trigger playback. The
join key is duration: the CDN filename is
`audioclip-<sentAtMs>-<durationMs>.mp4`, and the DOM exposes the same number on
the progress bar's `aria-valuemax`.

**Fetching the audio.** A page-context fetch of the CDN URL from instagram.com
fails CORS, so the background worker does it under `host_permissions`.

**Keeping the transcript.** Instagram virtualises the thread, so scrolling a
clip out of view destroys the bubble and everything injected into it. Transcripts
are cached in the background against the clip's `sentAtMs` — the only stable
identity Instagram exposes, since its markup has no message id or data
attributes — and restored when the bubble comes back.

**Transcribing it.** `POST` the bytes to
`https://quillbot.com/api/raven/stt/process-recording` and read `data.raw`. No
key, no account; only `content-type` is a required header, so it works straight
from the service worker with no header rewriting and no offscreen document.

| File | Role |
| --- | --- |
| `src/entrypoints/background.ts` | Observes clip URLs, routes to the recognizer |
| `src/entrypoints/instagram.content.ts` | Finds clips, injects the button, renders transcripts |
| `src/lib/quillbot.ts` | Bytes → text |
| `src/lib/audio-registry.ts` | Duration → URL join |
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
- Two clips of identical millisecond duration in one thread are disambiguated by
  chronological order, which assumes Instagram appends messages in time order.
  Because the ranking is over the clips currently rendered, a thread holding two
  clips of exactly equal length could in principle mismatch them.
