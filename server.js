const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, saveDb, calculateProjectFinancials } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// 1. DASHBOARD ANALYTICS API
// ----------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  const db = getDb();
  let totalRevenue = 0;
  let totalCosts = 0;
  let totalPaid = 0;

  const directions = {
    ai: { name: "AI & Автоматизация", revenue: 0, cost: 0, count: 0 },
    web: { name: "Web / Low-code разработка", revenue: 0, cost: 0, count: 0 },
    marketing: { name: "Performance Маркетинг", revenue: 0, cost: 0, count: 0 }
  };

  const leakageAlerts = [];

  const projectsWithFinancials = db.projects.map(p => {
    const fin = calculateProjectFinancials(p);
    totalRevenue += Number(p.price) || 0;
    totalCosts += fin.totalCost;
    totalPaid += Number(p.paidAmount) || 0;

    const dirKey = p.direction && directions[p.direction] ? p.direction : 'web';
    directions[dirKey].revenue += Number(p.price) || 0;
    directions[dirKey].cost += fin.totalCost;
    directions[dirKey].count += 1;

    // Detect leaks
    if (fin.hourOverrunPercent > 10) {
      leakageAlerts.push({
        type: "overrun",
        severity: "high",
        projectId: p.id,
        projectTitle: p.title,
        client: p.client,
        message: `Превышение часов: план ${p.planHours}ч, факт ${fin.totalHours}ч (+${fin.hourOverrunPercent}%). Маржа просела до ${fin.marginPercent}%.`
      });
    }

    if (fin.debt > 0) {
      // Check overdue invoices
      const overdueInv = db.invoices.find(inv => inv.projectId === p.id && inv.status === 'overdue');
      if (overdueInv) {
        leakageAlerts.push({
          type: "debt_overdue",
          severity: "high",
          projectId: p.id,
          projectTitle: p.title,
          client: p.client,
          message: `Просрочен счет ${overdueInv.number} на сумму ${overdueInv.amount.toLocaleString()} ₸. Срок оплаты истек.`
        });
      }
    }

    return {
      ...p,
      financials: fin
    };
  });

  const netProfit = totalRevenue - totalCosts;
  const avgMarginPercent = totalRevenue > 0 ? Number(((netProfit / totalRevenue) * 100).toFixed(1)) : 0;
  const totalReceivables = Math.max(0, totalRevenue - totalPaid);

  // Overdue receivables from invoices
  const overdueReceivables = db.invoices
    .filter(inv => inv.status === 'overdue')
    .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

  // Directions breakdown formatted
  const directionsBreakdown = Object.keys(directions).map(key => {
    const d = directions[key];
    const profit = d.revenue - d.cost;
    const margin = d.revenue > 0 ? Number(((profit / d.revenue) * 100).toFixed(1)) : 0;
    return {
      key,
      name: d.name,
      revenue: d.revenue,
      cost: d.cost,
      profit,
      margin,
      count: d.count
    };
  });

  res.json({
    kpi: {
      totalRevenue,
      totalCosts,
      netProfit,
      avgMarginPercent,
      totalReceivables,
      overdueReceivables,
      activeProjectsCount: db.projects.filter(p => p.status === 'active').length,
      totalProjectsCount: db.projects.length
    },
    directions: directionsBreakdown,
    leakageAlerts,
    projects: projectsWithFinancials
  });
});

// ----------------------------------------------------
// 2. PROJECTS CRUD & TIMELOG
// ----------------------------------------------------
app.get('/api/projects', (req, res) => {
  const db = getDb();
  const enriched = db.projects.map(p => ({
    ...p,
    financials: calculateProjectFinancials(p)
  }));
  res.json(enriched);
});

app.post('/api/projects', (req, res) => {
  const db = getDb();
  const { title, client, direction, price, planHours, directOtherCosts, overheadPercent } = req.body;

  if (!title || !client) {
    return res.status(400).json({ error: "Название и клиент обязательны" });
  }

  const newProject = {
    id: "prj-" + Date.now(),
    title,
    client,
    direction: direction || "ai",
    price: Number(price) || 0,
    paidAmount: 0,
    planHours: Number(planHours) || 80,
    hoursBreakdown: {},
    directOtherCosts: Number(directOtherCosts) || 0,
    overheadPercent: Number(overheadPercent) || 15,
    status: "active",
    timelogs: [],
    createdAt: new Date().toISOString().split('T')[0]
  };

  db.projects.push(newProject);
  saveDb(db);

  res.status(201).json({
    ...newProject,
    financials: calculateProjectFinancials(newProject)
  });
});

