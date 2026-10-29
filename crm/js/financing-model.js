// «جهات التمويل» لحاسبة التمويل العقاري: دوال صافية بلا DOM ولا قاعدة، تستعملها الحاسبة (mortgage.js) وصفحة
// الجهات (financing.js)، ولها tests/financing-model.test.mjs.
//
// التخزين في crm_settings (قراءة لكل من سجّل دخوله، كتابة للمدير):
//   financing_entities  يكتبه المدير:   [{ id, name, url, rate, cap, endAge, maxYears, minDownPct, quote, confirmedAt, dismissedRate, active }]
//   financing_proposals يكتبه المساعد: { [id]: { checkedAt, url, rate?, quote?, candidates?, error? } }
// المساعد يقرأ صفحة كل جهة أسبوعياً (supabase/functions/agent-run/rates.ts) ويقترح، ولا يتغير رقم قبل اعتماد المدير.

import { TERMS } from './mortgage-calc.js';

export const ENTITIES_KEY = 'financing_entities';
export const PROPOSALS_KEY = 'financing_proposals';
export const STALE_DAYS = 30; // رقم لم يُؤكَّد منذ شهر يظهر بتنبيه
const DAY_MS = 86400000;

// قبل أن يضيف المدير أي جهة: متوسط حاسبة «عون» الذي عايرنا عليه الافتراضي (2026-10-29)
export const DEFAULT_ENTITIES = Object.freeze([Object.freeze({
    id: 'own-avg', name: 'متوسط حاسبة عون', url: 'https://own.sa/calculate-morgage/',
    rate: TERMS.rate, cap: TERMS.cap, endAge: TERMS.endAge, maxYears: TERMS.maxYears, minDownPct: TERMS.minDownPct,
    quote: 'معايرة يدوية: لموظف حكومي براتب صافٍ 12,000 أعطت عون قسط 6,189 لتمويل 900,000 على 25 سنة',
    confirmedAt: '2026-10-29', dismissedRate: null, active: true
})]);

const num = (v, min, max) => {
    const x = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(x) || x < min || x > max ? null : x;
};
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v.trim()) ? v.trim() : null);

// قراءة ما في الإعداد بحذر: كل حقل بحدوده، والجهة بلا اسم أو معرّف تسقط. المفتاح غير الموجود: الافتراضي
export function cleanEntities(value) {
    if (!Array.isArray(value)) return DEFAULT_ENTITIES.map((e) => ({ ...e }));
    const seen = new Set();
    const out = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const id = text(raw.id, 40);
        const name = text(raw.name, 80);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id, name,
            url: httpsUrl(raw.url),
            rate: num(raw.rate, 0, 30),
            cap: num(raw.cap, 1, 100) ?? TERMS.cap,
            endAge: num(raw.endAge, 40, 80) ?? TERMS.endAge,
            maxYears: num(raw.maxYears, 1, 40) ?? TERMS.maxYears,
            minDownPct: num(raw.minDownPct, 0, 100) ?? TERMS.minDownPct,
            quote: text(raw.quote, 300),
            confirmedAt: typeof raw.confirmedAt === 'string' && !Number.isNaN(Date.parse(raw.confirmedAt)) ? raw.confirmedAt : null,
            dismissedRate: num(raw.dismissedRate, 0, 30),
            active: raw.active !== false
        });
    }
    return out;
}

export function cleanProposals(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [id, p] of Object.entries(value)) {
        if (!p || typeof p !== 'object' || Number.isNaN(Date.parse(p.checkedAt))) continue;
        out[id] = {
            checkedAt: p.checkedAt,
            url: httpsUrl(p.url),
            rate: num(p.rate, 0, 30),
            quote: text(p.quote, 300),
            candidates: Array.isArray(p.candidates)
                ? p.candidates.map((c) => ({ rate: num(c && c.rate, 0, 30), quote: text(c && c.quote, 300) })).filter((c) => c.rate !== null).slice(0, 6)
                : [],
            error: text(p.error, 300)
        };
    }
    return out;
}

// حال الجهة اليوم: متى أُكّد رقمها آخر مرة، وهل هو قديم، وما ينتظر قرار المدير
export function entityStatus(entity, proposal, now = new Date()) {
    const byAdmin = entity.confirmedAt ? Date.parse(entity.confirmedAt) : null;
    // قراءة المساعد للرقم نفسه من الرابط نفسه تُعدّ تأكيداً، بلا ضغطة من المدير
    const sameRate = Boolean(proposal && proposal.rate !== null && entity.rate !== null && proposal.rate === entity.rate);
    const byAgent = sameRate ? Date.parse(proposal.checkedAt) : null;
    const last = byAdmin === null && byAgent === null ? null : Math.max(byAdmin ?? -Infinity, byAgent ?? -Infinity);
    const lastBy = last === null ? null : (byAgent !== null && byAgent > (byAdmin ?? -Infinity) ? 'agent' : 'admin');
    const daysOld = last === null ? null : Math.floor((now.getTime() - last) / DAY_MS);
    let pending = null;
    if (proposal) {
        if (proposal.rate !== null && proposal.rate !== entity.rate && proposal.rate !== entity.dismissedRate) pending = 'rate';
        else if (proposal.rate === null && proposal.candidates.some((c) => c.rate !== entity.rate && c.rate !== entity.dismissedRate)) pending = 'choose';
        else if (proposal.error) pending = 'error';
    }
    return {
        lastAt: last === null ? null : new Date(last).toISOString(),
        lastBy,
        daysOld,
        stale: entity.rate === null || daysOld === null || daysOld > STALE_DAYS,
        pending,
        sameRate
    };
}

// اعتماد نسبة: من اقتراح المساعد أو يدوياً. التاريخ تاريخ الاعتماد
export function applyRate(entities, id, rate, quote, today) {
    return entities.map((e) => (e.id === id
        ? { ...e, rate: num(rate, 0, 30), quote: text(quote, 300), confirmedAt: today, dismissedRate: null }
        : e));
}

// تجاهل اقتراح: لا يعود الاقتراح نفسه حتى يجد المساعد رقماً آخر
export function dismissRate(entities, id, rate) {
    return entities.map((e) => (e.id === id ? { ...e, dismissedRate: num(rate, 0, 30) } : e));
}

export function upsertEntity(entities, entity) {
    const i = entities.findIndex((e) => e.id === entity.id);
    if (i === -1) return [...entities, entity];
    const next = entities.slice();
    next[i] = entity;
    return next;
}

export function removeEntity(entities, id) {
    return entities.filter((e) => e.id !== id);
}

// معرّف قصير ثابت لجهة جديدة: من الوقت، ولا يتكرر في القائمة
export function newEntityId(entities, nowMs = Date.now()) {
    let id = 'e' + nowMs.toString(36);
    while (entities.some((e) => e.id === id)) id += 'x';
    return id;
}

// شروط الحاسبة من جهة
export function termsOf(entity) {
    return { rate: entity.rate, cap: entity.cap, endAge: entity.endAge, maxYears: entity.maxYears, minDownPct: entity.minDownPct };
}

export function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; }
}
