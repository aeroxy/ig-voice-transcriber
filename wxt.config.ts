import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  srcDir: 'src',
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
    chromiumArgs: ['--hide-crash-restore-bubble'],
  },
  vite: () => ({
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      // Loaded unpacked, never from the Web Store, so bundle size buys nothing
      // — and readable output means the voice-message handling is auditable.
      minify: false,
    },
  }),
  manifest: {
    name: 'IG Voice Transcriber',
    description: 'Transcribe Instagram voice messages in place',
    // `storage` holds the transcript cache, without which scrolling loses every
    // transcript. Nothing else: the audio url is read out of Instagram's own
    // in-page Relay store by a main-world content script, so there is no
    // request watching and no tab inspection.
    //
    // Note what is absent: no account and no API key.
    permissions: ['storage'],
    host_permissions: [
      // The voice clips themselves. Fetching them from the Instagram page is
      // blocked by CORS, so the background worker does it instead.
      '*://*.fbsbx.com/*',
      '*://*.fbcdn.net/*',
      '*://*.cdninstagram.com/*',
      // The transcription endpoint.
      'https://quillbot.com/*',
    ],
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-48.png',
      128: 'assets/icon-128.png',
    },
  },
})
