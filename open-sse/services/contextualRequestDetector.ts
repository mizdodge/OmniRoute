export type ContextualOperation =
  "transformPrevious" | "continuePrevious" | "clarifyPrevious" | "unknown";

export type ContextualFormat =
  "mermaid" | "diagram" | "table" | "summary" | "documentation" | "code" | "unknown";

export interface ContextualRequestResult {
  contextDependent: boolean;
  operation: ContextualOperation;
  format: ContextualFormat;
  confidence: number;
  signals: string[];
  reason: string;
}

const REFERENCE_RE =
  /\b(?:it|same|previous|above|earlier|those findings|these findings|that (?:flow|explanation|result|analysis|comparison|approach|implementation|one)|this (?:flow|explanation|result|analysis|comparison|approach|implementation|one)|the explanation|the result|the findings|the implementation|tadi|yang sama|sebelumnya|di atas|hasilnya|penjelasannya|implementasinya|kodenya|versi kodenya|(?:itu|ini) (?:alur|penjelasan|hasil|analisis|perbandingan|pendekatan|implementasi)|anterior|anteriormente|eso|esto|isso|mesmo|acima|vorherig|das|dies|oben|предыдущ|это|тот|выше|이전|그것|이것|위의|السابق|ذلك|هذا|أعلاه)\b|(?:这个|那个|上面的|之前的|これ|それ|前の|上記)/iu;
const NEW_TARGET_RE =
  /\b(?:new|baru|from scratch|payment|auth|authentication|parser|service|module|repository|repo|project|solution|codebase|file|folder|function|class|component|endpoint|database|cache|architecture|fitur baru|layanan|modul|proyek|repositori)\b/iu;
const INDEPENDENT_ACTION_RE =
  /\b(?:create|build|design|implement|update|modify|edit|fix|review|audit|run|execute|test|deploy|buat|bikin|bangun|rancang|implementasikan|ubah|perbarui|edit|perbaiki|tinjau|audit|jalankan|uji|deploy)\b/iu;
const CONTINUE_RE =
  /^(?:please\s+|could you\s+|can you\s+|tolong\s+)?(?:continue|go on|keep going|resume|pick up|lanjut|lanjutkan|teruskan|continuar|weiter|fortfahren|продолж|계속|تابع)\b|^(?:next part|bagian berikutnya|继续|続け)/iu;
const CLARIFY_RE =
  /\b(?:clarify|elaborate|explain again|more detail|why is that|how so|perjelas|jelaskan lagi|lebih detail|kok bisa|kenapa begitu|aclarar|explicar de nuevo|erkläre noch einmal|уточн|объясни ещё|다시 설명|وضح|اشرح مرة أخرى)\b|(?:再解释|詳しく説明)/iu;

const FORMAT_PATTERNS: ReadonlyArray<[Exclude<ContextualFormat, "unknown">, RegExp]> = [
  ["mermaid", /\bmermaid\b/i],
  [
    "diagram",
    /\b(?:diagram|chart|flowchart|sequence diagram|visuali[sz]e|diagram alur|bagan|visualisasikan|diagrama|diagramm|диаграмм|다이어그램|مخطط)\b|(?:图表|流程图|ダイアグラム|図)/iu,
  ],
  [
    "table",
    /\b(?:table|tabulate|tabular|tabel|jadikan tabel|tabla|tabela|tabelle|таблиц|표|جدول)\b|(?:表格|テーブル)/iu,
  ],
  [
    "summary",
    /\b(?:summary|summari[sz]e|shorter|bullets?|points?|ringkas|rangkuman|poin|resumen|resumo|zusammenfass|кратко|резюме|요약|ملخص)\b|(?:总结|要約)/iu,
  ],
  [
    "documentation",
    /\b(?:documentation|docs?|readme|markdown|guide|dokumentasi|panduan|documentación|documentação|dokumentation|документац|문서|توثيق)\b|(?:文档|ドキュメント)/iu,
  ],
  [
    "code",
    /\b(?:as code|code version|implementation|snippet|kode|kodenya|versi kode|versi kodenya|implementasi|como código|als code|код|코드|كود)\b|(?:代码|コード)/iu,
  ],
];

