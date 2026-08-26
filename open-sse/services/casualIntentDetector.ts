export interface CasualIntentResult {
  score: number;
  confidence: number;
  isCasual: boolean;
  contextDependent: boolean;
  signals: string[];
  reason: "casual-conversation" | "context-dependent-conversation" | "not-casual";
}

const CASUAL_PATTERNS = [
  /\b(?:how are you|what'?s up|grab coffee|good (?:morning|night)|thanks|lol|haha|hey dude)\b/i,
  /\b(?:woi|ngopi|apa kabar|lagi apa|makasih|terima kasih|wkwk|gas|ayo)\b/i,
  /\b(?:tudo bem|beleza|oi cara|bom dia|boa noite|obrigad[oa])\b/i,
  /\b(?:qué tal|como estás|oye tío|buenos días|buenas noches|gracias)\b/i,
  /(?:你好|最近怎么样|早上好|晚安|谢谢)/u,
  /(?:こんにちは|やあ|元気|おはよう|おやすみ|ありがとう)/u,
  /(?:привет|как дела|доброе утро|спокойной ночи|спасибо)/iu,
  /\b(?:hallo|wie geht'?s|guten morgen|gute nacht|danke)\b/i,
  /(?:안녕|잘 지내|좋은 아침|잘 자|고마워)/u,
  /(?:مرحبا|كيف حالك|صباح الخير|تصبح على خير|شكرا)/u,
];

const CONTEXT_PATTERNS = [
  /\b(?:that one|what about this|really|are you sure|i (?:still )?don'?t believe)\b/i,
  /\b(?:yang tadi|ini gimana|masa sih|kok bisa|beneran|serius|masih (?:ga|gak|nggak) percaya)\b/i,
  /\b(?:e isso|e este|sério|tem certeza)\b/i,
  /\b(?:y eso|y esto|en serio|estás seguro)\b/i,
  /(?:真的吗|你确定吗|这个呢)/u,
  /(?:本当に|これどう|確かですか)/u,
  /(?:правда|ты уверен|а это)/iu,
  /\b(?:wirklich|bist du sicher|und das)\b/i,
  /(?:정말|확실해|이건 어때)/u,
  /(?:حقا|هل أنت متأكد|ماذا عن هذا)/u,
];

const EXPLICIT_TASK_RE =
  /\b(?:debug|refactor|implement|deploy|install|code|function|class|api|database|race condition|root cause|prove|calculate|solve|analy[sz]e|design|trace|fix|review|test|file|folder|tool|automation|kode|fungsi|implementasikan|perbaiki|uji|buktikan|hitung|analisis|selidiki|arquivo|código|depurar|implementar|prueba|código|implementa|debuggen|implementieren)\b|(?:调试|代码|证明|计算|デバッグ|コード|証明|계산|코드|디버그|код|доказать|تحليل|كود|إثبات)/iu;

function countMatches(prompt: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + Number(pattern.test(prompt)), 0);
}

export function detectCasualIntent(prompt: string): CasualIntentResult {
  const text = prompt.trim();
  const contextMatches = countMatches(text, CONTEXT_PATTERNS);
  const casualMatches = countMatches(text, CASUAL_PATTERNS);
  const hasExplicitTask = EXPLICIT_TASK_RE.test(text);
  const signals: string[] = [];
  if (casualMatches > 0) signals.push(`casual-markers:${casualMatches}`);
  if (contextMatches > 0) signals.push(`context-markers:${contextMatches}`);
  if (hasExplicitTask) signals.push("explicit-task-guard");

  if (contextMatches > 0 && !hasExplicitTask) {
    return {
      score: Math.min(1, 0.45 + contextMatches * 0.15),
      confidence: 0.55,
      isCasual: false,
      contextDependent: true,
      signals,
      reason: "context-dependent-conversation",
    };
  }

  const score = hasExplicitTask ? 0 : Math.min(1, casualMatches * 0.75);
  const isCasual = score >= 0.65;
  return {
    score,
    confidence: isCasual ? 0.85 : hasExplicitTask ? 0.9 : 0,
    isCasual,
    contextDependent: false,
    signals,
    reason: isCasual ? "casual-conversation" : "not-casual",
  };
}
