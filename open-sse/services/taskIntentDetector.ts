export type TaskFamily =
  | "casual"
  | "generalQuestion"
  | "repositoryNavigation"
  | "fileInspection"
  | "codeInspection"
  | "codeChange"
  | "debugging"
  | "testing"
  | "refactorMigration"
  | "architecture"
  | "documentation"
  | "dataTransformation"
  | "gitOps"
  | "devOps"
  | "researchComparison"
  | "securityReview"
  | "unknown";

export type TaskActionMode =
  "conversational" | "readOnly" | "planOnly" | "modify" | "execute" | "validate" | "unknown";

export type TaskScope =
  "singleItem" | "bounded" | "multiFile" | "repositoryWide" | "systemWide" | "unknown";

export type TaskComplexity = "simple" | "complex" | "unknown";

export interface TaskIntentResult {
  family: TaskFamily;
  actionMode: TaskActionMode;
  scope: TaskScope;
  complexity: TaskComplexity;
  confidence: number;
  recognized: boolean;
  roleEvidence: {
    fastWorker: number;
    strongReasoning: number;
  };
  signals: string[];
  reason: string;
}

const PLAN_RE =
  /\b(?:plan|propose|outline|recommend|design a plan|roadmap|rencana|rancang rencana|usulkan|planejar|proponer|planen|план|계획|خطة)\b|(?:计划|計画)/iu;
