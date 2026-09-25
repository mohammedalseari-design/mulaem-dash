// اختبار قارئ تصدير واتساب بعينات مصطنعة (لا تُحفظ محادثات حقيقية في المستودع: فيها أرقام أشخاص).
// التشغيل: deno run tests/whatsapp-parse.test.mjs   أو   node tests/whatsapp-parse.test.mjs
import { parseChat, classify, groupFromFileName, normalizeForDedupe } from '../crm/js/whatsapp-parse.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const RLM = '‏', LRE = '‪', PDF = '‬';

// آيفون بالعربية: علامات اتجاه حول التاريخ والأرقام، فاصلة عربية، ص/م
const ios = [
    `[${RLM}1${RLM}/9${RLM}/2026، 8:00:00 ص] شركة تجربة: ${RLM}الرسائل والمكالمات مشفرة تمامًا بين الطرفين.`,
    `${RLM}[${RLM}21${RLM}/9${RLM}/2026، 9:47:45 م] ${LRE}+966 55 000 0001${PDF}: *مشروع الربوة 102*`,
    'شقة غرفتين بسعر ٢٧٩،٠٠٠',
    'شقة ٣ غرف بسعر ٣٣٩،٠٠٠',
    `[${RLM}21${RLM}/9${RLM}/2026، 9:48:01 م] ${LRE}+966 55 000 0001${PDF}: ${RLM}لم يتم إدراج الصورة`,
    `[${RLM}21${RLM}/9${RLM}/2026، 9:49:00 م] ${LRE}+966 55 000 0001${PDF}: *مشروع الربوة 102*\nشقة غرفتين بسعر ٢٧٩،٠٠٠\nشقة ٣ غرف بسعر ٣٣٩،٠٠٠`,
    `[${RLM}21${RLM}/9${RLM}/2026، 10:30:00 م] ${LRE}+966 55 000 0002${PDF}: ${RLM}انضم ${LRE}+966 55 000 0002${PDF} باستخدام رابط المجموعة`,
    `[${RLM}21${RLM}/9${RLM}/2026، 11:00:00 م] ~ وسيط جدة: مطلوب فيلا في أبحر الشمالية`,
    `[${RLM}22${RLM}/9${RLM}/2026، 12:05:00 ص] شركة تجربة: بروشور التحديثات 22-09-2026.pdf • ${RLM}22 صفحة ${RLM}لم يتم إدراج المستند`,
    `[${RLM}22${RLM}/9${RLM}/2026، 12:30:00 م] شركة تجربة: تحديث: تم بيع الوحدة 5 والمتبقي 3 شقق بسعر 450 ألف`
].join('\n');

const r = parseChat(ios);
t('ios: group from encryption line', r.group === 'شركة تجربة', r.group);
t('ios: all messages parsed', r.messages.length === 8, r.messages.length);
t('ios: 9:47:45 م → 21:47:45', r.messages[1].at === '2026-09-21T21:47:45', r.messages[1].at);
t('ios: 12:05 ص → 00:05', r.messages[6].at === '2026-09-22T00:05:00', r.messages[6].at);
t('ios: 12:30 م → 12:30', r.messages[7].at === '2026-09-22T12:30:00', r.messages[7].at);
t('ios: sender without bidi marks', r.messages[1].sender === '+966 55 000 0001', r.messages[1].sender);
t('ios: join line is system', r.messages[4].system === true);
t('ios: "~ " stripped from sender', r.messages[5].sender === 'وسيط جدة', r.messages[5].sender);
t('ios: digits in text kept as written', r.messages[1].text.includes('٢٧٩،٠٠٠'));

const [offer, wanted, doc, update] = r.blocks;
t('blocks: text + image + repeated caption merged into one block', r.blocks.length === 4 && offer.count === 3, r.blocks.map((b) => b.count));
t('blocks: repeated caption not duplicated', offer.text.split('مشروع الربوة 102').length === 2, offer.text);
t('blocks: omitted image flagged', offer.media === true && offer.attachments.length === 0);
t('blocks: offer classified', offer.kind === 'offer', offer.kind);
t('blocks: wanted classified', wanted.kind === 'wanted', wanted.kind);
t('blocks: brochure-only is document', doc.kind === 'document' && doc.documents[0] === 'بروشور التحديثات 22-09-2026.pdf', doc);
t('blocks: update classified', update.kind === 'update', update.kind);

// أندرويد بالإنجليزية: شهر/يوم يُستنتج من يوم أكبر من 12
const android = [
    '9/21/26, 9:47 PM - Broker A: Apartment for sale 3 rooms 140m price 540,000',
    '9/21/26, 9:48 PM - Broker A: IMG-20260921-WA0001.jpg (file attached)',
    '9/22/26, 8:00 AM - Broker B joined using this group\'s invite link'
].join('\n');
const a = parseChat(android, { group: 'Android group', files: ['IMG-20260921-WA0001.jpg'] });
t('android: month/day order detected', a.messages[0].at === '2026-09-21T21:47:00', a.messages[0].at);
t('android: attachment captured', a.blocks[0].attachments[0] === 'IMG-20260921-WA0001.jpg', a.blocks[0]);
t('android: system line without sender', a.messages[2].system === true, a.messages[2]);
t('android: group from options', a.group === 'Android group');

// آيفون مع الوسائط: المرفق موجود في الأرشيف
const withMedia = `[20/9/2026، 10:00:00 ص] وسيط: <مرفق: 00000002-PHOTO-2026-09-20-10-01-00.jpg>`;
const m = parseChat(withMedia, { files: ['00000002-PHOTO-2026-09-20-10-01-00.jpg'] });
t('ios media: attachment kept when present in zip', m.blocks[0].attachments.length === 1, m.blocks[0]);
const m2 = parseChat(withMedia, { files: [] });
t('ios media: attachment dropped when missing from zip', m2.blocks[0].attachments.length === 0 && m2.blocks[0].media === true);

t('classify: price words', classify('فيلا دوبلكس حي الياقوت 2.1 مليون') === 'offer');
t('classify: "prices start from" counts as offer', classify('لامير اليجانس باسعار تبدا من ٥٣٠ الف ريال') === 'offer');
t('classify: greeting is other', classify('صباح الخير يا شباب') === 'other');
t('group from zip name', groupFromFileName('WhatsApp Chat - شركة زود.zip') === 'شركة زود');
t('group from folder name', groupFromFileName('WhatsApp Chat - تحديثات لامير العقارية') === 'تحديثات لامير العقارية');
t('group from bare _chat.txt is empty', groupFromFileName('_chat.txt') === '');
t('dedupe key ignores stars, alef forms, digits script', normalizeForDedupe('*شقة* بسعر ٥٠٠ ألف') === normalizeForDedupe('شقة بسعر 500 الف'));

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
