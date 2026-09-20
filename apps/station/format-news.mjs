/**
 * Formatter determinístico de notícias (pt-PT) para o boletim LIVE da IT.FM.
 *
 * Puro: sem rede, sem I/O, sem estado. Recebe itens de RSS já parseados
 * ({ title, description, category, pubDate, source, sourceRank }) e produz um
 * guião curto de "manchetes", pronto para TTS, dividido por âncora (co-locução
 * a duas vozes). Toda a limpeza de HTML/entidades, dedup e seleção vive aqui.
 *
 * O guião é AGNÓSTICO À HORA exata (o mesmo ficheiro toca em várias horas por
 * replay); só usa a parte do dia (manhã/tarde/noite) da geração como saudação.
 *
 * Exporta: cleanItem, fixForTTS, dedupe, selectItems, assembleScript, daypart.
 */

// ---------- entidades HTML ----------
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â", ecirc: "ê", Ecirc: "Ê",
  ocirc: "ô", Ocirc: "Ô", atilde: "ã", Atilde: "Ã", otilde: "õ", Otilde: "Õ",
  ccedil: "ç", Ccedil: "Ç", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  ordf: "ª", ordm: "º", deg: "°", euro: "€", pound: "£", cent: "¢",
  hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", middot: "·",
};

function decodeEntitiesOnce(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m));
}
function safeCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
  try { return String.fromCodePoint(n); } catch { return ""; }
}
// Decodifica duas vezes (várias fontes vêm com entidades duplamente codificadas).
export function decodeEntities(s) {
  const once = decodeEntitiesOnce(s);
  return /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/.test(once) ? decodeEntitiesOnce(once) : once;
}

function stripTags(s) {
  return String(s)
    // remove <img …> e afins primeiro (RTP mete um <img> à cabeça da description)
    .replace(/<\s*(img|figure|figcaption|script|style)[\s\S]*?>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function collapse(s) {
  return String(s).replace(/[ \s]+/g, " ").trim();
}

// Lixo comum de agência/foto/CTA que não deve ser lido no ar.
const JUNK = [
  /\bfoto:?\s*[^.]*\b(lusa|reuters|epa|afp|getty|global imagens|d\.?r\.?)\b[^.]*/gi,
  /\b(lusa|reuters|afp)\b\s*$/i,
  /\bcré?ditos?:?[^.]*/gi,
  /\bleia (também|mais)\b[^.]*/gi,
  /\bsaiba mais\b[^.]*/gi,
  /\bveja (o vídeo|as imagens|a galeria)\b[^.]*/gi,
  /\bclique aqui\b[^.]*/gi,
  /\bsubscreva\b[^.]*/gi,
];

function dejunk(s) {
  let t = s;
  for (const re of JUNK) t = t.replace(re, " ");
  return collapse(t);
}

// Divide em frases respeitando abreviaturas comuns (não corta em "Dr.", "Sr.", etc.).
const ABBR = /\b(sr|sra|dr|dra|prof|eng|ex|av|r|n|art|pág|vol|séc|min|máx|etc|ed|pp|fig|tel|s\.?a|lda)\.$/i;
function splitSentences(s) {
  const out = [];
  const parts = String(s).split(/(?<=[.!?…])\s+/);
  let buf = "";
  for (const p of parts) {
    buf = buf ? `${buf} ${p}` : p;
    const last = buf.split(/\s+/).pop() || "";
    if (ABBR.test(last)) continue; // abreviatura → junta à frase seguinte
    out.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

// Limpa um item de RSS → { title, summary, category, ts, source, sourceRank, hasBody }.
export function cleanItem(raw) {
  const title = collapse(dejunk(decodeEntities(stripTags(raw.title || ""))));
  let body = collapse(dejunk(decodeEntities(stripTags(raw.description || raw.content || ""))));
  // 1–2 frases, teto de ~320 chars.
  const sents = splitSentences(body);
  let summary = "";
  for (const s of sents) {
    const next = summary ? `${summary} ${s}` : s;
    if (next.length > 320 && summary) break;
    summary = next;
    if (sents.indexOf(s) >= 1) break; // no máx 2 frases
  }
  const ts = parseDate(raw.pubDate);
  // corpo "real" = existe e não é só a repetição do título
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const hasBody = !!summary && norm(summary) !== norm(title) && summary.length >= 40;
  return {
    title, summary, hasBody,
    category: collapse(String(raw.category || "")).toLowerCase(),
    ts, source: raw.source || "", sourceRank: raw.sourceRank ?? 99,
  };
}

// Data RFC-822 / ISO → ms epoch (NaN se não parsear). Node interpreta "+0100".
function parseDate(s) {
  if (!s) return NaN;
  const t = Date.parse(String(s).trim());
  return Number.isFinite(t) ? t : NaN;
}

// ---------- dedup por sobreposição de tokens (Jaccard) ----------
// stopwords já SEM acentos (a tokenização remove acentos antes de comparar)
const STOP = new Set(("de que do da em um uma para com nao dos das ao nos nas por mais como mas foi ser tem sua seu seus suas pelo pela entre sobre ate jao ja ou tambem sao esta este esse essa isto isso").split(" "));
function tokenize(s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // tira acentos combinantes
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/s$/, "")); // stem plural leve
}
function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens), b = new Set(bTokens);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Remove duplicados/variações (≥ threshold). Mantém o melhor: corpo real > mais
// recente > melhor fonte (rank menor).
export function dedupe(items, threshold = 0.6) {
  const scored = items.map((it) => ({ it, tok: tokenize(`${it.title} ${it.hasBody ? it.summary : ""}`) }));
  const kept = [];
  const better = (a, b) => {
    if (a.it.hasBody !== b.it.hasBody) return a.it.hasBody ? a : b;
    const at = Number.isFinite(a.it.ts) ? a.it.ts : 0, bt = Number.isFinite(b.it.ts) ? b.it.ts : 0;
    if (at !== bt) return at > bt ? a : b;
    return a.it.sourceRank <= b.it.sourceRank ? a : b;
  };
  for (const cur of scored) {
    let dupIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      if (jaccard(cur.tok, kept[i].tok) >= threshold) { dupIdx = i; break; }
    }
    if (dupIdx === -1) kept.push(cur);
    else kept[dupIdx] = better(kept[dupIdx], cur);
  }
  return kept.map((k) => k.it);
}

