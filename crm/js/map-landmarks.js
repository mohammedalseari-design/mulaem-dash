// معالم جدة على «خريطة المشاريع» (map.js): أماكن يعرفها الناس ويصفون بها موقع المشروع («قرب ردسي مول»)، تظهر بحبّة «المعالم»
// وتملأ «بالقرب من المشروع» في بطاقته. بيانات ثابتة بلا شبكة، يختبرها tests/map-model.test.mjs.
//
// المصدر: OpenStreetMap — © OpenStreetMap contributors، برخصة ODbL (وحقوقها ظاهرة أسفل الخريطة نفسها).
// أُخذت في 2026-11-11 من Overpass API (استعلام واحد على مربع جدة) ومن Nominatim لما لم يظهر فيه، بطلب في الثانية على الأكثر:
// نقطة العنصر، أو مركز شكله للمباني والمساحات (out center). لكل معلم معرّف عنصره (osm: node/… أو way/… أو relation/…).
// التحقق: كل عنصر من النوع الصحيح في الخريطة (amenity=hospital، shop=mall، amenity=university، aeroway=aerodrome،
// railway=station، landuse=harbour، leisure=stadium، أو المعلم نفسه) وداخل جدة، وما له وسم wikidata قورن بإحداثيات ويكي بيانات:
// الفرق دون 0.7 كم، عدا مساحات كبيرة يختلف مركزها (البلد 1.6 كم، والمطار 2.8 كم). ما لا يوجد في الخريطة باسمه لم يُضف
// (المستشفى السعودي الألماني، وجامعة الأعمال والتكنولوجيا، واستاد الأمير عبدالله الفيصل): لا إحداثيات مخمَّنة.
// الاسم العربي من الخريطة، وإلا الاسم المعروف بالعربية لما لا يحمل فيها إلا اسماً إنجليزياً.

export const LANDMARK_CATEGORIES = {
    sight: { label: 'معالم وسياحة', one: 'معلم' },
    mall: { label: 'مولات', one: 'مول تجاري' },
    hospital: { label: 'مستشفيات', one: 'مستشفى' },
    university: { label: 'جامعات', one: 'جامعة' },
    transport: { label: 'مواصلات', one: 'مواصلات' },
    sport: { label: 'رياضة', one: 'منشأة رياضية' }
};

const L = (category, name, en, lat, lng, osm) => Object.freeze({ category, name, en, lat, lng, osm });