const TRANSFORM_RE =
  /\b(?:turn|convert|transform|rewrite|show|present|put|provide|give|explain|visuali[sz]e|document|tabulate|summari[sz]e|ubah|jadikan|tampilkan|sajikan|kasih|jelaskan|jelasin|visualisasikan|dokumentasikan|ringkas|convertir|transformar|mostrar|apresentar|umwandeln|zeigen|darstellen|преобраз|покажи|представь|변환|보여|تحويل|اعرض)\b|(?:转换|表示|変換|見せ)/iu;
const FORMAT_ONLY_RE =
  /\b(?:explain|show|present|provide|give|jelaskan|jelasin|tampilkan|sajikan|kasih)\s+(?:(?:it|itu|ini)\s+)?(?:in|as|into|using|with|dalam|sebagai|jadi|pakai|menggunakan)\s+(?:an?\s+)?(?:mermaid|diagram|chart|flowchart|table|summary|markdown|code)\b/iu;
const LOCAL_ANTECEDENT_RE =
  /\b(?:open|read|inspect|review|check|compare|analy[sz]e|find|buka|baca|periksa|tinjau|bandingkan|analisis)\b[^.!?]{1,180}\b(?:and|then|lalu|dan)\b[^.!?]{0,80}\b(?:it|that|this|itu|ini)\b/iu;
const INDONESIAN_OBJECT_REFERENCE_RE =
  /\b(?:jelaskan|jelasin|ubah|jadikan|tampilkan|sajikan|ringkas)\s+(?:itu|ini)\b/iu;

function detectFormat(prompt: string): ContextualFormat {
  for (const [format, pattern] of FORMAT_PATTERNS) {
    if (pattern.test(prompt)) return format;
  }
  return "unknown";
}

/**
 * Detect requests whose meaning depends on bounded recent work. This detector
 * only decides whether context is required; it never chooses a worker role.
 */
export function detectContextualRequest(prompt: string): ContextualRequestResult {
  const text = prompt.trim();
  if (!text) {
    return {
      contextDependent: false,
      operation: "unknown",
      format: "unknown",
      confidence: 0,
      signals: ["contextual:none"],
      reason: "empty-request",
    };
  }

  const format = detectFormat(text);
  const hasReference =
    (REFERENCE_RE.test(text) || INDONESIAN_OBJECT_REFERENCE_RE.test(text)) &&
    !LOCAL_ANTECEDENT_RE.test(text);
  const hasContinue = CONTINUE_RE.test(text);
  const hasClarify = CLARIFY_RE.test(text);
  const hasTransform = format !== "unknown" && TRANSFORM_RE.test(text);
  const hasIndependentTarget = INDEPENDENT_ACTION_RE.test(text) && NEW_TARGET_RE.test(text);
  const formatOnlyRequest = hasTransform && !hasIndependentTarget && FORMAT_ONLY_RE.test(text);

  if (hasIndependentTarget && !hasReference) {
    return {
      contextDependent: false,
      operation: "unknown",
      format,
      confidence: 0.9,
      signals: ["contextual:explicit-new-task", `format:${format}`],
      reason: "explicit-independent-task",
    };
  }

  let operation: ContextualOperation = "unknown";
  if (hasContinue) operation = "continuePrevious";
  else if (hasClarify) operation = "clarifyPrevious";
  else if (hasTransform && (hasReference || formatOnlyRequest)) operation = "transformPrevious";

  const contextDependent = operation !== "unknown";
  const confidence = contextDependent
    ? hasReference
      ? 0.94
      : hasContinue || hasClarify
        ? 0.88
        : 0.78
    : 0;
  const signals = [
    `contextual-operation:${operation}`,
    `format:${format}`,
    ...(hasReference ? ["context-reference"] : []),
    ...(formatOnlyRequest ? ["contextual-format-only"] : []),
  ];

  return {
    contextDependent,
    operation,
    format,
    confidence,
    signals,
    reason: contextDependent ? "context-dependent-request" : "independent-request",
  };
}