const READ_ONLY_OVERRIDE_RE =
  /\b(?:do not|don'?t|without|never)\s+(?:execute|run|change|modify|edit|write)|\b(?:just asking|read[- ]only|analysis only)|\b(?:jangan|tanpa)\s+(?:jalankan|eksekusi|ubah|mengubah|edit)|\b(?:cuma|hanya)\s+(?:tanya|bertanya)|\b(?:no|sin)\s+(?:ejecutar|modificar|cambiar)|\b(?:não|sem)\s+(?:executar|alterar|modificar)|\b(?:nicht|ohne)\s+(?:ausführen|ändern)|(?:不要执行|不要修改|実行しない|変更しない|실행하지 마|수정하지 마|не выполнять|не изменять|لا تنفذ|لا تعدل)/iu;
const EXECUTE_RE =
  /\b(?:run|execute|build|compile|install|deploy|start|restart|launch|commit|push|pull|merge|rebase|publish|package|jalankan|eksekusi|bangun|kompilasi|instal|deploy|mulai|commit|push|merge|executar|compilar|instalar|desplegar|ausführen|installieren|развернуть|запустить|실행|배포|تنفيذ|نشر)\b|(?:実行|ビルド|デプロイ|运行|部署)/iu;
const MODIFY_RE =
  /\b(?:add|change|edit|update|modify|remove|delete|replace|rename|format|fix|implement|create|write|patch|tambah|ubah|edit|perbarui|hapus|ganti|namai ulang|format|perbaiki|implementasikan|buat|alterar|editar|actualizar|eliminar|reemplazar|renombrar|ändern|bearbeiten|aktualisieren|löschen|umbenennen|изменить|обновить|удалить|수정|업데이트|삭제|تعديل|تحديث|حذف)\b|(?:添加|修改|删除|更新|変更|編集|削除|追加)/iu;
const VALIDATE_RE =
  /\b(?:verify|validate|check|review|audit|test|lint|typecheck|confirm|pastikan|verifikasi|validasi|periksa|tinjau|uji|revisar|verificar|validar|prüfen|überprüfen|проверить|검증|확인|مراجعة|تحقق)\b|(?:检查|验证|確認|検証)/iu;
const READ_RE =
  /\b(?:open|read|show|list|search|find|locate|inspect|compare|extract|summari[sz]e|explain|tell me|buka|baca|tampilkan|daftar|cari|periksa|bandingkan|ekstrak|ringkas|jelaskan|abrir|leer|listar|buscar|comparar|extraer|resumir|explicar|öffnen|lesen|auflisten|suchen|vergleichen|extrahieren|zusammenfassen|erklären|открыть|читать|найти|сравнить|объяснить|열어|읽어|찾아|비교|요약|설명|فتح|قراءة|بحث|مقارنة|تلخيص|شرح)\b|(?:打开|读取|查找|比较|提取|总结|解释|開く|読む|検索|比較|抽出|要約|説明)/iu;
const SCRIPT_READ_RE =
  /(?:открыть|прочитать|читать|найти|сравнить|резюмировать|объяснить|열어|읽어|찾아|비교|요약|설명|فتح|قراءة|بحث|مقارنة|تلخيص|شرح|打开|读取|查找|比较|提取|总结|解释|開く|読む|検索|比較|抽出|要約|説明)/iu;

const FILE_ARTIFACT_RE =
  /\b(?:files?|folders?|director(?:y|ies)|xml|json|ya?ml|csv|toml|configs?|templates?|logs?|documents?|markdown|\.md|ids?|keys?|values?|berkas|file|folder|direktori|konfigurasi|templat|log|dokumen|chaves?|arquivos?|carpetas?|archivos?|datei(?:en)?|ordner|файл(?:ы)?|папк[аи]|파일|폴더|ملفات?|مجلد)\b|(?:文件|文件夹|目录|フォルダ|ファイル)/iu;
const DOCUMENTATION_RE =
  /\b(?:readme|changelog|documentation|docs?|markdown|release notes?|api reference|guide|tutorial|dokumentasi|panduan|catatan rilis|documentação|documentación|dokumentation|документац|문서|توثيق)\b|(?:文档|ドキュメント)/iu;
const CODE_ARTIFACT_RE =
  /\b(?:code|function|class|method|module|component|hook|endpoint|api|database|query|schema|interface|package|dependency|import path|import|typescript|javascript|python|source|implementation|ui|ux|user interface|theme|css|tailwind|styling|style|layout|responsive|design system|palette|typography|kode|fungsi|kelas|metode|modul|komponen|repositori|implementasi|tampilan|tema|warna|gaya|código|función|funktion|модул|функц|코드|함수|كود|دالة)\b|(?:代码|函数|クラス|コード|関数)/iu;
const REPOSITORY_RE =
  /\b(?:repository|repo|codebase|project|workspace|source tree|repositori|proyek|kode sumber|repositório|proyecto|projekt|репозитор|프로젝트|مستودع)\b|(?:代码库|项目|リポジトリ|プロジェクト)/iu;
const TEST_RE =
  /\b(?:tests?|unit tests?|integration tests?|e2e|test suite|specs?|coverage|fixture|mock|assertion|uji|pengujian|tes unit|prueba|teste|тест|테스트|اختبار)\b|(?:测试|テスト)/iu;
const GIT_RE = /\b(?:git|branch|commit|merge|rebase|cherry-pick|pull request|\bpr\b|checkout)\b/i;
const DEVOPS_RE =
  /\b(?:deploy|deployment|docker|container|kubernetes|k8s|server|proxy|pipeline|ci\/cd|github actions|production|staging|npm pack|release build|infra(?:structure)?|layanan|servis|сервер|배포|خادم)\b|(?:服务器|部署|サーバー|デプロイ)/iu;
const DATA_TRANSFORM_RE =
  /\b(?:convert|transform|serialize|deserialize|normalize|parse|map|reshape|migrate data|konversi|ubah format|transformasi|parse|convertir|transformar|konvertieren|преобразовать|변환|تحويل)\b|(?:转换|変換)/iu;
const STRUCTURED_DATA_RE = /\b(?:xml|json|ya?ml|csv|toml|configs?|schemas?)\b/i;
const DEBUG_RE =
  /\b(?:debug|bug|error|exception|failure|failed|broken|root cause|investigate|trace|flaky|intermittent|race condition|deadlock|regression|memory leak|hang|why (?:does|is|did)|kenapa|gagal|rusak|akar masalah|selidiki|lacak|macet|depurar|fallo|fehler|debuggen|ошибк|сбой|디버그|오류|فشل|خطأ)\b|(?:调试|错误|故障|デバッグ|エラー)/iu;
const REFACTOR_RE =
  /\b(?:refactor|migration|migrate|rewrite|redesign|restructure|backward compatibility|breaking change|refaktor|migrasi|tulis ulang|reestructurar|refaktorieren|migration|рефактор|миграц|리팩터|마이그레이션|إعادة هيكلة|ترحيل)\b|(?:重构|迁移|リファクタ|移行)/iu;
const ARCHITECTURE_RE =
  /\b(?:architecture|architectural|system design|design tradeoffs?|request lifecycle|data flow|end[- ]to[- ]end flow|complete flow|project flow|solution flow|function\s+(?:that|which)\s+(?:will\s+)?move\s+to\s+(?:the\s+)?next step|distributed|scalability|bottleneck|arsitektur|desain sistem|alur data|alur lengkap|alur proyek|alur solusi|fungsi\s+yang\s+(?:akan\s+)?(?:lanjut|berpindah)\s+ke\s+langkah\s+berikutnya|terdistribusi|arquitectura|architektur|архитектур|분산|아키텍처|هندسة معمارية|موزع)\b|(?:架构|分布式|アーキテクチャ|分散)/iu;
const SECURITY_RE =
  /\b(?:security|secure|vulnerability|exploit|authentication|authorization|permission|credential|injection|xss|csrf|threat model|keamanan|kerentanan|autentikasi|otorisasi|seguridad|sicherheit|уязвим|безопасност|보안|취약점|أمان|ثغرة)\b|(?:安全|漏洞|セキュリティ|脆弱性)/iu;
const RESEARCH_RE =
  /\b(?:research|analy[sz]e|evaluate|compare|benchmark|tradeoffs?|pros and cons|recommend|investigate options|riset|analisis|evaluasi|bandingkan|rekomendasi|investigar|analizar|evaluar|recherchieren|analysieren|сравнить|анализ|분석|비교|تحليل|مقارنة)\b|(?:分析|比较|評価|分析する|比較)/iu;
const EXACT_LOOKUP_RE =
  /\b(?:exact|duplicate|duplicates|same id|matching ids?|occurrences?|typo|rename|format|version badge|focused test|one[- ]line|small change|quick fix|persis|duplikat|id yang sama|salah ketik|cocok|duplicad[oa]s?|exakt|doppelt|точн|дубликат|중복|مطابق|مكرر)\b|(?:重复|完全一致|重複|一致)/iu;
const COMPLEXITY_RE =
  /\b(?:root cause|race condition|deadlock|intermittent|flaky|architecture|architectural|security|vulnerability|migration|backward compatibility|breaking changes?|semantic(?:ally)?|distributed|system[- ]wide|repo(?:sitory)?[- ]wide|whole codebase|entire codebase|whole repository|entire repository|whole project|entire project|full project|whole solution|entire solution|full solution|complete codebase|across (?:multiple|all)|multi[- ]file|performance regression|bottleneck|tradeoffs?|prove|akar masalah|seluruh repo|seluruh repositori|seluruh proyek|keseluruhan proyek|keseluruhan solusi|lintas file|arsitektur|keamanan|migrasi|arquitectura|seguridad|architektur|sicherheit|архитектур|безопасност|분산|보안|أمان)\b|(?:架构|安全|迁移|アーキテクチャ|セキュリティ)/iu;
const QUESTION_RE =
  /^(?:what|who|where|when|why is|how (?:does|do|is|can)|apa itu|siapa|di mana|kapan|bagaimana cara|o que|quem|onde|quando|qué es|quién|dónde|cuándo|was ist|wer ist|wo ist|wann|что такое|кто|где|когда|무엇|누구|어디|언제|ما هو|من هو|أين|متى)\b|(?:什么是|谁是|哪里|とは何|いつ|誰|이란 무엇|ما هو)/iu;
const CONTEXTUAL_QUESTION_RE =
  /^(?:what about|what should happen here|and (?:this|that)|how about)|\b(?:previous one|yang tadi|ini gimana|tersebut|esto|eso|isso|das hier|это|이것|그것|هذا|ذلك)\b|(?:这个呢|これは|それは)/iu;

const SYSTEM_SCOPE_RE =
  /\b(?:system[- ]wide|end[- ]to[- ]end|distributed system|across (?:all )?services|seluruh sistem|lintas layanan)\b/i;
const REPOSITORY_SCOPE_RE =
  /\b(?:repo(?:sitory)?[- ]wide|whole codebase|entire codebase|complete codebase|whole repository|entire repository|whole project|entire project|full project|whole solution|entire solution|full solution|across the repository|across the project|seluruh repo|seluruh repositori|seluruh proyek|keseluruhan proyek|keseluruhan solusi|proyek secara keseluruhan)\b/i;
const MULTI_FILE_SCOPE_RE =
  /\b(?:multi[- ]file|multiple files|several files|across files|across modules|beberapa file|lintas file|varios archivos|mehrere dateien)\b/i;
const BOUNDED_SCOPE_RE =
  /\b(?:these|those|two|three|both|between|this folder|this directory|selected files|kedua|dua file|folder ini|direktori ini|estos archivos|diese dateien)\b/i;
const SINGLE_SCOPE_RE =
  /\b(?:this|one|single|current)\s+(?:file|function|class|component|module|test|document|endpoint)|\b(?:file|fungsi|komponen|modul) ini\b/i;

const FAMILY_EVIDENCE: Record<
  Exclude<TaskFamily, "unknown">,
  { fastWorker: number; strongReasoning: number }
> = {
  casual: { fastWorker: 0.85, strongReasoning: 0 },
  generalQuestion: { fastWorker: 0.72, strongReasoning: 0.05 },
  repositoryNavigation: { fastWorker: 0.78, strongReasoning: 0.05 },
  fileInspection: { fastWorker: 0.8, strongReasoning: 0.05 },
  codeInspection: { fastWorker: 0.65, strongReasoning: 0.2 },
  codeChange: { fastWorker: 0.62, strongReasoning: 0.25 },
  debugging: { fastWorker: 0.08, strongReasoning: 0.82 },
  testing: { fastWorker: 0.65, strongReasoning: 0.2 },
  refactorMigration: { fastWorker: 0.05, strongReasoning: 0.86 },
  architecture: { fastWorker: 0.03, strongReasoning: 0.9 },
  documentation: { fastWorker: 0.75, strongReasoning: 0.08 },
  dataTransformation: { fastWorker: 0.7, strongReasoning: 0.15 },
  gitOps: { fastWorker: 0.62, strongReasoning: 0.22 },
  devOps: { fastWorker: 0.62, strongReasoning: 0.2 },
  researchComparison: { fastWorker: 0.2, strongReasoning: 0.62 },
  securityReview: { fastWorker: 0.02, strongReasoning: 0.92 },
};

function detectActionMode(prompt: string): TaskActionMode {
  if (PLAN_RE.test(prompt)) return "planOnly";
  if (READ_ONLY_OVERRIDE_RE.test(prompt)) return "readOnly";
  if (EXECUTE_RE.test(prompt)) return "execute";
  if (MODIFY_RE.test(prompt)) return "modify";
  if (VALIDATE_RE.test(prompt)) return "validate";
  if (READ_RE.test(prompt) || SCRIPT_READ_RE.test(prompt)) return "readOnly";
  return "unknown";
}

function detectScope(prompt: string): TaskScope {
  if (SYSTEM_SCOPE_RE.test(prompt)) return "systemWide";
  if (REPOSITORY_SCOPE_RE.test(prompt)) return "repositoryWide";
  if (MULTI_FILE_SCOPE_RE.test(prompt)) return "multiFile";
  if (BOUNDED_SCOPE_RE.test(prompt)) return "bounded";
  if (SINGLE_SCOPE_RE.test(prompt)) return "singleItem";
  return "unknown";
}

function detectFamily(prompt: string, actionMode: TaskActionMode): TaskFamily {
  const hasFiles = FILE_ARTIFACT_RE.test(prompt);
  const hasCode = CODE_ARTIFACT_RE.test(prompt);
  const hasRepository = REPOSITORY_RE.test(prompt);
  const hasReadOperation =
    READ_RE.test(prompt) || SCRIPT_READ_RE.test(prompt) || VALIDATE_RE.test(prompt);
  const isQuestion = QUESTION_RE.test(prompt.trim()) && !CONTEXTUAL_QUESTION_RE.test(prompt);

  if (SECURITY_RE.test(prompt)) return "securityReview";
  if (DEBUG_RE.test(prompt)) return "debugging";
  // "Rewrite" is common in ordinary writing work. Treat it as a code
  // refactor only when the request also names a code/repository artifact;
  // explicit refactor and migration vocabulary remains unambiguous.
  if (
    REFACTOR_RE.test(prompt) &&
    (hasCode || hasRepository || hasFiles || !/\brewrite\b/i.test(prompt))
  ) {
    return "refactorMigration";
  }
  if (ARCHITECTURE_RE.test(prompt)) return "architecture";
  if (TEST_RE.test(prompt)) return "testing";
  if (GIT_RE.test(prompt)) return "gitOps";
  if (DEVOPS_RE.test(prompt)) return "devOps";
  if (DOCUMENTATION_RE.test(prompt)) return "documentation";
  if (DATA_TRANSFORM_RE.test(prompt) && hasFiles) return "dataTransformation";
  if (isQuestion) return "generalQuestion";
  if (hasFiles && hasReadOperation) return "fileInspection";
  if (hasFiles && (actionMode === "modify" || actionMode === "execute")) {
    return STRUCTURED_DATA_RE.test(prompt) ? "dataTransformation" : "codeChange";
  }
  if (hasRepository && hasReadOperation) return "repositoryNavigation";
  if (hasCode && (actionMode === "modify" || actionMode === "execute")) return "codeChange";
  if (hasCode && hasReadOperation) return "codeInspection";
  if (RESEARCH_RE.test(prompt)) return "researchComparison";
  return "unknown";
}

function reasonForFamily(family: TaskFamily): string {
  return family === "unknown"
    ? "unrecognized-task-family"
    : `recognized-${family.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function detectTaskIntent(prompt: string): TaskIntentResult {
  const text = prompt.trim();
  if (!text) {
    return {
      family: "unknown",
      actionMode: "unknown",
      scope: "unknown",
      complexity: "unknown",
      confidence: 0,
      recognized: false,
      roleEvidence: { fastWorker: 0, strongReasoning: 0 },
      signals: ["task:none"],
      reason: "empty-request",
    };
  }

  const actionMode = detectActionMode(text);
  const scope = detectScope(text);
  const family = detectFamily(text, actionMode);
  const recognized = family !== "unknown";
  const hasComplexity = COMPLEXITY_RE.test(text);
  const hasExactLookup = EXACT_LOOKUP_RE.test(text);
  const complexFamily = [
    "debugging",
    "refactorMigration",
    "architecture",
    "securityReview",
  ].includes(family);
  const broadScope = scope === "repositoryWide" || scope === "systemWide";
  const complexity: TaskComplexity = !recognized
    ? "unknown"
    : complexFamily || hasComplexity || broadScope
      ? "complex"
      : "simple";

  let roleEvidence = recognized
    ? { ...FAMILY_EVIDENCE[family as Exclude<TaskFamily, "unknown">] }
    : { fastWorker: 0, strongReasoning: 0 };
  if (complexity === "complex") {
    roleEvidence = {
      fastWorker: Math.min(roleEvidence.fastWorker, 0.15),
      strongReasoning: Math.max(roleEvidence.strongReasoning, 0.8),
    };
  } else if (hasExactLookup) {
    roleEvidence.fastWorker = Math.max(roleEvidence.fastWorker, 0.82);
  }
  if (scope === "multiFile") {
    roleEvidence.strongReasoning = Math.max(roleEvidence.strongReasoning, 0.55);
  }

  const signals = [
    `task-family:${family}`,
    `action:${actionMode}`,
    `scope:${scope}`,
    ...(hasExactLookup ? ["complexity:exact-lookup"] : []),
    ...(hasComplexity ? ["complexity:strong-signal"] : []),
  ];
  const confidence = recognized
    ? Math.min(
        0.95,
        0.72 + Number(actionMode !== "unknown") * 0.1 + Number(scope !== "unknown") * 0.06
      )
    : 0;

  return {
    family,
    actionMode,
    scope,
    complexity,
    confidence,
    recognized,
    roleEvidence,
    signals,
    reason: reasonForFamily(family),
  };
}
