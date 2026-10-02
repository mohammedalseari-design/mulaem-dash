// اختبارات قائمة أحياء جدة ومطابقتها، بلا شبكة. كل الجمل هنا مصطنعة (المستودع عام).
// التشغيل: deno test supabase/functions/_shared/jev/districts.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  canonicalDistrict, DISTRICTS_VERSION, findDistrictCandidates, JEDDAH_DISTRICTS, MAX_DISTRICT_CANDIDATES,
  normDistrictText,
} from "./districts.ts";

/* ===================== القائمة ===================== */

Deno.test("districts: the list is canonical, unique and of the planned size", () => {
  assert(DISTRICTS_VERSION.length > 0);
  assert(JEDDAH_DISTRICTS.length >= 100 && JEDDAH_DISTRICTS.length <= 180, `size ${JEDDAH_DISTRICTS.length}`);
  const owner = new Map<string, string>();
  for (const { name, aliases } of JEDDAH_DISTRICTS) {
    // الاسم المعتمد بلا «حي»/«مخطط» ولا ترقيم، وبمسافة واحدة
    assertEquals(name, name.trim());
    assert(!/^(حي|مخطط)\s/.test(name) && !/\s{2}/.test(name), name);
    for (const raw of [name, ...aliases]) {
      const form = normDistrictText(raw);
      assert(form.length > 0, raw);
      // لا بديل يكرر اسمه بعد التطبيع، ولا شكل يتقاسمه مدخلان
      assert(!owner.has(form), `${raw} → ${form} already belongs to ${owner.get(form)}`);
      owner.set(form, name);
    }
  }
});

Deno.test("districts: non-districts are not in the list", () => {
  for (const value of ["غير محدد", "جدة", "شمال جدة", "جنوب جدة", "شرق جدة", "جنوب شرق جدة", "وسط جدة"]) {
    assertEquals(canonicalDistrict(value), null, value);
  }
  assertEquals(findDistrictCandidates("شقة للبيع شمال جدة، والسعر قابل للتفاوض"), []);
  assertEquals(findDistrictCandidates("أرض على الكورنيش قريبة من المطار"), []);
});

Deno.test("districts: district values written in the database map to one entry", () => {
  const cases: Array<[string, string]> = [
    ["الروضة", "الروضة"],
    ["ابحر الجنوبية", "أبحر الجنوبية"],
    ["أبحر الجنوبية", "أبحر الجنوبية"],
    ["ابحر", "أبحر"],
    ["سندس", "السندس"],
    ["مخطط سندس", "السندس"],
    ["- درب الحرمين", "درب الحرمين"],
    ["مخطط شمس العروس", "شمس العروس"],
    ["حي المروة", "المروة"],
    ["حي السامر", "السامر"],
    ["الأجواد", "الأجواد"],
    ["الأندلس", "الأندلس"],
    ["جدة هايتس", "جدة هايتس"],
    ["ضاحية الميار", "ضاحية الميار"],
    ["مدينة جدة الاقتصادية", "مدينة جدة الاقتصادية"],
  ];
  for (const [value, name] of cases) assertEquals(canonicalDistrict(value), name, value);
  // القيمة المركّبة ليست حياً واحداً، لكن جزأيها يُستخرجان من النص
  assertEquals(canonicalDistrict("الواحة-سندس"), null);
  assertEquals(findDistrictCandidates("الواحة-سندس"), ["الواحة", "السندس"]);
});

Deno.test("districts: north and south Obhur stay separate; bare «أبحر» is its own entry", () => {
  assertEquals(canonicalDistrict("ابحر الشماليه"), "أبحر الشمالية");
  assertEquals(canonicalDistrict("أبحر الشمالي"), "أبحر الشمالية");
  assertEquals(canonicalDistrict("ابحر الجنوبيه"), "أبحر الجنوبية");
  assertEquals(canonicalDistrict("أبحر"), "أبحر");
  const bare = JEDDAH_DISTRICTS.find((x) => x.name === "أبحر");
  assertEquals(bare?.aliases, []);
});

/* ===================== التطبيع ===================== */

Deno.test("normDistrictText: digits, tashkeel, tatweel, letter forms, invisible marks and spaces", () => {
  assertEquals(normDistrictText("  الرَّوْضَـــة   ٣ "), "الروضه 3");
  assertEquals(normDistrictText("۱۲ النعيم"), "12 النعيم");
  assertEquals(normDistrictText("أبحر إآٱ"), "ابحر ااا");
  assertEquals(normDistrictText("الندى"), "الندي");
  assertEquals(normDistrictText("المروة"), normDistrictText("المروه"));
  assertEquals(normDistrictText("‏الصفا‎"), "الصفا");
  assertEquals(normDistrictText("بني\n\tمالك"), "بني مالك");
  assertEquals(normDistrictText(""), "");
});

Deno.test("normDistrictText: drops a leading «حي »/«مخطط »/punctuation from list entries", () => {
  assertEquals(normDistrictText("- حي المروة"), "المروه");
  assertEquals(normDistrictText("حيّ الصفا"), "الصفا");
  assertEquals(normDistrictText("حي: النزهة،"), "النزهه");
  assertEquals(normDistrictText("مخطط سندس"), "سندس");
  assertEquals(normDistrictText("حي مخطط الفلاح"), "الفلاح");
  // «حي» جزء من كلمة لا يُحذف
  assertEquals(normDistrictText("حيدر"), "حيدر");
  assertEquals(normDistrictText("مخططات"), "مخططات");
});

/* ===================== الاستخراج ===================== */

