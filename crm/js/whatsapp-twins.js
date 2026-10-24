// منشورات واتساب متشابهة تصف العرض نفسه، تُجمع قبل «إرسال للمساعد» في ‎#/whatsapp‎ — بلا DOM وبلا شبكة، فتُختبر وحدها.
//
// دمج الصفحة (buildItems) يجمع النص المتطابق بعد التوحيد فقط، فالعرض نفسه منشوراً بسطر زائد أو رمز مختلف كان يصير
// طلبات منفصلة: تُدفع لكل منها تكلفة استخراج وحصة من حد الطلبات، وتصير مسودات توائم يرفض المدير بقيتها
// («زود النزهه 103»: 3 رسائل يوم 15 أكتوبر ← 3 مسودات). هنا يُجمع المتشابه بين المحدد للإرسال: يُرسل الأحدث
// طلباً واحداً، ونصوص البقية مصادر إضافية فيه.
//
// متشابهان حين:
//   - كل رقم ذي معنى (3 خانات فأكثر، بعد حذف أرقام الجوال) في صاحب الأرقام الأقل موجود في الآخر: سعر أو مساحة أو
//     رقم مشروع مختلف يعني عرضاً آخر («زود 103» ليس «زود 104»، و«850 ألف» ليس «750 ألف»)؛
//   - وبينهما رقم مشترك واحد على الأقل: قالب الوسيط نفسه بلا أرقام يتغير فيه الحي وحده (كلماته متطابقة إلا كلمة)،
//     والنص المتطابق تماماً دمجته الصفحة قبل هذا؛
//   - والحي واحد إن ذكره الاثنان («حي السامر» و«حي النعيم» عرضان ولو تطابق السعر والمساحة)؛
//   - وكلماتهما متقاربة (Jaccard ‎0.6‎ فأكثر).
// والمجموعة كاملة الربط: يدخلها المنشور إن شابه كل من فيها، فلا يجمع وسيطٌ بلا أرقام عرضين مختلفين في السعر.
// الخطأ هنا أخطر من التفويت: منشور دُمج خطأً لا يصير مسودة، والتوأم الفائت يكشفه فحص التوائم بعد الاستخراج.

import { asciiDigits, cleanLine, normalizeForDedupe } from './whatsapp-parse.js';

export const MIN_CHARS = 30;
export const MIN_WORDS_SHARED = 0.6;

// جوال سعودي بمسافات أو شرطات أو بدونها: 05xxxxxxxx و+9665xxxxxxxx و009665xxxxxxxx
// لا يبدأ بعد رقم: «350000000» سعرٌ وليس جوالاً يبدأ من خانته الثانية
const PHONE = /(^|\D)(?:(?:\+|00)\s*966|966)?[\s-]*0?5(?:[\s-]*\d){8}(?!\d)/g;

// النص بأرقام لاتينية وبلا محارف الاتجاه وبلا أرقام الجوال (project-match.js يستعمله أيضاً)
export function withoutPhones(text) {
    return asciiDigits(cleanLine(text)).replace(PHONE, '$1 ');
}

export function shapeOf(text) {
    const norm = normalizeForDedupe(withoutPhones(text));
    const tokens = norm.split(' ').filter(Boolean);
    return {
        size: norm.length,
        words: new Set(tokens.filter((t) => t.length >= 2 && !/^\d+$/.test(t))),
        numbers: new Set(tokens.filter((t) => /^\d{3,}$/.test(t))),
        // الكلمة بعد «حي» أو «بحي» بلا «ال»: «حي السامر» = «بحي سامر»
        districts: new Set(tokens.flatMap((t, i) => (t === 'حي' || t === 'بحي') && tokens[i + 1] ? [tokens[i + 1].replace(/^ال/, '')] : []))
    };
}

function jaccard(a, b) {
    if (!a.size && !b.size) return 0;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared += 1;
    return shared / (a.size + b.size - shared);
}

export function similar(a, b) {
    if (a.size < MIN_CHARS || b.size < MIN_CHARS) return false;
    const [few, many] = a.numbers.size <= b.numbers.size ? [a, b] : [b, a];
    if (!few.numbers.size) return false;
    for (const n of few.numbers) if (!many.numbers.has(n)) return false;
    if (a.districts.size && b.districts.size && ![...a.districts].some((d) => b.districts.has(d))) return false;
    return jaccard(a.words, b.words) >= MIN_WORDS_SHARED;
}

// items بترتيب الإرسال ← مجموعات بالترتيب نفسه (موضع أول عضو). textOf(item) نص المنشور، وnewer(a, b) أحدث الاثنين:
// [{ main: الأحدث, others: البقية بترتيبها }]. منشور لا يشبه شيئاً مجموعةٌ وحده بلا others
export function twinGroups(items, textOf, newer) {
    const groups = [];
    for (const item of items || []) {
        const shape = shapeOf(textOf(item));
        const home = groups.find((g) => g.shapes.every((s) => similar(s, shape)));
        if (home) {
            home.members.push(item);
            home.shapes.push(shape);
        } else {
            groups.push({ members: [item], shapes: [shape] });
        }
    }
    return groups.map((g) => {
        const main = g.members.reduce((best, item) => (newer(item, best) ? item : best));
        return { main, others: g.members.filter((item) => item !== main) };
    });
}
