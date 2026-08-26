export type RequestDomain =
  | "softwareEngineering"
  | "uiUx"
  | "dataAnalytics"
  | "documentWork"
  | "research"
  | "education"
  | "writingLanguage"
  | "creative"
  | "businessStrategy"
  | "finance"
  | "legal"
  | "medicalHealth"
  | "cybersecurity"
  | "mathematicsLogic"
  | "scienceEngineering"
  | "personalAdvice"
  | "multimodal"
  | "generalKnowledge"
  | "unknown";

export type RequestRisk = "routine" | "elevated" | "high" | "unknown";
export type RequestProfileComplexity = "simple" | "complex" | "unknown";
export type RequestArtifact =
  "sourceCode" | "userInterface" | "data" | "document" | "media" | "configuration" | "deployment";

export interface RequestProfileResult {
  domain: RequestDomain;
  artifacts: RequestArtifact[];
  risk: RequestRisk;
  complexity: RequestProfileComplexity;
  confidence: number;
  recognized: boolean;
  constraintCount: number;
  roleEvidence: { fastWorker: number; strongReasoning: number };
  signals: string[];
  reason: string;
}

type DomainRule = {
  domain: Exclude<RequestDomain, "unknown">;
  patterns: readonly RegExp[];
};

// Ordered only as a tie-breaker. Multiple independent patterns beat one broad
// match, so a prompt such as "suggest a palette for a poster" remains creative
// while "update the CSS theme palette" is UI/UX work.
const DOMAIN_RULES: readonly DomainRule[] = [
  {
    domain: "medicalHealth",
    patterns: [
      /\b(?:medical|medicine|clinical|patient|symptoms?|diagnosis|treatment|medications?|dosage|surgery|procedure|chronic conditions?|blood pressure|healthcare|kesehatan|gejala|diagnosis|pengobatan|obat|pasien)\b/i,
    ],
  },
  {
    domain: "legal",
    patterns: [
      /\b(?:legal|law|lawsuit|liability|jurisdiction|contract clauses?|force majeure|compliance|regulation|privacy obligations?|retention obligations?|employment obligations?|vendor obligations?|hukum|kontrak|tanggung jawab hukum|kepatuhan|yurisdiksi)\b/i,
    ],
  },
  {
    domain: "finance",
    patterns: [
      /\b(?:finance|financial|investment|portfolio|retirement|stocks?|bonds?|loan|interest rate|unit economics|recession|allocation|mortgage|cash flow|investasi|portofolio|saham|obligasi|pinjaman|keuangan)\b/i,
    ],
  },
  {
    domain: "cybersecurity",
    patterns: [
      /\b(?:cybersecurity|security vulnerability|exploit|threat model|penetration test|malware|phishing|credential leak|authentication bypass|authorization flaw|xss|csrf|injection attack|keamanan siber|kerentanan|eksploitasi)\b/i,
    ],
  },
  {
    domain: "uiUx",
    patterns: [
      /\b(?:ui|ux|user interface|user experience|design system|themes?|theming|dark mode|light theme|css|tailwind|responsive|microfrontends?|component patterns?|component styles?|brand colors?|css variables?)\b/i,
      /\b(?:palette|typography|spacing|layout|hover state|box shadow|modal|navigation links?|primary button|login card|dashboard|form|tampilan|warna|tema|responsif|antarmuka|aesthetic)\b/i,
    ],
  },
  {
    domain: "multimodal",
    patterns: [
      /\b(?:images?|screenshots?|photos?|diagrams?|video|audio|voice|ocr|transcribe|visual|spoken|gambar|tangkapan layar|foto|diagram|video|audio|suara)\b/i,
      /\b(?:visible text|main objects?|audio clip|video clip|hour-long video)\b/i,
    ],
  },
  {
    domain: "creative",
    patterns: [
      /\b(?:brainstorm|poem|story|fiction|fictional|character arcs?|worldbuilding|screenplay|song lyrics?|poster|birthday|creative concept|novel|puisi|cerita|fiksi|karakter|skenario)\b/i,
      /\b(?:coffee shop names?|playful|tropical poster|political factions?)\b/i,
    ],
  },
  {
    domain: "dataAnalytics",
    patterns: [
      /\b(?:dataset|datasets|spreadsheet|csv|dataframe|etl|data pipeline|data migration|lembar kerja)\b/i,
      /\b(?:statistics?|statistical|analytics|duplicate rows?|bar chart|monthly totals|average sales|miliar records?|data integrity|analisis data|statistik)\b/i,
    ],
  },
  {
    domain: "mathematicsLogic",
    patterns: [
      /\b(?:math|mathematics|calculate|calculus|algebra|geometry|integral|derivative|equation|theorem|proof|optimization problem|boundary cases?|axioms?|logical system|binary number|decimal|percent|percentage|matematika|hitung|persamaan|teorema|bukti|logika)\b/i,
    ],
  },
  {
    domain: "research",
    patterns: [
      /\b(?:research|literature review|primary sources?|cited paper|publication year|studies|benchmark methodologies?|historical sources?|reproducible protocol|inclusion criteria|evidence synthesis|riset|tinjauan pustaka|sumber primer|makalah)\b/i,
    ],
  },
  {
    domain: "businessStrategy",
    patterns: [
      /\b(?:business|market entry|market-entry|swot|quarter(?:'s)? objectives?|unit economics|build or buy|team meeting|meeting agenda|product strategy|operations strategy|go-to-market|bisnis|strategi pasar|tujuan kuartal|agenda rapat)\b/i,
      /\b(?:decision gates?|technical and financial tradeoffs?|market scenarios?|build-versus-buy)\b/i,
    ],
  },
  {
    domain: "education",
    patterns: [
      /\b(?:teach me|tutor|learner|student|lesson plan|study plan|quiz me|vocabulary questions?|twelve-year-old|beginner study|belajar|ajarkan|murid|siswa|kuis|rencana belajar)\b/i,
      /\b(?:curriculum|semester|theories of learning|kurikulum)\b/i,
      /\b(?:differentiated assessment|guide instruction|learning objective|teaching strategy)\b/i,
    ],
  },
  {
    domain: "scienceEngineering",
    patterns: [
      /\b(?:physics|chemistry|biology|photosynthesis|weather|climate|heat[- ]transfer|experiment|confounders?|control[- ]system|engineering model|replication|scientific|sky appears blue|sains|fisika|kimia|biologi|eksperimen)\b/i,
      /\b(?:multilayer system|validate (?:the )?assumptions?|mitigation strategies?|statistically sound replication)\b/i,
    ],
  },
  {
    domain: "documentWork",
    patterns: [
      /\b(?:pdf|document|report|invoice|meeting notes?|proposal|table of contents|policy documents?|markdown document|word document|slide deck|presentation|contracts?|dokumen|laporan|faktur|notulen|proposal)\b/i,
      /\b(?:proofread this|rewrite this email|extract the invoice|contract paragraph|clause by clause)\b/i,
    ],
  },
  {
    domain: "writingLanguage",
    patterns: [
      /\b(?:write|rewrite|proofread|translate|translation|grammar|tone|subject lines?|newsletter|product description|non-technical audience|follow-up email|announcement|paragraph|copywriting|menulis|tulis|terjemahkan|terjemahan|tata bahasa|nada tulisan)\b/i,
      /\b(?:interviews?|investigative narrative|narrative with citations?)\b/i,
    ],
  },
  {
    domain: "softwareEngineering",
    patterns: [
      /\b(?:code|codebase|repository|repo|project|function|class|method|module|component|api|endpoint|middleware|dto|database|query|schema|plugin|integration|queue|config|environment value|formatter|unit test|ci|deployment|toolchain|source control|commit message|software|kode|repositori|proyek|fungsi|modul|komponen)\b/i,
      /\b(?:refactor|debug|build|compile|deploy|zero-downtime|distributed transaction|runtime|backward compatibility)\b/i,
    ],
  },
  {
    domain: "personalAdvice",
    patterns: [
      /\b(?:personal advice|relationship|career advice|life decision|habit|motivation|should i|what should i do|saran pribadi|hubungan|karier|keputusan hidup|motivasi)\b/i,
    ],
  },
  {
    domain: "generalKnowledge",
    patterns: [
      /^(?:what is|who is|where is|when did|define|explain briefly|apa itu|siapa|di mana|kapan|definisikan)\b/i,
      /\b(?:history of|sejarah|supply and demand|general overview)\b/i,
    ],
  },
];

const COMPLEX_RE =
  /\b(?:root cause|architecture|across (?:all|every|multiple|twelve)|entire|repository-wide|system-wide|cross-platform|cross-domain|microfrontends?|migrate|migration|without (?:breaking|visual|data)|backward compatibility|conflicting|contradictions?|clause by clause|material differences?|billions?|bias|integrity guarantees?|synthesize|nuanced|interlocking|curriculum|competing theories?|reproducible|methodologies?|defend|prove|proof|justify every|constrained optimization|boundary cases?|consistent under|derive|validate (?:the )?assumptions?|confounders?|statistically sound|instability|mitigation strategies?|market-entry|scenarios?|decision gates?|tradeoffs?|potential liability|jurisdictions?|compliance strategy|multiple chronic|compare the risks?|failure sequence|correlate events?|zero-downtime|rollback verification|repeated ci failures|lintas sistem|seluruh|migrasi|akar masalah|kontradiksi|strategi|risiko)\b/i;
const ROUTINE_RE =
  /\b(?:update|change|add|rename|explain|summari[sz]e|rewrite|extract|convert|proofread|translate|create a simple|calculate|define|list|find|brainstorm|write|suggest|draft|sort|remove duplicate|transcribe|describe|generate|basic|briefly|plain language|simple terms|beginner|rapikan|ubah|tambah|jelaskan|ringkas|terjemahkan|buat sederhana|hitung|daftar|cari)\b/i;
const OUTPUT_CONSTRAINT_PATTERNS: readonly RegExp[] = [
  /\b(?:exactly|only|must|without|preserv(?:e|ing)|do not|don't|jangan|tanpa|harus)\b/i,
  /\b(?:bullet points?|paragraphs?|table|json|xml|markdown|diagram|citations?|sources?)\b/i,
  /\b(?:professional|friendly|playful|polite|tone|audience|twelve-year-old|non-technical)\b/i,
  /\b(?:three|five|ten|twelve|every|all)\b/i,
];

const ARTIFACT_RULES: readonly { artifact: RequestArtifact; pattern: RegExp }[] = [
  {
    artifact: "sourceCode",
    pattern:
      /\b(?:code|source code|codebase|repository|repo|project|solution|function|class|method|module|component|api|endpoint|middleware|package|kode|repositori|proyek|fungsi|modul)\b/i,
  },
  {
    artifact: "userInterface",
    pattern:
      /\b(?:ui|ux|user interface|theme|theming|css|tailwind|layout|palette|typography|modal|dashboard|form|tampilan|tema|warna|antarmuka)\b/i,
  },
  {
    artifact: "data",
    pattern:
      /\b(?:dataset|spreadsheet|csv|dataframe|table|rows?|columns?|statistics?|analytics|etl|data pipeline|lembar kerja|statistik)\b/i,
  },
  {
    artifact: "document",
    pattern:
      /\b(?:pdf|document|report|invoice|contract|proposal|markdown|readme|changelog|slide deck|presentation|dokumen|laporan|faktur|kontrak)\b/i,
  },
  {
    artifact: "media",
    pattern:
      /\b(?:images?|screenshots?|photos?|diagrams?|video|audio|voice|ocr|gambar|tangkapan layar|foto|suara)\b/i,
  },
  {
    artifact: "configuration",
    pattern:
      /\b(?:config|configuration|environment variables?|environment values?|settings?|ya?ml|toml|konfigurasi|pengaturan)\b/i,
  },
  {
    artifact: "deployment",
    pattern:
      /\b(?:deploy|deployment|ci|cd|pipeline|release|rollback|production|staging|build artifact|rilis)\b/i,
  },
];

function detectArtifacts(prompt: string): RequestArtifact[] {
  return ARTIFACT_RULES.filter(({ pattern }) => pattern.test(prompt)).map(
    ({ artifact }) => artifact
  );
}

function matchingSignals(prompt: string, rule: DomainRule): string[] {
  return rule.patterns
    .map((pattern, index) => (pattern.test(prompt) ? `domain:${rule.domain}:${index + 1}` : ""))
    .filter(Boolean);
}

function detectDomain(prompt: string): { domain: RequestDomain; signals: string[] } {
  let bestDomain: RequestDomain = "unknown";
  let bestSignals: string[] = [];
  for (const rule of DOMAIN_RULES) {
    const signals = matchingSignals(prompt, rule);
    if (signals.length > bestSignals.length) {
      bestDomain = rule.domain;
      bestSignals = signals;
    }
  }
  return { domain: bestDomain, signals: bestSignals };
}

function detectRisk(prompt: string, domain: RequestDomain): RequestRisk {
  if (
    domain === "medicalHealth" &&
    /\b(?:symptoms?|recommend|treatment|medications?|dosage|patient|procedure|chronic)\b/i.test(
      prompt
    )
  ) {
    return "high";
  }
  if (
    domain === "legal" &&
    /\b(?:liability|jurisdiction|compliance strategy|obligations?)\b/i.test(prompt)
  ) {
    return "high";
  }
  if (
    domain === "finance" &&
    /\b(?:recommend|allocation|retirement|my portfolio|recession scenarios?|personal constraints?)\b/i.test(
      prompt
    )
  ) {
    return "high";
  }
  if (domain === "cybersecurity") return "elevated";
  if (["medicalHealth", "legal", "finance"].includes(domain)) return "elevated";
  return domain === "unknown" ? "unknown" : "routine";
}

/**
 * General-purpose request profiler. It describes domain, hardness, constraints,
 * and risk independently from the legacy intent label and never performs I/O.
 */
export function detectRequestProfile(prompt: string): RequestProfileResult {
  const text = prompt.trim();
  if (!text) {
    return {
      domain: "unknown",
      artifacts: [],
      risk: "unknown",
      complexity: "unknown",
      confidence: 0,
      recognized: false,
      constraintCount: 0,
      roleEvidence: { fastWorker: 0, strongReasoning: 0 },
      signals: ["profile:none"],
      reason: "empty-request",
    };
  }

  const detected = detectDomain(text);
  const artifacts = detectArtifacts(text);
  const recognized = detected.domain !== "unknown";
  const constraintSignals = OUTPUT_CONSTRAINT_PATTERNS.map((pattern, index) =>
    pattern.test(text) ? `constraint:${index + 1}` : ""
  ).filter(Boolean);
  const risk = detectRisk(text, detected.domain);
  const complex = COMPLEX_RE.test(text) || constraintSignals.length >= 3 || risk === "high";
  const routine = ROUTINE_RE.test(text);
  const complexity: RequestProfileComplexity = !recognized
    ? "unknown"
    : complex
      ? "complex"
      : routine || risk === "routine" || risk === "elevated"
        ? "simple"
        : "unknown";

  const roleEvidence = !recognized
    ? { fastWorker: 0, strongReasoning: 0 }
    : complexity === "complex"
      ? { fastWorker: 0.05, strongReasoning: 0.86 }
      : risk === "elevated"
        ? { fastWorker: 0.68, strongReasoning: 0.34 }
        : { fastWorker: 0.76, strongReasoning: 0.08 };
  const confidence = recognized
    ? Math.min(0.96, 0.76 + detected.signals.length * 0.08 + (complex || routine ? 0.04 : 0))
    : 0;

  return {
    domain: detected.domain,
    artifacts,
    risk,
    complexity,
    confidence,
    recognized,
    constraintCount: constraintSignals.length,
    roleEvidence,
    signals: [
      `profile-domain:${detected.domain}`,
      `profile-risk:${risk}`,
      `profile-complexity:${complexity}`,
      ...artifacts.map((artifact) => `artifact:${artifact}`),
      ...detected.signals,
      ...constraintSignals,
    ],
    reason: recognized ? `recognized-${detected.domain}` : "unrecognized-request-profile",
  };
}
