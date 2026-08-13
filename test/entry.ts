/**
 * Barrel for the test bundle. `node build.mjs --test` bundles this into
 * dist-test/lib.mjs so the tests can import the real modules as ESM without
 * Node needing to understand TypeScript.
 *
 * Only modules that are free of import-time environment access belong here.
 * `plugin/main.ts` and `ui/bootstrap.ts` are the two entry points that touch
 * `figma` / `document` as a side effect of being imported, and they are the two
 * files deliberately absent from this list.
 */

/* ---- shared ---- */
export { hashString, delay, errorText } from '../src/shared/util';
export {
  LANGUAGES,
  langByCode,
  stripLanguageTag,
  localizedName,
  googleCode,
  deeplSource,
  deeplTarget,
} from '../src/shared/languages';
export { formatWarning, NONE } from '../src/shared/warnings';
export {
  DEFAULT_OPTIONS,
  DEFAULT_SETTINGS,
  DEFAULT_SECRETS,
  normalizeOptions,
  normalizeSettings,
  normalizeSecrets,
  normalizeManual,
} from '../src/shared/defaults';
export { parseUiToPlugin, parsePluginToUi } from '../src/shared/messages';
export { Rpc, TimeoutError } from '../src/shared/rpc';
export { CancellationToken } from '../src/shared/cancellation';
export { escapeMarkup } from '../src/shared/html';

/* ---- providers ---- */
export { chunk, withRetry, httpError, redact, HttpError } from '../src/providers/base';
export {
  protectedRanges,
  markProtected,
  unmarkProtected,
  decodeEntities,
  qualityIssues,
} from '../src/providers/protect';
export {
  parseTranslations,
  parseGlossary,
  glossaryFor,
  buildSystemPrompt,
  buildUserPayload,
  buildShortenPrompt,
} from '../src/providers/prompt';
export { TransportError } from '../src/providers/transport';
export { OpenAIProvider, modelRejectsTemperature } from '../src/providers/openai';
export { GeminiProvider } from '../src/providers/gemini';
export { GoogleTranslateProvider } from '../src/providers/google';
export { GoogleFreeProvider } from '../src/providers/google-free';
export { DeepLProvider, isFreeKey } from '../src/providers/deepl';
export { ManualProvider } from '../src/providers/manual';
export {
  PROVIDERS,
  PROVIDER_LIST,
  getProvider,
  allDomains,
  fieldValue,
  missingCredential,
} from '../src/providers/registry';

/* ---- plugin ---- */
export {
  capacityChars,
  autoFit,
  MIN_FONT_SCALE,
  MAX_FONT_SCALE,
} from '../src/plugin/text-engine';
export { scanNodes, selectedContainers, CLONEABLE } from '../src/plugin/selection';
export { unionBounds, firstColumnX, indexExistingByName } from '../src/plugin/layout';
export {
  Storage,
  splitLegacySettings,
  capEntries,
  capManual,
  tmKey,
  SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  SECRETS_KEY,
  TM_PREFIX,
} from '../src/plugin/storage';
export { computeBudgets, localizeFrame, runFitPass } from '../src/plugin/localize';
export { generate } from '../src/plugin/pipeline';