// ---------- seleção ----------
export function selectItems(items, { topN = 5, maxPerCategory = 2, recencyHours = 12, nowMs = null } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : maxTs(items);
  const cutoff = now - recencyHours * 3600e3;
  // datados fora da janela caem em prioridade (não são eliminados: fontes sem data valem 0)
  const withScore = items.map((it) => {
    const dated = Number.isFinite(it.ts);
    const fresh = dated ? it.ts >= cutoff : false;
    return { it, dated, fresh };
  });
  withScore.sort((a, b) => {
    if (a.it.hasBody !== b.it.hasBody) return a.it.hasBody ? -1 : 1;
    if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
    const at = a.dated ? a.it.ts : 0, bt = b.dated ? b.it.ts : 0;
    if (at !== bt) return bt - at;
    return a.it.sourceRank - b.it.sourceRank;
  });
  // round-robin por categoria (teto maxPerCategory) para variar temas
  const perCat = new Map();
  const out = [];
  for (const { it } of withScore) {
    const c = it.category || "geral";
    const n = perCat.get(c) || 0;
    if (n >= maxPerCategory) continue;
    perCat.set(c, n + 1);
    out.push(it);
    if (out.length >= topN) break;
  }
  return out;
}
function maxTs(items) {
  let m = 0;
  for (const it of items) if (Number.isFinite(it.ts) && it.ts > m) m = it.ts;
  return m || Date.parse("2000-01-01");
}

