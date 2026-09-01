import type { Config } from '../config.js';
import type { Provider } from '../types.js';
import { YouTubeProvider } from './youtube.js';
import { YtDlpProvider } from './ytdlp.js';
import { PipedProvider } from './piped.js';
import { MockProvider } from './mock.js';

export function makeProvider(cfg: Config): Provider {
  switch (cfg.provider) {
    case 'ytdlp': return new YtDlpProvider();
    case 'piped': return new PipedProvider(cfg.piped.instance);
    case 'mock': return new MockProvider();
    case 'youtube':
    default: return new YouTubeProvider(cfg.youtube.apiKey, cfg.shorts.verifyShorts);
  }
}

export { YouTubeProvider, YtDlpProvider, PipedProvider, MockProvider };
