const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Clean production schema without mock/false data
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
  leads: [],
  projects: [],
  invoices: []
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
    const data = JSON.parse(raw);
    if (!data.leads) data.leads = [];
    if (!data.projects) data.projects = [];
    if (!data.invoices) data.invoices = [];
    data.projects.forEach(p => {
      if (!p.tasks) p.tasks = [];
      if (!p.timelogs) p.timelogs = [];
    });
    return data;
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

function calculateClientAnalytics(db) {
  const clientsMap = {};

  if (!db.projects || db.projects.length === 0) {
    return [];
  }

  db.projects.forEach(p => {
    const clientName = p.client || "Неизвестный клиент";
    if (!clientsMap[clientName]) {
      clientsMap[clientName] = {
        name: clientName,
        projectsCount: 0,
        totalRevenue: 0,
        totalCost: 0,
        netProfit: 0,
        totalDebt: 0,
        activeProjects: 0
      };
    }

    const fin = calculateProjectFinancials(p);
    clientsMap[clientName].projectsCount += 1;
    clientsMap[clientName].totalRevenue += Number(p.price) || 0;
    clientsMap[clientName].totalCost += fin.totalCost;
    clientsMap[clientName].netProfit += fin.netProfit;
    clientsMap[clientName].totalDebt += fin.debt;
    if (p.status === 'active') clientsMap[clientName].activeProjects += 1;
  });

  return Object.values(clientsMap).map(c => {
    const margin = c.totalRevenue > 0 ? Number(((c.netProfit / c.totalRevenue) * 100).toFixed(1)) : 0;
    let tier = "Стандарт";
    if (margin >= 50 && c.totalDebt === 0) tier = "VIP / Золотой";
    else if (c.totalDebt > 1000000) tier = "Зона риска";

    return {
      ...c,
      marginPercent: margin,
      tier
    };
  }).sort((a, b) => b.netProfit - a.netProfit);
}

module.exports = {
  getDb,
  saveDb,
  calculateProjectFinancials,
  calculateClientAnalytics
};