app.put('/api/projects/:id', (req, res) => {
  const db = getDb();
  const idx = db.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Проект не найден" });

  db.projects[idx] = {
    ...db.projects[idx],
    ...req.body,
    id: db.projects[idx].id // Protect ID
  };
  saveDb(db);

  res.json({
    ...db.projects[idx],
    financials: calculateProjectFinancials(db.projects[idx])
  });
});

app.delete('/api/projects/:id', (req, res) => {
  const db = getDb();
  const filtered = db.projects.filter(p => p.id !== req.params.id);
  if (filtered.length === db.projects.length) {
    return res.status(404).json({ error: "Проект не найден" });
  }
  db.projects = filtered;
  saveDb(db);
  res.json({ success: true, message: "Проект удален" });
});

// Log real time for an employee
app.post('/api/projects/:id/timelogs', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });

  const { role, hours, rate, note, date } = req.body;
  if (!role || !hours) {
    return res.status(400).json({ error: "Роль и часы обязательны" });
  }

  const logEntry = {
    id: "log-" + Date.now(),
    date: date || new Date().toISOString().split('T')[0],
    role,
    hours: Number(hours),
    rate: Number(rate) || (role === 'dev' ? 14000 : (role === 'ai' ? 12000 : (role === 'pm' ? 9000 : 8000))),
    note: note || ""
  };

  if (!project.timelogs) project.timelogs = [];
  project.timelogs.push(logEntry);
  saveDb(db);

  const updatedFinancials = calculateProjectFinancials(project);
  res.status(201).json({
    success: true,
    timelog: logEntry,
    projectFinancials: updatedFinancials
  });
});

// ----------------------------------------------------
// 3. CRM LEADS & AUTOMATED HANDOFF
// ----------------------------------------------------
app.get('/api/leads', (req, res) => {
  const db = getDb();
  res.json(db.leads);
});

app.post('/api/leads', (req, res) => {
  const db = getDb();
  const { title, company, contactName, phone, budget, direction, notes, stage } = req.body;

  const newLead = {
    id: "lead-" + Date.now(),
    title: title || "Новый лид",
    company: company || "Без компании",
    contactName: contactName || "",
    phone: phone || "",
    stage: stage || "lead", // lead, contact, meeting, kp, deal, contract, won
    budget: Number(budget) || 0,
    direction: direction || "ai",
    notes: notes || "",
    createdAt: new Date().toISOString().split('T')[0]
  };

  db.leads.unshift(newLead);
  saveDb(db);
  res.status(201).json(newLead);
});

app.put('/api/leads/:id', (req, res) => {
  const db = getDb();
  const idx = db.leads.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Лид не найден" });

  db.leads[idx] = { ...db.leads[idx], ...req.body, id: db.leads[idx].id };
  saveDb(db);
  res.json(db.leads[idx]);
});

app.delete('/api/leads/:id', (req, res) => {
  const db = getDb();
  db.leads = db.leads.filter(l => l.id !== req.params.id);
  saveDb(db);
  res.json({ success: true });
});

// AUTOMATED HANDOFF: Convert lead to active production project
app.post('/api/leads/:id/convert-to-project', (req, res) => {
  const db = getDb();
  const lead = db.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Лид не найден" });

  // Calculate default estimated hours
  const budget = lead.budget || 5000000;
  const estimatedHours = Math.round(budget / 35000); // Standard consulting/dev ratio

  const newProject = {
    id: "prj-" + Date.now(),
    title: lead.title,
    client: lead.company,
    direction: lead.direction || "ai",
    price: budget,
    paidAmount: Math.round(budget * 0.5), // Standard 50% advance
    planHours: estimatedHours,
    hoursBreakdown: {},
    directOtherCosts: Math.round(budget * 0.08),
    overheadPercent: 15,
    status: "active",
    timelogs: [],
    createdAt: new Date().toISOString().split('T')[0],
    sourceLeadId: lead.id
  };

  // Add initial invoice for advance payment
  const newInvoice = {
    id: "inv-" + Date.now(),
    projectId: newProject.id,
    number: "СЧ-" + Math.floor(100 + Math.random() * 900),
    amount: Math.round(budget * 0.5),
    status: "paid",
    dueDate: new Date().toISOString().split('T')[0],
    paidDate: new Date().toISOString().split('T')[0],
    client: lead.company
  };

  db.projects.unshift(newProject);
  db.invoices.unshift(newInvoice);

  // Update lead stage to won
  lead.stage = "won";
  saveDb(db);

  res.status(201).json({
    success: true,
    message: "Handoff завершен! Проект создан в производстве, аванс зафиксирован.",
    project: {
      ...newProject,
      financials: calculateProjectFinancials(newProject)
    },
    invoice: newInvoice
  });
});