Deno.test("findDistrictCandidates: «حي المروه» → المروة, and other spellings to the canonical name", () => {
  assertEquals(findDistrictCandidates("شقة للبيع في حي المروه ثلاث غرف"), ["المروة"]);
  assertEquals(findDistrictCandidates("فيلا دوبلكس حى الاجواد"), ["الأجواد"]);
  assertEquals(findDistrictCandidates("عمارة في حي الصفاء على شارعين"), ["الصفا"]);
  assertEquals(findDistrictCandidates("شاليه في الشاطيء"), ["الشاطئ"]);
  assertEquals(findDistrictCandidates("دور أرضي في حي الزهرا"), ["الزهراء"]);
  assertEquals(findDistrictCandidates("أرض في مخطط سندس"), ["السندس"]);
  assertEquals(findDistrictCandidates("أرض في الامير عبدالمجيد"), ["الأمير عبد المجيد"]);
  assertEquals(findDistrictCandidates("مكتب في الرَّوْضَـة"), ["الروضة"]);
  assertEquals(findDistrictCandidates("حي المشرفة"), ["مشرفة"]);
});

Deno.test("findDistrictCandidates: whole words only — «بالسلامة» is not السلامة", () => {
  assertEquals(findDistrictCandidates("الحمد لله على وصولكم بالسلامة"), []);
  assertEquals(findDistrictCandidates("فيلا في السلامة"), ["السلامة"]);
  assertEquals(findDistrictCandidates("*السلامة*، شقة جديدة"), ["السلامة"]);
  assertEquals(findDistrictCandidates("السلامةالروضة"), []);
  // الرياض الحي يطابق، و«بالرياض» الملتصقة لا تطابق
  assertEquals(findDistrictCandidates("شقة بالرياض"), []);
  assertEquals(findDistrictCandidates("شقة في الرياض"), ["الرياض"]);
  // الرقم ليس حرفاً، فلا يكسر الحد
  assertEquals(findDistrictCandidates("مشروع الصفا٢"), ["الصفا"]);
});

Deno.test("findDistrictCandidates: the longest name wins at the same place", () => {
  assertEquals(findDistrictCandidates("أرض في أبحر الشمالية"), ["أبحر الشمالية"]);
  assertEquals(findDistrictCandidates("شاليه في أبحر"), ["أبحر"]);
  assertEquals(findDistrictCandidates("أرض في مخطط جوهرة العروس"), ["جوهرة العروس"]);
  assertEquals(findDistrictCandidates("أرض في جوهرة ثول"), ["جوهرة ثول"]);
  assertEquals(findDistrictCandidates("فيلا في حي الأمير فواز الجنوبي"), ["الأمير فواز الجنوبي"]);
  assertEquals(findDistrictCandidates("فيلا في حي الأمير فواز"), ["الأمير فواز"]);
  assertEquals(findDistrictCandidates("استراحة في أبرق الرغامة"), ["أبرق الرغامة"]);
  assertEquals(findDistrictCandidates("أرض في مخطط الموسى فيو"), ["الموسى فيو"]);
  assertEquals(findDistrictCandidates("أرض في حي الموسى"), ["الموسى فيو"]);
});

Deno.test("findDistrictCandidates: in order of first occurrence (spec §4), each name once — «حي» does not reorder", () => {
  assertEquals(findDistrictCandidates("قريب من الروضة، شقة في حي الصفا"), ["الروضة", "الصفا"]);
  // «حيدر» ليست «حي»
  assertEquals(findDistrictCandidates("قريب من الروضة، مكتب حيدر الصفا"), ["الروضة", "الصفا"]);
  assertEquals(
    findDistrictCandidates("شقق قرب النعيم، المشروع بحي الريان، ويطل على الحي: الشاطئ، ثم النعيم مرة أخرى"),
    ["النعيم", "الريان", "الشاطئ"],
  );
  assertEquals(findDistrictCandidates("📍 *حي* _النزهة_"), ["النزهة"]);
  assertEquals(findDistrictCandidates("الموقع: الفيصلية\nالحي:\nالربوة"), ["الفيصلية", "الربوة"]);
  // ذِكر لاحق للحي نفسه لا يغيّر موضعه
  assertEquals(findDistrictCandidates("بين الروضة و البوادي، وهي في حي البوادي"), ["الروضة", "البوادي"]);
  assertEquals(findDistrictCandidates("قريب من النهضة، وأيضاً حي المرجان، ثم حي النهضة"), ["النهضة", "المرجان"]);
  // «والمروة» ملتصقة بالواو فلا تطابق
  assertEquals(findDistrictCandidates("بين البوادي والمروة"), ["البوادي"]);
});

Deno.test("findDistrictCandidates: at most 12 — the first twelve mentioned", () => {
  const plain = [
    "الروضة", "السلامة", "الصفا", "الريان", "الحمراء", "النزهة", "المروة", "النسيم", "الواحة", "النعيم",
    "الزهراء", "الفيصلية", "الشاطئ", "الفيحاء", "الربوة",
  ];
  const text = "مشاريع في " + plain.join("، ") + "، وأحدثها في حي السامر";
  const got = findDistrictCandidates(text);
  assertEquals(MAX_DISTRICT_CANDIDATES, 12);
  assertEquals(got, plain.slice(0, 12));
  // التكرار لا يُحسب: اثنا عشر حياً مختلفاً
  assertEquals(findDistrictCandidates("الروضة، الروضة، " + plain.slice(1).join("، ")), plain.slice(0, 12));
});

Deno.test("findDistrictCandidates: empty or district-free text", () => {
  assertEquals(findDistrictCandidates(""), []);
  assertEquals(findDistrictCandidates("   \n "), []);
  assertEquals(findDistrictCandidates("صباح الخير يا جماعة، جمعة مباركة"), []);
});
