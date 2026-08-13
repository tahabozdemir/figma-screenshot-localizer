/**
 * The provider registry — the single source of truth about what a provider is.
 *
 * Adding a provider used to mean editing eight places: the mode union, three
 * lookup tables in the UI, a factory switch, a block of hand-written panel
 * markup in ui.html, plus two `if (mode === …)` tests in the sandbox that had
 * no business knowing provider names at all.
 *
 * Now it means: write `providers/<name>.ts`, add one descriptor below, add the
 * id to `TranslationMode`, and allow-list the domain in manifest.json. The
 * panel builds its own controls from `fields`, validation reads `credential`,
 * the sandbox is told `capabilities` and `cacheKey` instead of deducing them,
 * and `PROVIDERS` is typed `Record<TranslationMode, …>` so a missing descriptor
 * is a compile error rather than a runtime `undefined`.
 */

import type {
  ManualTable,
  PersistedSettings,
  ProviderCapabilities,
  Secrets,
  SecretKey,
  TranslationMode,
} from '../shared/types';
import { DeepLProvider } from './deepl';
import { GeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini';
import { GoogleFreeProvider } from './google-free';
import { GoogleTranslateProvider } from './google';
import { ManualProvider } from './manual';
import { OpenAIProvider, DEFAULT_OPENAI_MODEL } from './openai';
import type { Transport } from './transport';
import type { TranslationProvider } from './types';

/** Settings fields a provider may expose (models — never secrets). */
export type ModelKey = 'openaiModel' | 'geminiModel';

export type FieldTarget =
  | { scope: 'secret'; key: SecretKey }
  | { scope: 'setting'; key: ModelKey };

export interface ProviderField {
  /** Unique within the provider; the DOM id becomes `field-<provider>-<id>`. */
  id: string;
  label: string;
  type: 'password' | 'text';
  placeholder?: string;
  /** Must be non-empty before a run may start. */
  credential?: boolean;
  target: FieldTarget;
}

/** Stored configuration a descriptor can describe itself from. */
export interface ProviderConfigState {
  settings: PersistedSettings;
  secrets: Secrets;
  manual: ManualTable;
}

/** Everything a descriptor needs to actually build its provider. */
export interface ProviderState extends ProviderConfigState {
  transport: Transport;
}

/** What a provider needs to judge whether the panel is ready to run. */
export interface ValidationContext {
  /** Target languages, minus the source language. */
  targets: string[];
  /** How many strings have a value for this language. */
  filled: (languageCode: string) => number;
}

export type ProviderGroup = 'manual' | 'ai' | 'mt';

export const GROUP_LABEL: Record<ProviderGroup, string> = {
  manual: '',
  ai: 'AI',
  mt: 'Machine translation',
};

export interface ProviderDescriptor {
  id: TranslationMode;
  /** Short name, used in validation messages. */
  label: string;
  /** Text shown in the mode picker. */
  optionLabel: string;
  group: ProviderGroup;
  /** Explanatory paragraph rendered under the fields. */
  note?: string;
  fields: ProviderField[];
  capabilities: ProviderCapabilities;
  /**
   * Hosts this provider contacts. Declared here so the manifest allow-list can
   * be checked against the code rather than trusted (see the registry test).
   */
  domains: string[];
  /**
   * Translation-memory bucket, or null to never cache.
   *
   * The bucket must name everything that changes the output. Engine alone was
   * not enough: switching gpt-4o-mini to a newer model replayed the old cached
   * answer, because a cache hit meant the new model was never asked — the same
   * bug that made the engine part of the key in the first place.
   */
  cacheKey(state: ProviderConfigState): string | null;
  create(state: ProviderState): TranslationProvider;
  /**
   * Extra precondition beyond a missing credential. Returns the message to
   * show, or null when the provider is ready.
   */
  validate?(ctx: ValidationContext): string | null;
}

const NO_CAPABILITIES: ProviderCapabilities = { shorten: false, budgets: false };
/** Only the instruction-following models can honour a budget or rewrite text. */
const LLM_CAPABILITIES: ProviderCapabilities = { shorten: true, budgets: true };

function trimmed(value: string | undefined, fallback = ''): string {
  const out = (value || '').trim();
  return out || fallback;
}

export const PROVIDERS: Record<TranslationMode, ProviderDescriptor> = {
  manual: {
    id: 'manual',
    label: 'Manual',
    optionLabel: 'Manual — type the translations yourself',
    group: 'manual',
    fields: [],
    capabilities: NO_CAPABILITIES,
    domains: [],
    // The manual table is the only source of truth, so an edited string always
    // wins; a cache would just replay what the designer already replaced.
    cacheKey: () => null,
    create: (state) => new ManualProvider(state.manual),
    validate: (ctx) => {
      for (const code of ctx.targets) {
        if (ctx.filled(code) > 0) return null;
      }
      return 'No manual translations entered yet. Open a language below and fill in the strings.';
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    optionLabel: 'OpenAI',
    group: 'ai',
    fields: [
      {
        id: 'key',
        label: 'OpenAI API key',
        type: 'password',
        placeholder: 'sk-…',
        credential: true,
        target: { scope: 'secret', key: 'openaiKey' },
      },
      {
        id: 'model',
        label: 'Model',
        type: 'text',
        placeholder: DEFAULT_OPENAI_MODEL,
        target: { scope: 'setting', key: 'openaiModel' },
      },
    ],
    capabilities: LLM_CAPABILITIES,
    domains: ['https://api.openai.com'],
    cacheKey: (s) => 'openai/' + trimmed(s.settings.openaiModel, DEFAULT_OPENAI_MODEL),
    create: (s) =>
      new OpenAIProvider({
        transport: s.transport,
        apiKey: trimmed(s.secrets.openaiKey),
        model: trimmed(s.settings.openaiModel, DEFAULT_OPENAI_MODEL),
      }),
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini',
    optionLabel: 'Gemini',
    group: 'ai',
    fields: [
      {
        id: 'key',
        label: 'Gemini API key',
        type: 'password',
        placeholder: 'AIza…',
        credential: true,
        target: { scope: 'secret', key: 'geminiKey' },
      },
      {
        id: 'model',
        label: 'Model',
        type: 'text',
        placeholder: DEFAULT_GEMINI_MODEL,
        target: { scope: 'setting', key: 'geminiModel' },
      },
    ],
    capabilities: LLM_CAPABILITIES,
    domains: ['https://generativelanguage.googleapis.com'],
    cacheKey: (s) => 'gemini/' + trimmed(s.settings.geminiModel, DEFAULT_GEMINI_MODEL),
    create: (s) =>
      new GeminiProvider({
        transport: s.transport,
        apiKey: trimmed(s.secrets.geminiKey),
        model: trimmed(s.settings.geminiModel, DEFAULT_GEMINI_MODEL),
      }),
  },

  google: {
    id: 'google',
    label: 'Google Cloud Translation',
    optionLabel: 'Google Translate (Cloud API key)',
    group: 'mt',
    note:
      'Needs an API key whose project has the Cloud Translation API enabled. Placeholders and your ' +
      '“never translate” terms are marked untranslatable before sending.',
    fields: [
      {
        id: 'key',
        label: 'Google Cloud Translation API key',
        type: 'password',
        placeholder: 'AIza…',
        credential: true,
        target: { scope: 'secret', key: 'googleKey' },
      },
    ],
    capabilities: NO_CAPABILITIES,
    domains: ['https://translation.googleapis.com'],
    cacheKey: () => 'google',
    create: (s) =>
      new GoogleTranslateProvider({ transport: s.transport, apiKey: trimmed(s.secrets.googleKey) }),
  },

  'google-free': {
    id: 'google-free',
    label: 'Google Translate (free)',
    optionLabel: 'Google Translate (free, no key)',
    group: 'mt',
    note:
      'No key required. This uses the undocumented endpoint behind the Google Translate web widget: ' +
      'it is rate limited per machine, sends one request per string, cannot protect placeholders, ' +
      'and Google may change or block it at any time. Fine for drafts — use the Cloud API or DeepL ' +
      'for anything you ship.',
    fields: [],
    capabilities: NO_CAPABILITIES,
    domains: ['https://translate.googleapis.com'],
    cacheKey: () => 'google-free',
    create: (s) => new GoogleFreeProvider({ transport: s.transport }),
  },

  deepl: {
    id: 'deepl',
    label: 'DeepL Pro',
    optionLabel: 'DeepL (Pro API)',
    group: 'mt',
    note:
      'Usually the best quality for European languages. A key ending in “:fx” is a Free key and ' +
      'will be routed to the free endpoint automatically.',
    fields: [
      {
        id: 'key',
        label: 'DeepL Pro auth key',
        type: 'password',
        placeholder: 'xxxxxxxx-xxxx-…',
        credential: true,
        target: { scope: 'secret', key: 'deeplKey' },
      },
    ],
    capabilities: NO_CAPABILITIES,
    domains: ['https://api.deepl.com', 'https://api-free.deepl.com'],
    // Pro and Free share a bucket: same engine, different billing tier.
    cacheKey: () => 'deepl',
    create: (s) =>
      new DeepLProvider({ transport: s.transport, apiKey: trimmed(s.secrets.deeplKey), freeTier: false }),
  },

  'deepl-free': {
    id: 'deepl-free',
    label: 'DeepL Free',
    optionLabel: 'DeepL (Free API)',
    group: 'mt',
    note: '500,000 characters per month at no cost. Same engine as Pro.',
    fields: [
      {
        id: 'key',
        label: 'DeepL Free auth key (ends in “:fx”)',
        type: 'password',
        placeholder: 'xxxxxxxx-xxxx-…:fx',
        credential: true,
        target: { scope: 'secret', key: 'deeplFreeKey' },
      },
    ],
    capabilities: NO_CAPABILITIES,
    domains: ['https://api-free.deepl.com'],
    cacheKey: () => 'deepl',
    create: (s) =>
      new DeepLProvider({ transport: s.transport, apiKey: trimmed(s.secrets.deeplFreeKey), freeTier: true }),
  },
};

/** Display order in the mode picker. */
export const PROVIDER_LIST: ProviderDescriptor[] = [
  PROVIDERS.manual,
  PROVIDERS.openai,
  PROVIDERS.gemini,
  PROVIDERS.google,
  PROVIDERS['google-free'],
  PROVIDERS.deepl,
  PROVIDERS['deepl-free'],
];

export function getProvider(mode: TranslationMode): ProviderDescriptor {
  return PROVIDERS[mode] || PROVIDERS.manual;
}

/** Reads a field's current value out of settings/secrets. */
export function fieldValue(field: ProviderField, state: { settings: PersistedSettings; secrets: Secrets }): string {
  return field.target.scope === 'secret'
    ? state.secrets[field.target.key]
    : state.settings[field.target.key];
}

/** The credential that must be present before a run may start, if any. */
export function missingCredential(
  descriptor: ProviderDescriptor,
  state: { settings: PersistedSettings; secrets: Secrets }
): ProviderField | null {
  for (const field of descriptor.fields) {
    if (field.credential && !fieldValue(field, state).trim()) return field;
  }
  return null;
}

/** Every host any provider can reach — compared against manifest.json in the tests. */
export function allDomains(): string[] {
  const seen: string[] = [];
  for (const descriptor of PROVIDER_LIST) {
    for (const domain of descriptor.domains) {
      if (seen.indexOf(domain) < 0) seen.push(domain);
    }
  }
  return seen.sort();
}
