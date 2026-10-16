const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Default initial data for Smart Digital Group
const defaultData = {
  settings: {
    companyName: "Smart Digital Group",
    currency: "₸",
    defaultOverheadPercent: 15,
    roles: [
      { id: "ai", name: "AI Automation / Vibe Coder", defaultRate: 12000 },
      { id: "dev", name: "Backend & Integrator", defaultRate: 14000 },
      { id: "pm", name: "Project Manager / Analyst", defaultRate: 9000 },
      { id: "qa", name: "UI/UX & QA", defaultRate: 8000 }
    ]
  },
  leads: [
    {
      id: "lead-1",
      title: "AI Ассистент и интеграция с CRM",
      company: "Astana Logistics Group",
      contactName: "Ерлан Садыков",
      phone: "+7 701 555 12 34",
      stage: "kp", // lead, contact, meeting, kp, deal, contract
      budget: 6800000,
      direction: "ai",
      notes: "Нужен бот в Telegram и WhatsApp с базой знаний и авто-квалификацией",
      createdAt: "2026-10-10"
    },
    {
      id: "lead-2",
      title: "Сквозная аналитика и n8n воронка",
      company: "SilkWay Retail",
      contactName: "Алина Ким",
      phone: "+7 777 222 33 44",
      stage: "meeting",
      budget: 4200000,
      direction: "web",
      notes: "Интеграция AmoCRM + 1C + складской учет",
      createdAt: "2026-10-12"
    },
    {
      id: "lead-3",
      title: "B2B Портал для дилеров",
      company: "TechnoTrade KZ",
      contactName: "Мурат Беков",
      phone: "+7 705 999 88 77",
      stage: "contract",
      budget: 9500000,
      direction: "web",
      notes: "Договор на финальном согласовании у юристов",
      createdAt: "2026-10-05"
    },
    {
      id: "lead-4",
      title: "Лидогенерация и Performance-маркетинг",
      company: "Almaty Clinic",
      contactName: "Жанна Нурланова",
      phone: "+7 702 111 44 55",
      stage: "lead",
      budget: 2500000,
      direction: "marketing",
      notes: "Заявка с сайта на комплексное продвижение",
      createdAt: "2026-10-15"
    }
  ],
  projects: [
    {
      id: "prj-1",
      title: "Kaspi B2B AI Assistant",
      client: "FinTech Solutions LLP",
      direction: "ai", // ai, web, marketing
      price: 7800000,
      paidAmount: 7800000,
      planHours: 120,
      hoursBreakdown: { ai: 55, dev: 35, pm: 18, qa: 0 },
      directOtherCosts: 450000, // API, servers, subcontracts
      overheadPercent: 15,
      status: "active", // active, completed, on_hold
      timelogs: [
        { date: "2026-10-02", role: "ai", hours: 55, rate: 12000, note: "Промпт-инжиниринг и RAG" },
        { date: "2026-10-05", role: "dev", hours: 35, rate: 14000, note: "Интеграция API Kaspi" },
        { date: "2026-10-08", role: "pm", hours: 18, rate: 9000, note: "Тестирование и сдача спринта" }
      ]
    },
    {
      id: "prj-2",
      title: "E-commerce SuperApp",
      client: "Retail Group KZ",
      direction: "web",
      price: 11200000,
      paidAmount: 9100000,
      planHours: 180,
      hoursBreakdown: { ai: 40, dev: 110, pm: 44, qa: 40 },
      directOtherCosts: 950000,
      overheadPercent: 15,
      status: "active",
      timelogs: [
        { date: "2026-09-20", role: "dev", hours: 110, rate: 14000, note: "Сложная архитектура каталога" },
        { date: "2026-09-25", role: "ai", hours: 40, rate: 12000, note: "AI-рекомендации товаров" },
        { date: "2026-10-01", role: "pm", hours: 44, rate: 9000, note: "Бесконечные согласования правок" },
        { date: "2026-10-05", role: "qa", hours: 40, rate: 8000, note: "Нагрузочное тестирование" }
      ]
    },
    {
      id: "prj-3",
      title: "HR & Payroll Portal",
      client: "Logistics Central Asia",
      direction: "web",
      price: 5500000,
      paidAmount: 2750000,
      planHours: 90,
      hoursBreakdown: { ai: 20, dev: 40, pm: 14, qa: 10 },
      directOtherCosts: 320000,
      overheadPercent: 15,
      status: "active",
      timelogs: [
        { date: "2026-10-01", role: "dev", hours: 40, rate: 14000, note: "Backend табеля и расчет зарплат" },
        { date: "2026-10-04", role: "ai", hours: 20, rate: 12000, note: "Парсинг резюме через AI" },
        { date: "2026-10-07", role: "pm", hours: 14, rate: 9000, note: "Внедрение в отдел кадров" },
        { date: "2026-10-09", role: "qa", hours: 10, rate: 8000, note: "Проверка безопасности" }
      ]
    },
    {
      id: "prj-4",
      title: "AI Lead Qualifier for Telegram",
      client: "Almaty Realty Group",
      direction: "ai",
      price: 3200000,
      paidAmount: 3200000,
      planHours: 45,
      hoursBreakdown: { ai: 25, dev: 8, pm: 5, qa: 0 },
      directOtherCosts: 180000,
      overheadPercent: 15,
      status: "completed",
      timelogs: [
        { date: "2026-09-15", role: "ai", hours: 25, rate: 12000, note: "Разработка скоринговой модели" },
        { date: "2026-09-18", role: "dev", hours: 8, rate: 14000, note: "Webhook в AmoCRM" },
        { date: "2026-09-20", role: "pm", hours: 5, rate: 9000, note: "Сдача проекта клиенту" }
      ]
    }
  ],
  invoices: [
    {
      id: "inv-101",
      projectId: "prj-1",
      number: "СЧ-101",
      amount: 7800000,
      status: "paid", // paid, pending, overdue
      dueDate: "2026-10-05",
      paidDate: "2026-10-04",
      client: "FinTech Solutions LLP"
    },
    {
      id: "inv-102",
      projectId: "prj-2",
      number: "СЧ-102",
      amount: 9100000,
      status: "paid",
      dueDate: "2026-09-28",
      paidDate: "2026-09-27",
      client: "Retail Group KZ"
    },
    {
      id: "inv-103",
      projectId: "prj-2",
      number: "СЧ-103",
      amount: 2100000,
      status: "overdue",
      dueDate: "2026-10-01",
      paidDate: null,
      client: "Retail Group KZ"
    },
    {
      id: "inv-104",
      projectId: "prj-3",
      number: "СЧ-104",
      amount: 2750000,
      status: "paid",
      dueDate: "2026-10-08",
      paidDate: "2026-10-07",
      client: "Logistics Central Asia"
    },
    {
      id: "inv-105",
      projectId: "prj-3",
      number: "СЧ-105",
      amount: 2750000,
      status: "pending",
      dueDate: "2026-10-25",
      paidDate: null,
      client: "Logistics Central Asia"
    }
  ]
};

