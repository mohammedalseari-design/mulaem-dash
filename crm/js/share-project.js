// «مشاركة مع عميل» من صفحة العقار (‎#/project/:id‎، project.js). نسخة مؤقتة: نافذة المشاركة الفعلية تكتبها ميزة المشاركة،
// وتحل محل هذا الملف بالتوقيع نفسه: openShareSheet(project) وproject صف المشروع كما قرأته الصفحة.

import { notify } from './ui.js';

export function openShareSheet(project) { /* filled by the sharing feature */ notify('المشاركة قيد الإعداد', 'info'); }
// علامة النسخة المؤقتة: صفحة العقار لا ترسم زر المشاركة ما دامت المشاركة الفعلية لم تُنشر بعد
openShareSheet.stub = true;