// ---------- normalização para fala (pt-PT) ----------
const ABBR_MAP = [
  [/\bkm\/h\b/gi, "quilómetros por hora"],
  [/\bkm\b/gi, "quilómetros"],
  [/\bkg\b/gi, "quilos"],
  [/\bn\.º\b/gi, "número"],
  [/\bn\.o\b/gi, "número"],
  [/\bart\.º\b/gi, "artigo"],
  [/\bp\.?ex\.?\b/gi, "por exemplo"],
  [/\bNATO\b/g, "OTAN"],
];
export function fixForTTS(text) {
  let s = ` ${text} `;
  s = s.replace(/https?:\/\/\S+/gi, " ").replace(/www\.\S+/gi, " ");
  s = s.replace(/\S+@\S+\.\S+/g, " ");           // emails
  s = s.replace(/(^|\s)[@#]\w+/g, " ");           // @handles / #hashtags
  for (const [re, rep] of ABBR_MAP) s = s.replace(re, rep);
  s = s.replace(/(\d)\s*%/g, "$1 por cento");
  s = s.replace(/€\s*(\d)/g, "$1 euros").replace(/(\d)\s*€/g, "$1 euros");
  s = s.replace(/(\d)\s*°\s*C\b/gi, "$1 graus");
  s = s.replace(/(\d)[.](?=\d{3}\b)/g, "$1");     // separador de milhares (ponto) → junta
  s = collapse(s);
  if (s && !/[.!?…]$/.test(s)) s += ".";
  return s;
}

// ---------- guião ----------
export function daypart(hourLisbon) {
  const h = ((hourLisbon % 24) + 24) % 24;
  if (h < 13) return "manha";
  if (h < 20) return "tarde";
  return "noite";
}
const GREETING = { manha: "Bom dia", tarde: "Boa tarde", noite: "Boa noite" };
const OPENERS = [
  (g) => `${g}. Está a ouvir a IT.FM. As manchetes em destaque.`,
  (g) => `${g}. IT.FM, o essencial das notícias.`,
];
const CONNECTORS = ["", "Ainda,", "Por outro lado,", "Entretanto,", "Também em destaque,", "Mais:"];
const CLOSERS = [
  "Foram as notícias da IT.FM. Continuamos com música.",
  "E por aqui ficam as manchetes. Voltamos com mais na IT.FM.",
  "Estas as principais notícias. Segue a música, na IT.FM.",
];

// Constrói o guião co-locução (alterna 2 vozes). Cada item = manchete (título) +,
// se couber no orçamento, a 1.ª frase do corpo. Respeita charBudget (soma de
// caracteres a enviar ao TTS) largando os últimos itens até caber.
//   items: saída de selectItems (ordem = prioridade)
//   opts: { hourLisbon, voiceA, voiceB, charBudget=700, withSummary=false, variant=0 }
// Devolve { segments:[{voice,text}], text, totalChars, count }.
export function assembleScript(items, opts = {}) {
  const { hourLisbon = 9, voiceA = "A", voiceB = "B", charBudget = 700, withSummary = false, variant = 0 } = opts;
  const g = GREETING[daypart(hourLisbon)];
  const opener = OPENERS[variant % OPENERS.length](g);
  const closer = CLOSERS[variant % CLOSERS.length];

  // segmentos candidatos (opener é sempre voz A; itens alternam a partir de A; closer = a outra voz)
  const build = (list) => {
    const segs = [{ voice: voiceA, text: opener }];
    list.forEach((it, i) => {
      const voice = i % 2 === 0 ? voiceA : voiceB;
      const conn = CONNECTORS[i % CONNECTORS.length];
      let body = it.title;
      if (withSummary && it.hasBody) body = `${it.title}. ${it.summary}`;
      const text = fixForTTS(conn ? `${conn} ${body}` : body);
      segs.push({ voice, text });
    });
    const lastVoice = segs[segs.length - 1].voice;
    segs.push({ voice: lastVoice === voiceA ? voiceB : voiceA, text: closer });
    return segs;
  };

  let list = items.slice();
  let segs = build(list);
  const total = (ss) => ss.reduce((n, s) => n + s.text.length, 0);
  while (list.length > 1 && total(segs) > charBudget) {
    list = list.slice(0, -1); // larga o último item
    segs = build(list);
  }
  const text = segs.map((s) => s.text).join("\n");
  return { segments: segs, text, totalChars: total(segs), count: list.length };
}

// ---------- AI script generation (Claude via AWS Bedrock) ----------
// Optional: rewrites raw headlines into a natural, radio-style news script.
// Falls back to assembleScript() on any failure (import missing, API error, parse error).

let _BedrockClient = null;
let _bedrockImportFailed = false;

async function getBedrockClient() {
  if (_BedrockClient) return _BedrockClient;
  if (_bedrockImportFailed) return null;
  try {
    const mod = await import("@anthropic-ai/bedrock-sdk");
    const AnthropicBedrock = mod.default || mod.AnthropicBedrock;
    _BedrockClient = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION || "eu-west-1",
    });
    return _BedrockClient;
  } catch {
    _bedrockImportFailed = true;
    return null;
  }
}

