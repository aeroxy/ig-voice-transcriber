/**
 * Speech-to-text via QuillBot's own web-app endpoint.
 *
 * No API key, no account, no sign-in, and — unlike every browser-side option —
 * it takes the clip as bytes, so there is no decoding, no `AudioContext`, and no
 * playing audio into a `MediaStreamTrack` to fake a microphone. That is why this
 * runs in the service worker with a plain `fetch` and needs no offscreen
 * document.
 *
 * Only `content-type` is actually required. `origin` and `platform-type` are
 * sent by QuillBot's own frontend and were verified to be unnecessary — the
 * endpoint answers a `chrome-extension://` origin the same way — so no
 * `declarativeNetRequest` header rewriting is involved.
 *
 * Found in this repo's sibling `reap-agent`, which uses the same endpoint
 * server-side (`app/services/stt_correction.py`).
 */

const ENDPOINT = 'https://quillbot.com/api/raven/stt/process-recording'

/** Mirrors reap-agent's fallback when the browser gives something unusable. */
const DEFAULT_LANGUAGE = 'en'
const DEFAULT_DIALECT = 'US'

interface QuillBotResponse {
  success?: boolean
  message?: string
  data?: { raw?: string; timestamps?: unknown[] }
}

/** `en-GB` → `{ language: 'en', dialect: 'GB' }`, falling back to en/US. */
export function splitLocale(locale: string | undefined): { language: string; dialect: string } {
  const [language, region] = (locale ?? '').split('-')
  if (!language || language.length !== 2) {
    return { language: DEFAULT_LANGUAGE, dialect: DEFAULT_DIALECT }
  }
  return {
    language: language.toLowerCase(),
    dialect: region && region.length === 2 ? region.toUpperCase() : DEFAULT_DIALECT,
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * `signal` is the caller's deadline. It belongs to the worker rather than to
 * this function because a transcription is two network steps — downloading the
 * clip from Instagram's CDN and this upload — and one budget spanning both is
 * what the user actually set. See `src/entrypoints/background.ts`.
 */
export async function transcribe(
  audio: ArrayBuffer,
  locale: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const { language, dialect } = splitLocale(locale)

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      audioData: toBase64(new Uint8Array(audio)),
      // Kept at 'timestamp' to match what the endpoint's own callers send; the
      // timestamps themselves are ignored, only `data.raw` is used.
      mode: 'timestamp',
      language,
      dialect,
    }),
  })

  if (!res.ok) {
    throw new Error(`Transcription service returned HTTP ${res.status}.`)
  }

  // Reading the body is inside the deadline too: a response whose body never
  // finishes arriving hangs exactly as thoroughly as one that never starts.
  const body = (await res.json()) as QuillBotResponse
  const raw = body.data?.raw
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      body.success === false && body.message
        ? `Transcription failed: ${body.message}`
        : 'No speech was recognised in this clip.',
    )
  }
  return raw.trim()
}