export const LANDMARKS = Object.freeze([
    /* معالم وسياحة */
    L('sight', 'نافورة الملك فهد', "King Fahd's Fountain", 21.51566, 39.145046, 'node/3098654094'),
    L('sight', 'جدة التاريخية (البلد)', 'Historic Jeddah (Al-Balad)', 21.486522, 39.184553, 'way/1192695373'),
    L('sight', 'واجهة روشن البحرية', 'ROSHN Waterfront', 21.598924, 39.10638, 'way/627246744'),
    L('sight', 'الكورنيش الأوسط', 'Middle Corniche Park', 21.523624, 39.154148, 'way/628514686'),
    L('sight', 'مسجد الرحمة', 'Al Rahma Mosque', 21.648714, 39.100826, 'node/539501874'),
    L('sight', 'برج جدة', 'Jeddah Tower', 21.734116, 39.082942, 'way/312055706'),
    L('sight', 'سارية جدة', 'Jeddah Flagpole', 21.507867, 39.169708, 'node/10587992385'),
    L('sight', 'بيت نصيف', 'Naseef House', 21.483964, 39.187668, 'node/2520141053'),
    L('sight', 'باب مكة', 'Bab Makkah', 21.485255, 39.192703, 'way/1159257405'),
    L('sight', 'قصر خزام', 'Khuzam Palace (Regional Museum)', 21.473232, 39.206337, 'way/40604100'),
    L('sight', 'مسجد الملك سعود', 'King Saud Mosque', 21.521858, 39.182491, 'way/41442321'),
    L('sight', 'تيم لاب بوليدرس جدة', 'teamLab Borderless Jeddah', 21.494804, 39.183248, 'way/1474077583'),
    L('sight', 'حوض فقيه للأحياء المائية', 'Fakieh Aquarium', 21.572294, 39.109367, 'node/2891554426'),
    L('sight', 'ملاهي الشلال', 'Al Shallal Theme Park', 21.567334, 39.111214, 'way/1451954528'),
    /* مولات */
    L('mall', 'ردسي مول', 'Red Sea Mall', 21.627725, 39.111002, 'way/111645517'),
    L('mall', 'مول العرب', 'Mall of Arabia', 21.632634, 39.156071, 'way/44213515'),
    L('mall', 'الأندلس مول', 'Al-Andalus Mall', 21.506953, 39.218133, 'way/194983990'),
    L('mall', 'صيرفي ميقا مول', 'Serafi Megamall', 21.560785, 39.185364, 'way/44536024'),
    L('mall', 'ستارز أفنيو مول', 'Stars Avenue Mall', 21.57358, 39.128826, 'way/53202643'),
    L('mall', 'جدة بارك', 'Jeddah Park', 21.556185, 39.184791, 'way/1316609645'),
    L('mall', 'السلام مول', 'Al Salaam Mall', 21.507274, 39.223132, 'way/219243591'),
    L('mall', 'عزيز مول', 'Aziz Mall', 21.576181, 39.196676, 'way/961659291'),
    L('mall', 'سينومي يو ووك', 'Cenomi U Walk', 21.582833, 39.14091, 'way/1346932342'),
    L('mall', 'سوق حراء الدولي', "Hera'a International Mall", 21.615325, 39.153258, 'way/41447463'),
    L('mall', 'روشان مول', 'Roshan Mall', 21.666028, 39.109086, 'way/111645503'),
    L('mall', 'الياسمين مول', 'Al Yasmin Mall', 21.593528, 39.228814, 'way/961659639'),
    /* مستشفيات */
    L('hospital', 'مستشفى الملك فيصل التخصصي', 'King Faisal Specialist Hospital', 21.558881, 39.148474, 'way/285483832'),
    L('hospital', 'مستشفى الملك فهد العام', 'King Fahad General Hospital', 21.543494, 39.166893, 'way/162226479'),
    L('hospital', 'المركز الطبي الدولي', 'International Medical Center', 21.513724, 39.174666, 'way/157407184'),
    L('hospital', 'مستشفى د. سليمان فقيه', 'Dr. Soliman Fakeeh Hospital', 21.525656, 39.167851, 'node/1497744277'),
    L('hospital', 'مستشفى جامعة الملك عبدالعزيز', 'King Abdulaziz University Hospital', 21.496623, 39.234752, 'node/11871636163'),
    L('hospital', 'الشؤون الصحية بالحرس الوطني', 'National Guard Health Affairs', 21.536951, 39.224397, 'way/1195196003'),
    L('hospital', 'مستشفى الملك فهد للقوات المسلحة', 'King Fahad Armed Forces Hospital', 21.542271, 39.126197, 'way/1102940203'),
    L('hospital', 'مستشفى بقشان', 'Bugshan Hospital', 21.557336, 39.176229, 'way/1159296891'),
    L('hospital', 'مستشفى د. عرفان', 'Dr. Erfan Hospital', 21.576128, 39.179017, 'node/4340873693'),
    L('hospital', 'مستشفى شرق جدة', 'East Jeddah Hospital', 21.508532, 39.241732, 'way/407175629'),
    L('hospital', 'مستشفى الملك عبدالعزيز', 'King Abdulaziz Hospital', 21.443316, 39.206581, 'way/1079728705'),
    /* جامعات */
    L('university', 'جامعة الملك عبدالعزيز', 'King Abdulaziz University', 21.493301, 39.247101, 'way/1072356349'),
    L('university', 'جامعة عفت', 'Effat University', 21.478953, 39.211444, 'way/358386285'),
    L('university', 'جامعة دار الحكمة', 'Dar Al-Hekma University', 21.490344, 39.231208, 'way/358386965'),
    L('university', 'جامعة جدة', 'University of Jeddah', 21.903359, 39.261819, 'way/1519983205'),
    L('university', 'الجامعة العربية المفتوحة', 'Arab Open University', 21.592771, 39.145445, 'way/701415371'),
    /* مواصلات */
    L('transport', 'مطار الملك عبدالعزيز الدولي', 'King Abdulaziz International Airport', 21.684673, 39.161508, 'relation/4049921'),
    L('transport', 'محطة قطار الحرمين (السليمانية)', 'Haramain Railway Station (Al-Sulaimaniyah)', 21.516603, 39.245256, 'way/485762503'),
    L('transport', 'محطة قطار الحرمين (المطار)', 'Haramain Railway Station (Airport)', 21.658524, 39.17463, 'way/550729660'),
    L('transport', 'ميناء جدة الإسلامي', 'Jeddah Islamic Port', 21.469235, 39.167981, 'way/167320718'),
    /* رياضة */
    L('sport', 'مدينة الملك عبدالله الرياضية', 'King Abdullah Sports City', 21.763223, 39.164273, 'way/292395768')
]);