function buildAIPrompt(items, { hourLisbon, charBudget }) {
  const part = daypart(hourLisbon);
  const greet = GREETING[part];
  const headlines = items.map((it, i) => {
    let entry = `${i + 1}. [${it.source}] ${it.title}`;
    if (it.hasBody && it.summary) entry += ` — ${it.summary}`;
    return entry;
  }).join("\n");

  return `Es um argumentista de rádio portuguesa. Escreve um guião de boletim de notícias curto para a estação IT.FM, em português de Portugal (pt-PT), para dois co-apresentadores:
- RUBEN: Ruben Mateus (voz masculina)
- MARIANA: Mariana Serrano (voz feminina)

Parte do dia: ${part} (saudação: "${greet}")

Manchetes disponíveis:
${headlines}

REGRAS:
1. Começa com uma saudação do Ruben: "${greet}, está a ouvir a IT.FM..." (adapta naturalmente)
2. Alterna as notícias entre RUBEN e MARIANA (3-5 manchetes), num estilo conversacional de rádio
3. Usa conectores naturais entre manchetes (entretanto, por outro lado, ainda em destaque...)
4. Termina com um fecho da voz que NÃO leu a última manchete: "Foram as notícias..." ou similar
5. Orçamento MÁXIMO: ~${charBudget} caracteres no total (soma de todo o texto)
6. NÃO inventes factos — usa apenas o que está nas manchetes
7. O texto será lido por TTS, por isso deve soar natural quando falado

FORMATO DE SAÍDA (obrigatório, uma linha por segmento):
[RUBEN] texto do segmento
[MARIANA] texto do segmento
[RUBEN] texto do segmento
...

Responde APENAS com as linhas [RUBEN]/[MARIANA], sem comentários adicionais.`;
}

function parseAIResponse(text, voiceA, voiceB) {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  const segments = [];
  for (const line of lines) {
    const m = line.match(/^\[(?:RUBEN|MARIANA)\]\s*(.+)$/i);
    if (!m) continue;
    const isRuben = /^\[RUBEN\]/i.test(line);
    segments.push({
      voice: isRuben ? voiceA : voiceB,
      text: fixForTTS(m[1].trim()),
    });
  }
  return segments;
}

/**
 * Gera o guião via Claude (AWS Bedrock). Devolve o mesmo formato que assembleScript().
 * Em caso de falha (SDK em falta, erro de API, parse inválido), devolve null.
 *
 *   items: saída de selectItems
 *   opts: { hourLisbon, voiceA, voiceB, charBudget }
 */
export async function assembleScriptAI(items, opts = {}) {
  const { hourLisbon = 9, voiceA = "A", voiceB = "B", charBudget = 700 } = opts;
  const model = process.env.NEWS_AI_MODEL || "anthropic.claude-sonnet-4-20250514";

  const client = await getBedrockClient();
  if (!client) return null;

  const prompt = buildAIPrompt(items, { hourLisbon, charBudget });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const aiText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (!aiText.trim()) return null;

    const segments = parseAIResponse(aiText, voiceA, voiceB);
    if (segments.length < 3) return null; // precisa de pelo menos opener + 1 manchete + closer

    const text = segments.map((s) => s.text).join("\n");
    const totalChars = segments.reduce((n, s) => n + s.text.length, 0);
    // count = segmentos menos opener e closer
    const count = Math.max(1, segments.length - 2);

    return { segments, text, totalChars, count };
  } catch (err) {
    console.warn(`  ! AI script generation failed: ${err.message || err}`);
    return null;
  }
}