// ----------------------------------------------------
// 4. INVOICES & RECEIVABLES
// ----------------------------------------------------
app.get('/api/invoices', (req, res) => {
  const db = getDb();
  res.json(db.invoices);
});

app.post('/api/invoices', (req, res) => {
  const db = getDb();
  const { projectId, amount, dueDate, client } = req.body;

  const newInv = {
    id: "inv-" + Date.now(),
    projectId: projectId || null,
    number: "СЧ-" + Math.floor(100 + Math.random() * 900),
    amount: Number(amount) || 0,
    status: "pending",
    dueDate: dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    paidDate: null,
    client: client || "Клиент"
  };

  db.invoices.unshift(newInv);
  saveDb(db);
  res.status(201).json(newInv);
});

app.put('/api/invoices/:id/pay', (req, res) => {
  const db = getDb();
  const inv = db.invoices.find(i => i.id === req.params.id);
  if (!inv) return res.status(404).json({ error: "Счет не найден" });

  inv.status = "paid";
  inv.paidDate = new Date().toISOString().split('T')[0];

  // If tied to project, update project's paidAmount
  if (inv.projectId) {
    const prj = db.projects.find(p => p.id === inv.projectId);
    if (prj) {
      prj.paidAmount = (Number(prj.paidAmount) || 0) + Number(inv.amount);
    }
  }

  saveDb(db);
  res.json({ success: true, invoice: inv });
});

// ----------------------------------------------------
// 5. AI PROPOSAL (КП) ENGINE
// ----------------------------------------------------
app.post('/api/ai/generate-kp', (req, res) => {
  const { brief, margin = 0.5, speedMultiplier = 1.0 } = req.body;
  if (!brief) return res.status(400).json({ error: "Бриф обязателен" });

  const text = brief.toLowerCase();
  let baseHours = 80;
  if (text.includes('erp') || text.includes('портал') || text.includes('платформа')) baseHours = 160;
  else if (text.includes('crm') || text.includes('n8n') || text.includes('интеграци')) baseHours = 110;
  else if (text.includes('бот') || text.includes('ai') || text.includes('ассистент')) baseHours = 75;

  const hourlyRateAvg = 12500;
  const directLabor = baseHours * hourlyRateAvg;
  const directOther = Math.round(directLabor * 0.15); // servers, tokens, subcontracts
  const overhead = Math.round((directLabor + directOther) * 0.15);
  const costPrice = directLabor + directOther + overhead;

  // Margin calculation
  const targetMargin = Number(margin) || 0.45;
  const clientPrice = Math.round((costPrice / (1 - targetMargin)) * Number(speedMultiplier));
  const estimatedProfit = clientPrice - costPrice;

  const proposal = {
    title: "Коммерческое предложение: Внедрение AI & Automation",
    summary: brief,
    financials: {
      clientPrice,
      costPrice,
      estimatedProfit,
      marginPercent: Math.round((estimatedProfit / clientPrice) * 100),
      totalHours: baseHours
    },
    phases: [
      { name: "Этап 1: Системный аудит и прототип архитектуры", duration: "5 рабочих дней", weight: 20 },
      { name: "Этап 2: Настройка ядра n8n / Supabase и AI-логики", duration: "10 рабочих дней", weight: 45 },
      { name: "Этап 3: Сквозное тестирование и интеграция с CRM", duration: "5 рабочих дней", weight: 20 },
      { name: "Этап 4: Релиз в production и регламенты для команды", duration: "4 рабочих дня", weight: 15 }
    ],
    terms: "Предоплата 50%, постоплата 50% после подписания акта сдачи-приемки работ."
  };

  res.json(proposal);
});

// ----------------------------------------------------
// 6. CSV EXPORT
// ----------------------------------------------------
app.get('/api/export/pnl', (req, res) => {
  const db = getDb();
  let csv = "ID;Проект;Клиент;Направление;Выручка;Себестоимость;Прибыль;Маржа %;Часы факт;План часов;Статус\n";
  
  db.projects.forEach(p => {
    const fin = calculateProjectFinancials(p);
    csv += `"${p.id}";"${p.title}";"${p.client}";"${p.direction}";${p.price};${fin.totalCost};${fin.netProfit};${fin.marginPercent}%;${fin.totalHours};${p.planHours};"${p.status}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="smart_digital_pnl_report.csv"');
  res.send('\uFEFF' + csv); // Include BOM for Excel
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Smart Digital Group - Ops Core Server is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
