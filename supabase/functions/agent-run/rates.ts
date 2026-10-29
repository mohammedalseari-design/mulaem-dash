// نسب «جهات التمويل» لحاسبة التمويل العقاري (crm/js/mortgage.js، 2026-10-29): يقرأ المساعد صفحة كل جهة من
// رابطها الرسمي (fetch.ts: باسمه في User-Agent، ويحترم robots.txt) ويستخرج «معدل النسبة السنوي» بقواعد ثابتة
// مع الجملة التي ورد فيها.
//
// لا نموذج هنا عمداً: الرقم يُقتطع من نص الصفحة نفسه، فلا يمكن أن يُختلق، ولا كلفة له. إن وُجدت في الصفحة
// أكثر من نسبة عقارية تُعرض كلها على المدير ليختار. ولا يتغير شيء في الحاسبة قبل أن يعتمد المدير الاقتراح
// (crm/js/financing.js).
//
// التخزين في crm_settings (قراءة لكل من سجّل دخوله، كتابة للمدير، والخادم بمفتاح الخدمة):
//   financing_entities  يكتبه المدير:   [{ id, name, url, rate, cap, endAge, maxYears, minDownPct, confirmedAt, active }]
//   financing_proposals يكتبه المساعد: { [id]: { checkedAt, url, rate?, quote?, candidates?, error? } }
// مفتاحان منفصلان حتى لا يمحو تعديلُ المدير قراءةَ المساعد ولا العكس.
//
// لا قاعدة ولا شبكة هنا: الجلب يُمرَّر من index.ts، فيُختبر كل شيء في rates.test.ts بلا شبكة.
import { LINK_BUDGET_MS, UrlError } from "./fetch.ts";

export const ENTITIES_KEY = "financing_entities";
export const PROPOSALS_KEY = "financing_proposals";
export const STALE_DAYS = 7; // يُعاد فحص الجهة كل أسبوع في دورة المُجدوِل
export const MAX_PER_SWEEP = 2; // في دورة المُجدوِل، بعد الطلبات
export const MAX_ON_DEMAND = 12; // حين يضغط المدير «حدّث من المصادر»
export const MIN_RATE_MS = 20_000; // لا يُبدأ رابط إن بقي أقل من هذا
const MAX_CANDIDATES = 6;
const QUOTE_MAX = 200;

export interface RateCandidate {
  rate: number;
  quote: string;
}

export interface Entity {
  id: string;
  name?: string;
  url?: string | null;
  active?: boolean;
}

export interface Proposal {
  checkedAt: string;
  url: string;
  rate?: number;
  quote?: string;
  candidates?: RateCandidate[];
  error?: string;
}

/* ===================== الاستخراج ===================== */

// الأرقام العربية والفارسية إلى لاتينية، والفاصلة العشرية العربية نقطة، وعلامة ٪ العربية %
function normalize(s: string): string {
  return s.replace(/[٠-٩۰-۹٫٪]/g, (ch) => {
    if (ch === "٫") return ".";
    if (ch === "٪") return "%";
    const code = ch.charCodeAt(0);
    return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
  });
}

// «معدل النسبة السنوي» بصيغه، و«هامش الربح»، وAPR. لا «نسبة الاستقطاع» ولا «نسبة التمويل»
const RATE_WORDS =
  /(معدل\s*(?:ال)?نسب[ةه]\s*(?:ال)?سنوي[ةه]?|(?:ال)?نسب[ةه]\s+(?:ال)?سنوي[ةه]|هامش\s*(?:ال)?ربح|نسب[ةه]\s*(?:ال)?ربح|\bAPR\b|annual\s+percentage\s+rate|profit\s+rate)/i;
const PERCENT = /(\d{1,2}(?:\.\d{1,3})?)\s*%|%\s*(\d{1,2}(?:\.\d{1,3})?)/g;
const HOME_WORDS = /(عقار|سكن|منزل|مسكن|بيت|فيلا|شقة|أرض|\bhome\b|mortgage|real\s*estate|housing)/i;
const OTHER_WORDS = /(شخصي|سيار|بطاق|تأجير|ذهب|\bpersonal\b|\bauto\b|\bcars?\b|\bcards?\b|leasing)/i;

// كل نسبة سنوية في النص مع جملتها: أول رقم بنسبة مئوية بعد العبارة (أو قبلها مباشرة إن لم يأت بعدها)
export function rateCandidates(text: string): RateCandidate[] {
  const out: RateCandidate[] = [];
  const seen = new Set<string>();
  const segments = normalize(text ?? "")
    .split(/\n|(?<=[.!؟?؛;•|])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const seg of segments) {
    const kw = RATE_WORDS.exec(seg);
    if (!kw) continue;
    const after = seg.slice(kw.index + kw[0].length, kw.index + kw[0].length + 90);
    const before = seg.slice(Math.max(0, kw.index - 30), kw.index);
    const num = firstPercent(after) ?? lastPercent(before);
    if (num === null || num < 0.5 || num > 30) continue;
    const start = Math.max(0, kw.index - 60);
    const quote = seg.length <= QUOTE_MAX ? seg : seg.slice(start, start + QUOTE_MAX).trim();
    const key = num.toFixed(3) + "|" + quote;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rate: num, quote });
  }
  return out;
}

