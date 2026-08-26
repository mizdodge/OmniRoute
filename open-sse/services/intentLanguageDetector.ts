export type SupportedIntentLanguage =
  "en" | "id" | "pt-BR" | "es" | "zh" | "ja" | "ru" | "de" | "ko" | "ar";

export interface LanguageDetectionResult {
  languages: SupportedIntentLanguage[];
  primary: SupportedIntentLanguage | "unknown";
  mixed: boolean;
  supported: boolean;
  confidence: number;
  signals: string[];
}

const LANGUAGE_MARKERS: Readonly<Record<SupportedIntentLanguage, readonly string[]>> = {
  en: [
    "please",
    "can you",
    "could you",
    "what",
    "why",
    "how",
    "this",
    "that",
    "hello",
    "hi",
    "hey",
    "dude",
    "today",
    "thanks",
    "wanna",
    "open",
    "read",
    "compare",
    "summarize",
    "file",
    "folder",
    "update",
    "run",
    "fix",
  ],
  id: [
    "tolong",
    "yang",
    "dan",
    "ini",
    "itu",
    "gimana",
    "kenapa",
    "nggak",
    "gak",
    "gua",
    "gue",
    "kok",
    "sih",
    "dong",
    "nih",
    "masa",
    "percaya",
    "ngopi",
    "wkwk",
    "buka",
    "baca",
    "bandingkan",
    "ringkas",
    "perbarui",
    "jalankan",
    "perbaiki",
  ],
  "pt-BR": [
    "você",
    "voce",
    "não",
    "nao",
    "pra",
    "tudo bem",
    "como você",
    "por favor",
    "beleza",
    "cara",
    "isso",
    "aqui",
    "abrir",
    "arquivos",
    "comparar",
    "resumir",
    "duplicados",
    "atualizar",
    "executar",
  ],
  es: [
    "qué",
    "que tal",
    "cómo",
    "como estás",
    "por qué",
    "esto",
    "hola",
    "oye",
    "vale",
    "tío",
    "puedes",
    "necesito",
    "abrir",
    "archivos",
    "comparar",
    "resumir",
    "duplicados",
    "actualizar",
    "ejecutar",
  ],
  zh: ["你好", "今天", "怎么样", "最近", "请", "这个", "为什么", "可以", "谢谢"],
  ja: ["こんにちは", "やあ", "今日", "どう", "元気", "お願い", "これ", "なぜ", "ありがとう"],
  ru: ["привет", "как дела", "сегодня", "пожалуйста", "это", "почему", "можешь", "спасибо"],
  de: [
    "hallo",
    "wie geht",
    "heute",
    "bitte",
    "warum",
    "kannst du",
    "danke",
    "nicht",
    "doch",
    "öffnen",
    "dateien",
    "vergleichen",
    "zusammenfassen",
    "duplikate",
    "aktualisieren",
    "ausführen",
  ],
  ko: ["안녕", "오늘", "어떻게", "지내", "부탁", "이것", "왜", "고마워"],
  ar: ["مرحبا", "كيف حالك", "اليوم", "من فضلك", "هذا", "لماذا", "هل يمكنك", "شكرا"],
};

const UNSUPPORTED_SCRIPTS = [
  ["thai", /\p{Script=Thai}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["greek", /\p{Script=Greek}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
] as const;

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[’']/g, "'");
}

function containsLatinMarker(text: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "u").test(text);
}

function markerCount(text: string, language: SupportedIntentLanguage): number {
  const isLatin = ["en", "id", "pt-BR", "es", "de"].includes(language);
  return LANGUAGE_MARKERS[language].reduce(
    (count, marker) =>
      count + (isLatin ? Number(containsLatinMarker(text, marker)) : Number(text.includes(marker))),
    0
  );
}

function scriptEvidence(text: string): Partial<Record<SupportedIntentLanguage, number>> {
  const evidence: Partial<Record<SupportedIntentLanguage, number>> = {};
  const hasKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  if (hasKana) evidence.ja = 3;
  if (/\p{Script=Hangul}/u.test(text)) evidence.ko = 3;
  if (/\p{Script=Cyrillic}/u.test(text)) evidence.ru = 3;
  if (/\p{Script=Arabic}/u.test(text)) evidence.ar = 3;
  if (/\p{Script=Han}/u.test(text)) {
    evidence[hasKana ? "ja" : "zh"] = 3;
  }
  return evidence;
}

/**
 * Cheap, deterministic language evidence for the intent router. This is not a
 * translation system: it only decides whether local intent rules have enough
 * language coverage or should defer to the configured AI classifier.
 */
export function detectPromptLanguage(prompt: string): LanguageDetectionResult {
  const text = normalize(prompt.trim());
  if (!text) {
    return {
      languages: [],
      primary: "unknown",
      mixed: false,
      supported: false,
      confidence: 0,
      signals: ["language:empty"],
    };
  }

  const unsupported = UNSUPPORTED_SCRIPTS.find(([, pattern]) => pattern.test(text));
  const scores = new Map<SupportedIntentLanguage, number>();
  const scripts = scriptEvidence(text);
  for (const language of Object.keys(LANGUAGE_MARKERS) as SupportedIntentLanguage[]) {
    const score = markerCount(text, language) + (scripts[language] ?? 0);
    if (score > 0) scores.set(language, score);
  }

  const ordered = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const languages = ordered.map(([language]) => language);
  const maxScore = ordered[0]?.[1] ?? 0;
  const signals = ordered.slice(0, 4).map(([language, score]) => `language:${language}:${score}`);

  if (unsupported && languages.length === 0) {
    return {
      languages: [],
      primary: "unknown",
      mixed: false,
      supported: false,
      confidence: 1,
      signals: [`unsupported-script:${unsupported[0]}`],
    };
  }

  if (languages.length === 0) {
    return {
      languages: [],
      primary: "unknown",
      mixed: false,
      supported: false,
      confidence: 0,
      signals: ["language:unknown"],
    };
  }

  if (unsupported) signals.push(`unsupported-script:${unsupported[0]}`);
  return {
    languages,
    primary: languages[0] ?? "unknown",
    mixed: languages.length > 1 || Boolean(unsupported),
    supported: !unsupported,
    confidence: Math.min(1, 0.45 + maxScore * 0.18),
    signals,
  };
}
