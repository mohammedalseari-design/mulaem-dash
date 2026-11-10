// تحويل العميل لوسيط وحذفه: للمدير وحده (قرار المالك 2026-11-10، «الحذف فقط للمدير»).
//
// الزران لا يظهران لغير المدير، والقاعدة ترفض غيره في transfer_client وdelete_client (043) مهما أرسلت الصفحة.
// التحويل في معاملة واحدة على الخادم: العميل وطلباته ومتابعاته المفتوحة وصفقاته الجارية. الحذف يرفض عميلاً له صفقة.

import { supabase } from './supabase.js';
import { fieldStaff, resetStaff } from './data.js';
import { el, field, select, openModal, closeModal, notify, fail, loading, replace } from './ui.js';
import {
    transferNote, transferTitle, transferDoneText, deleteBlocked, deleteBlockedText, deleteWarnText, deleteDoneText,
    isHasDealsError, isMissingFunction, NOT_READY_TEXT
} from './client-admin-model.js';

const cancelBtn = (text = 'إلغاء') => el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: text, onclick: closeModal });

export async function openTransferClient(client, onDone) {
    // غير مسند: «إسناد» لا «تحويل»، والوسيط الذي أدخله (إن كان وسيطاً) هو من يخرج منه
    const assigning = !client.owner_id;
    const title = transferTitle(assigning);
    const verb = assigning ? 'إسناد' : 'تحويل';
    let activeBrokers;
    try {
        // من جديد: وسيط أُضيف أو عُطّل في الجلسة نفسها يظهر كما هو الآن
        resetStaff();
        activeBrokers = await fieldStaff();
    } catch (error) {
        return fail(error, 'تعذّر تحميل الوسطاء');
    }

    const brokers = activeBrokers.filter((p) => p.id !== client.owner_id);
    // الوسطاء النشطون فقط في القائمة: أدخله وسيط معطّل أو مركز الاتصال = لا يخرج منه أحد يعمل
    const addedByBroker = assigning && activeBrokers.some((p) => p.id === client.created_by);

    if (!brokers.length) {
        openModal(title, [
            el('p', { text: (assigning ? 'لا يوجد وسيط نشط يُسنَد إليه العميل.' : 'لا يوجد وسيط آخر نشط يُحوَّل إليه العميل.')
                + ' أضف الوسيط أولاً من «المستخدمون» في «الإدارة».' }),
            el('div', { class: 'btn-row btn-row-end' }, [cancelBtn('إغلاق')])
        ], { narrow: true });
        return;
    }

    const options = brokers.map((p) => ({ value: p.id, label: p.fullname || p.username }));
    const target = select([{ value: '', label: 'اختر الوسيط' }].concat(options), '');
    const go = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: verb });
    const form = el('form', { class: 'client-transfer' }, [
        el('p', { text: (assigning ? 'لمن يُسنَد ' : 'إلى من ينتقل ') + client.full_name + '؟' }),
        field(assigning ? 'الوسيط' : 'الوسيط الجديد', target, { required: true }),
        el('p', { class: 'hint', text: transferNote(assigning, addedByBroker) }),
        el('div', { class: 'btn-row btn-row-end' }, [cancelBtn(), go])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!target.value) return void notify('اختر الوسيط الذي ينتقل إليه العميل', 'error');
        go.disabled = true;
        go.textContent = assigning ? 'جارٍ الإسناد…' : 'جارٍ التحويل…';
        const { data, error } = await supabase.rpc('transfer_client', { p_client: client.id, p_to: target.value });
        if (error) {
            go.disabled = false;
            go.textContent = verb;
            if (isMissingFunction(error)) return void notify(NOT_READY_TEXT, 'error', 8000);
            return void fail(error, assigning ? 'تعذّر إسناد العميل' : 'تعذّر تحويل العميل');
        }
        const broker = options.find((o) => o.value === target.value);
        closeModal();
        notify(transferDoneText(client.full_name, broker ? broker.label : '', data, assigning), 'success', 8000);
        if (onDone) onDone();
    });

    openModal(title, form, { narrow: true });
}

// عدّ ما يُحذف معه قبل السؤال: المدير يرى كل الصفوف، فالعدّ صحيح
async function countFor(client) {
    const head = (table) => supabase.from(table).select('id', { count: 'exact', head: true }).eq('client_id', client.id);
    const [deals, requirements, followUps] = await Promise.all([head('deals'), head('client_requirements'), head('follow_ups')]);
    const error = deals.error || requirements.error || followUps.error;
    if (error) throw error;
    return { deals: deals.count || 0, requirements: requirements.count || 0, follow_ups: followUps.count || 0 };
}

export async function openDeleteClient(client) {
    const body = el('div', {}, loading());
    openModal('حذف العميل', body, { narrow: true });

    let counts;
    try {
        counts = await countFor(client);
    } catch (error) {
        closeModal();
        return fail(error, 'تعذّر التحقق من بيانات العميل');
    }
    if (!body.isConnected) return;

    if (deleteBlocked(counts)) {
        replace(body, [
            el('p', { text: deleteBlockedText(client.full_name, counts.deals) }),
            el('div', { class: 'btn-row btn-row-end' }, [cancelBtn('إغلاق')])
        ]);
        return;
    }

    const go = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'حذف نهائي' });
    go.addEventListener('click', async () => {
        go.disabled = true;
        go.textContent = 'جارٍ الحذف…';
        const { error } = await supabase.rpc('delete_client', { p_client: client.id });
        if (error) {
            go.disabled = false;
            go.textContent = 'حذف نهائي';
            if (isHasDealsError(error)) {
                // الزر الذي كان عليه التركيز اختفى: ينتقل التركيز إلى «إغلاق»
                const close = cancelBtn('إغلاق');
                replace(body, [
                    el('p', { text: deleteBlockedText(client.full_name, null) }),
                    el('div', { class: 'btn-row btn-row-end' }, [close])
                ]);
                return void close.focus();
            }
            if (isMissingFunction(error)) return void notify(NOT_READY_TEXT, 'error', 8000);
            return void fail(error, 'تعذّر حذف العميل');
        }
        closeModal();
        notify(deleteDoneText(client.full_name), 'success', 6000);
        location.hash = '#/clients';
    });

    replace(body, [
        el('p', { text: deleteWarnText(client.full_name, counts) }),
        el('div', { class: 'btn-row btn-row-end' }, [cancelBtn(), go])
    ]);
}