function percents(s: string): number[] {
  const list: number[] = [];
  for (const m of s.matchAll(PERCENT)) list.push(Number(m[1] ?? m[2]));
  return list.filter((n) => Number.isFinite(n));
}
const firstPercent = (s: string) => percents(s)[0] ?? null;
const lastPercent = (s: string) => percents(s).at(-1) ?? null;

// نسبة التمويل العقاري من بين المرشحات: تُستبعد جمل التمويل الشخصي والسيارات والبطاقات (إلا إن ذكرت العقار).
// لا تُفضَّل جملة لأنها تذكر «المسكن»: «الوحدات الجاهزة» عقار أيضاً. إن بقيت أكثر من نسبة مختلفة فالاختيار
// للمدير (pick = null)
export function pickHomeRate(cands: RateCandidate[]): { pick: RateCandidate | null; list: RateCandidate[] } {
  const pool = cands.filter((c) => !OTHER_WORDS.test(c.quote) || HOME_WORDS.test(c.quote)).slice(0, MAX_CANDIDATES);
  const distinct = new Set(pool.map((c) => c.rate));
  return { pick: distinct.size === 1 ? pool[0] : null, list: pool };
}

/* ===================== من يُفحص الآن ===================== */

const DAY_MS = 86_400_000;

// الجهات المفعّلة ذات رابط https: كلها حين يطلب المدير، وإلا ما لم يُفحص قط أو تغيّر رابطه أو مضى عليه أسبوع.
// الأقدم فحصاً أولاً
export function dueEntities(
  entities: Entity[], proposals: Record<string, Proposal>, now: Date, opts: { force: boolean; max: number },
): Entity[] {
  const list = (Array.isArray(entities) ? entities : []).filter((e) =>
    e && typeof e.id === "string" && e.id && e.active !== false && typeof e.url === "string" && /^https:\/\//i.test(e.url)
  );
  const checked = (e: Entity) => Date.parse(proposals?.[e.id]?.checkedAt ?? "") || 0;
  const due = opts.force ? list : list.filter((e) => {
    const p = proposals?.[e.id];
    return !p || p.url !== e.url || now.getTime() - checked(e) >= STALE_DAYS * DAY_MS;
  });
  return due.sort((a, b) => checked(a) - checked(b)).slice(0, Math.max(0, opts.max));
}

/* ===================== الفحص ===================== */

export interface RateDeps {
  fetchText: (url: string, budgetMs: number) => Promise<string>; // يرمي UrlError برسالة عربية عند الرفض
  left: () => number; // ما بقي من وقت التشغيل بالميلي ثانية
  now?: () => Date;
}

export async function checkRates(entities: Entity[], deps: RateDeps): Promise<Record<string, Proposal>> {
  const out: Record<string, Proposal> = {};
  const stamp = () => (deps.now ? deps.now() : new Date()).toISOString();
  for (const e of entities) {
    if (deps.left() < MIN_RATE_MS) break;
    const url = String(e.url);
    try {
      const text = await deps.fetchText(url, Math.min(LINK_BUDGET_MS, deps.left()));
      const { pick, list } = pickHomeRate(rateCandidates(text));
      if (pick) out[e.id] = { checkedAt: stamp(), url, rate: pick.rate, quote: pick.quote };
      else if (list.length) out[e.id] = { checkedAt: stamp(), url, candidates: list };
      else out[e.id] = { checkedAt: stamp(), url, error: "لم أجد في الصفحة «معدل النسبة السنوي» برقم واضح — جرّب رابط صفحة المنتج نفسها" };
    } catch (err) {
      const message = err instanceof UrlError && err.message ? err.message : "تعذّرت قراءة الصفحة الآن، وسأعيد المحاولة في الفحص التالي";
      out[e.id] = { checkedAt: stamp(), url, error: message };
    }
  }
  return out;
}

// دمج قراءة هذا التشغيل مع المحفوظ، وحذف اقتراحات جهات حُذفت
export function mergeProposals(
  saved: unknown, found: Record<string, Proposal>, entities: Entity[],
): Record<string, Proposal> {
  const base = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, Proposal> : {};
  const merged: Record<string, Proposal> = { ...base, ...found };
  const ids = new Set((Array.isArray(entities) ? entities : []).map((e) => e?.id));
  for (const key of Object.keys(merged)) if (!ids.has(key)) delete merged[key];
  return merged;
}