function ensureDbExists() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

function getDb() {
  ensureDbExists();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading database, restoring defaults:", err);
    saveDb(defaultData);
    return defaultData;
  }
}

function saveDb(data) {
  ensureDbExists();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Financial calculation helper for projects
function calculateProjectFinancials(p) {
  let totalHours = 0;
  let laborCost = 0;

  if (p.timelogs && Array.isArray(p.timelogs)) {
    for (const log of p.timelogs) {
      totalHours += Number(log.hours) || 0;
      laborCost += (Number(log.hours) || 0) * (Number(log.rate) || 12000);
    }
  }

  const directOther = Number(p.directOtherCosts) || 0;
  const directTotal = laborCost + directOther;
  const overheadPct = Number(p.overheadPercent) || 15;
  const overheadCost = directTotal * (overheadPct / 100);
  const totalCost = directTotal + overheadCost;
  const price = Number(p.price) || 0;
  const netProfit = price - totalCost;
  const marginPercent = price > 0 ? (netProfit / price) * 100 : 0;
  const planHours = Number(p.planHours) || 1;
  const hourOverrunPercent = planHours > 0 ? Math.max(0, ((totalHours - planHours) / planHours) * 100) : 0;

  const debt = Math.max(0, price - (Number(p.paidAmount) || 0));

  return {
    totalHours,
    laborCost,
    directOther,
    directTotal,
    overheadCost,
    totalCost,
    netProfit,
    marginPercent: Number(marginPercent.toFixed(1)),
    hourOverrunPercent: Number(hourOverrunPercent.toFixed(1)),
    debt
  };
}

module.exports = {
  getDb,
  saveDb,
  calculateProjectFinancials
};
