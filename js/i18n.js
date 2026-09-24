// js/i18n.js

const TRANSLATIONS = {
  en: {
    admin_panel: "Admin",
    auth_tagline: "Your high-integrity productivity & incentive treasury.",
    username: "Username",
    password: "Password",
    log_in: "Log In",
    no_account_notice: "Don't have an account?",
    signup_via_taskitator: "Sign up on Taskitator to get started →",
    current_rank: "Rank",
    streak: "Streak",
    next_rank: "Next:",
    spendable_balance: "Spendable Balance",
    live_challenges: "Live Challenges",
    view_all: "View All",
    recent_activity: "Recent Activity (Last 15)",
    no_activity: "No recent activity recorded.",
    filter_labels: "Filter Rule Labels",
    select_all: "Select All",
    addition_rules: "Point Additions",
    deduction_rules: "Point Deductions",
    balance: "Balance:",
    inventory: "Inventory",
    back_to_store: "Back to Store",
    my_inventory: "My Inventory",
    challenges_hub: "Challenges Hub",
    history: "History",
    new_challenge: "+ New",
    active_challenges: "Live Active Challenges",
    saved_challenges: "Created Challenges",
    back_to_challenges: "Back",
    challenge_history: "Resolved Challenges (Last 25)",
    back: "Back",
    rank_tiers: "Rank & Streak Tiers",
    streak_multipliers: "Streak Multipliers",
    xp_ranks: "13 XP Progression Tiers",
    language: "Language / اللغة",
    link_taskitator: "Link with Taskitator",
    taskitator_desc: "When enabled, verified task completions award XP & Banch directly to Mr.Study.",
    withdrawal_penalty: "Challenge Withdrawal Penalty (%)",
    save: "Save",
    penalty_help: "Deducted from entry cost refund when abandoning an active challenge.",
    manage_rules: "Manage Rules",
    manage_labels: "Manage Rule & Action Labels",
    manage_store: "Manage Store Rewards",
    log_out: "Log Out",
    admin_console: "Admin Console",
    nav_dash: "Dashboard",
    nav_actions: "Actions",
    nav_store: "Store",
    nav_challenges: "Challenges",
    nav_setup: "Setup",
    undo: "Undo",
    use: "Use",
    buy: "Buy",
    start: "Start",
    withdraw: "Withdraw",
    complete: "Complete",
    failed: "Failed",
    abandoned: "Abandoned",
    points: "Points",
    range: "Range"
  },
  ar: {
    admin_panel: "الإدارة",
    auth_tagline: "خزينة الإنتاجية والمكافآت الذاتية عالية النزاهة.",
    username: "اسم المستخدم",
    password: "كلمة المرور",
    log_in: "تسجيل الدخول",
    no_account_notice: "ليس لديك حساب؟",
    signup_via_taskitator: "سجل عبر Taskitator للبدء ←",
    current_rank: "الرتبة",
    streak: "الحماس اليومي",
    next_rank: "المستوى التالي:",
    spendable_balance: "الرصيد القابل للصرف",
    live_challenges: "التحديات النشطة",
    view_all: "عرض الكل",
    recent_activity: "النشاط الأخير (آخر 15)",
    no_activity: "لا يوجد نشاط مسجل مؤخراً.",
    filter_labels: "تصفية تصنيفات القواعد",
    select_all: "تحديد الكل",
    addition_rules: "قواعد إضافة النقاط",
    deduction_rules: "قواعد خصم النقاط",
    balance: "الرصيد:",
    inventory: "المخزون",
    back_to_store: "العودة للمتجر",
    my_inventory: "مخزوني",
    challenges_hub: "مركز التحديات",
    history: "السجل",
    new_challenge: "+ تحدٍ جديد",
    active_challenges: "التحديات النشطة حالياً",
    saved_challenges: "التحديات المنشأة",
    back_to_challenges: "رجوع",
    challenge_history: "سجل التحديات المنتهية (آخر 25)",
    back: "رجوع",
    rank_tiers: "الرتب ومضاعفات الحماس",
    streak_multipliers: "مضاعفات الحماس اليومي",
    xp_ranks: "مستويات الخبرة الـ 13",
    language: "اللغة / Language",
    link_taskitator: "الربط مع Taskitator",
    taskitator_desc: "عند التفعيل، تُضاف نقاط XP و Banch مباشرة عند إكمال المهام المعتمدة في Taskitator.",
    withdrawal_penalty: "غرامة الانسحاب من التحدي (%)",
    save: "حفظ",
    penalty_help: "تُخصم من رسوم الدخول المستردة في حال الانسحاب من تحدٍ جارٍ.",
    manage_rules: "إدارة القواعد",
    manage_labels: "إدارة تصنيفات القواعد والإجراءات",
    manage_store: "إدارة مكافآت المتجر",
    log_out: "تسجيل الخروج",
    admin_console: "لوحة تحكم المسؤول",
    nav_dash: "الرئيسية",
    nav_actions: "الإجراءات",
    nav_store: "المتجر",
    nav_challenges: "التحديات",
    nav_setup: "الإعدادات",
    undo: "تراجع",
    use: "استخدام",
    buy: "شراء",
    start: "بدء",
    withdraw: "انسحاب",
    complete: "إكمال",
    failed: "فاشل",
    abandoned: "منسحب",
    points: "نقاط",
    range: "النطاق"
  }
};

let currentLang = 'en';

// Apply translation strings in-place without changing layout order
function setLanguage(lang) {
  if (!['en', 'ar'].includes(lang)) return;
  currentLang = lang;
  document.body.setAttribute('data-lang', lang);

  // Update static elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) {
      el.textContent = TRANSLATIONS[lang][key];
    }
  });

  // Toggle active styling on language buttons in Setup view
  const btnEn = document.getElementById('btn-lang-en');
  const btnAr = document.getElementById('btn-lang-ar');
  if (btnEn && btnAr) {
    if (lang === 'en') {
      btnEn.classList.add('active');
      btnAr.classList.remove('active');
    } else {
      btnAr.classList.add('active');
      btnEn.classList.remove('active');
    }
  }

  // Persist preference to user record if authenticated
  if (currentUser) {
    currentUser.lang_pref = lang;
    openDB().then(db => {
      const tx = db.transaction('users', 'readwrite');
      tx.objectStore('users').put(currentUser);
    });
  }
}

function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) ? TRANSLATIONS[currentLang][key] : key;
}

// Attach listener to Setup language toggles
document.addEventListener('DOMContentLoaded', () => {
  const btnEn = document.getElementById('btn-lang-en');
  const btnAr = document.getElementById('btn-lang-ar');

  if (btnEn) {
    btnEn.addEventListener('click', () => setLanguage('en'));
  }
  if (btnAr) {
    btnAr.addEventListener('click', () => setLanguage('ar'));
  }

  // Restore preferred language once session is verified
  setTimeout(() => {
    if (currentUser && currentUser.lang_pref) {
      setLanguage(currentUser.lang_pref);
    } else {
      setLanguage('en');
    }
  }, 100);
});
