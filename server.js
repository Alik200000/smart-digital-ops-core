const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, saveDb, calculateProjectFinancials, calculateClientAnalytics } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// 1. DASHBOARD ANALYTICS API (WITH HISTORICAL MONTHLY DATA & EXPENSE DONUT)
// ----------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  const db = getDb();
  let totalRevenue = 0;
  let totalCosts = 0;
  let totalLaborCost = 0;
  let totalDirectOther = 0;
  let totalOverhead = 0;
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
    totalLaborCost += fin.laborCost;
    totalDirectOther += fin.directOther;
    totalOverhead += fin.overheadCost;
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

  const overdueReceivables = db.invoices
    .filter(inv => inv.status === 'overdue')
    .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

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

  // Monthly revenue trend (May - Oct)
  const monthlyTrend = [
    { month: "Май", revenue: 16500000, profit: 6200000 },
    { month: "Июн", revenue: 19200000, profit: 7800000 },
    { month: "Июл", revenue: 22400000, profit: 9100000 },
    { month: "Авг", revenue: 26000000, profit: 11400000 },
    { month: "Сен", revenue: 31500000, profit: 14200000 },
    { month: "Окт (Факт)", revenue: totalRevenue, profit: netProfit }
  ];

  // Cost structure breakdown for Donut Chart
  const costStructure = {
    laborCost: totalLaborCost,
    laborPercent: totalCosts > 0 ? Math.round((totalLaborCost / totalCosts) * 100) : 0,
    directOther: totalDirectOther,
    directOtherPercent: totalCosts > 0 ? Math.round((totalDirectOther / totalCosts) * 100) : 0,
    overhead: totalOverhead,
    overheadPercent: totalCosts > 0 ? Math.round((totalOverhead / totalCosts) * 100) : 0,
    netProfit: netProfit,
    marginPercent: avgMarginPercent
  };

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
    costStructure,
    monthlyTrend,
    directions: directionsBreakdown,
    leakageAlerts,
    projects: projectsWithFinancials
  });
});

// ----------------------------------------------------
// 2. CLIENTS LTV & PROFITABILITY API
// ----------------------------------------------------
app.get('/api/clients', (req, res) => {
  const db = getDb();
  const clients = calculateClientAnalytics(db);
  res.json(clients);
});

// ----------------------------------------------------
// 3. PROJECTS CRUD & TIMELOG
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
    directOtherCosts: Number(directOtherCosts) || 0,
    overheadPercent: Number(overheadPercent) || 15,
    status: "active",
    tasks: [
      { id: "tsk-" + Date.now() + "-1", title: "Аудит процессов и схема архитектуры", role: "ai", assignee: "AI Lead", planHours: 20, factHours: 0, status: "todo" },
      { id: "tsk-" + Date.now() + "-2", title: "Разработка ядра автоматизации", role: "dev", assignee: "Backend Dev", planHours: 35, factHours: 0, status: "todo" },
      { id: "tsk-" + Date.now() + "-3", title: "Тестирование и интеграция с CRM", role: "qa", assignee: "QA Engineer", planHours: 15, factHours: 0, status: "todo" },
      { id: "tsk-" + Date.now() + "-4", title: "Сдача проекта и передача регламентов", role: "pm", assignee: "Project Manager", planHours: 10, factHours: 0, status: "todo" }
    ],
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
    id: db.projects[idx].id
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

// ----------------------------------------------------
// 4. PROJECT TASKS MANAGEMENT (ПОСТАНОВКА И КОНТРОЛЬ ЗАДАЧ)
// ----------------------------------------------------
app.get('/api/projects/:id/tasks', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });
  res.json(project.tasks || []);
});

app.post('/api/projects/:id/tasks', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });

  const { title, role, assignee, planHours } = req.body;
  if (!title) return res.status(400).json({ error: "Название задачи обязательно" });

  const newTask = {
    id: "tsk-" + Date.now(),
    title,
    role: role || "ai",
    assignee: assignee || "Исполнитель",
    planHours: Number(planHours) || 10,
    factHours: 0,
    status: "todo" // todo, in_progress, review, done
  };

  if (!project.tasks) project.tasks = [];
  project.tasks.push(newTask);
  saveDb(db);

  res.status(201).json(newTask);
});

app.put('/api/projects/:id/tasks/:taskId', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });

  const task = (project.tasks || []).find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: "Задача не найдена" });

  Object.assign(task, req.body);
  saveDb(db);

  res.json(task);
});

// Log real time for an employee or task
app.post('/api/projects/:id/timelogs', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Проект не найден" });

  const { role, hours, rate, note, date, taskId } = req.body;
  if (!role || !hours) {
    return res.status(400).json({ error: "Роль и часы обязательны" });
  }

  const logEntry = {
    id: "log-" + Date.now(),
    date: date || new Date().toISOString().split('T')[0],
    role,
    hours: Number(hours),
    rate: Number(rate) || (role === 'dev' ? 14000 : (role === 'ai' ? 12000 : (role === 'pm' ? 9000 : 8000))),
    note: note || "",
    taskId: taskId || null
  };

  if (!project.timelogs) project.timelogs = [];
  project.timelogs.push(logEntry);

  // If tied to a task, increment task fact hours
  if (taskId && project.tasks) {
    const task = project.tasks.find(t => t.id === taskId);
    if (task) {
      task.factHours = (Number(task.factHours) || 0) + Number(hours);
      if (task.status === 'todo') task.status = 'in_progress';
    }
  }

  saveDb(db);

  const updatedFinancials = calculateProjectFinancials(project);
  res.status(201).json({
    success: true,
    timelog: logEntry,
    projectFinancials: updatedFinancials
  });
});

// ----------------------------------------------------
// 5. CRM LEADS & AUTOMATED HANDOFF
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
    stage: stage || "lead",
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

// AUTOMATED HANDOFF: Convert lead to active production project with initial task plan
app.post('/api/leads/:id/convert-to-project', (req, res) => {
  const db = getDb();
  const lead = db.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Лид не найден" });

  const budget = lead.budget || 5000000;
  const estimatedHours = Math.round(budget / 35000);

  const newProject = {
    id: "prj-" + Date.now(),
    title: lead.title,
    client: lead.company,
    direction: lead.direction || "ai",
    price: budget,
    paidAmount: Math.round(budget * 0.5), // Standard 50% advance
    planHours: estimatedHours,
    directOtherCosts: Math.round(budget * 0.08),
    overheadPercent: 15,
    status: "active",
    tasks: [
      { id: "tsk-" + Date.now() + "-1", title: "Системный аудит, согласование API и архитектура", role: "ai", assignee: "AI Lead", planHours: Math.round(estimatedHours * 0.25), factHours: 0, status: "in_progress" },
      { id: "tsk-" + Date.now() + "-2", title: "Разработка ядра автоматизации и интеграций", role: "dev", assignee: "Backend Dev", planHours: Math.round(estimatedHours * 0.40), factHours: 0, status: "todo" },
      { id: "tsk-" + Date.now() + "-3", title: "Промпт-инжиниринг и отладка бизнес-сценариев", role: "ai", assignee: "Vibe Coder", planHours: Math.round(estimatedHours * 0.20), factHours: 0, status: "todo" },
      { id: "tsk-" + Date.now() + "-4", title: "Сквозное тестирование и релиз в продакшн", role: "pm", assignee: "PM / QA", planHours: Math.round(estimatedHours * 0.15), factHours: 0, status: "todo" }
    ],
    timelogs: [],
    createdAt: new Date().toISOString().split('T')[0],
    sourceLeadId: lead.id
  };

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

  lead.stage = "won";
  saveDb(db);

  res.status(201).json({
    success: true,
    message: "Handoff завершен! Проект создан, декомпозирован на 4 задачи, аванс 50% зачислен в кассу.",
    project: {
      ...newProject,
      financials: calculateProjectFinancials(newProject)
    },
    invoice: newInvoice
  });
});

// ----------------------------------------------------
// 6. INVOICES & RECEIVABLES
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
// 7. AI PROPOSAL (КП) ENGINE
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
  const directOther = Math.round(directLabor * 0.15);
  const overhead = Math.round((directLabor + directOther) * 0.15);
  const costPrice = directLabor + directOther + overhead;

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
// 8. DOCUMENT GENERATOR (АКТ ВЫПОЛНЕННЫХ РАБОТ / ДОГОВОР)
// ----------------------------------------------------
app.get('/api/projects/:id/document', (req, res) => {
  const db = getDb();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).send("Проект не найден");

  const type = req.query.type || 'act'; // act, contract
  const dateStr = new Date().toLocaleDateString('ru-RU');
  const priceFormatted = (Number(project.price) || 0).toLocaleString() + " ₸";

  const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>${type === 'act' ? 'Акт выполненных работ' : 'Договор на оказание услуг'} - ${project.title}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: auto; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 25px; }
        .title { font-size: 20px; font-weight: bold; text-align: center; margin: 30px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #cbd5e1; padding: 10px; font-size: 13px; text-align: left; }
        th { background: #f8fafc; }
        .signatures { display: flex; justify-content: space-between; margin-top: 60px; }
        .sig-box { width: 45%; border-top: 1px solid #334155; padding-top: 10px; font-size: 13px; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 20px; text-align: right;">
        <button onclick="window.print()" style="padding: 10px 20px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
          🖨 Печать / Сохранить в PDF
        </button>
      </div>

      <div class="header">
        <div>
          <strong>ТОО "Smart Digital Group"</strong><br>
          г. Алматы, ул. Бегалина 77/2<br>
          БИН: 210440029148
        </div>
        <div style="text-align: right;">
          Дата: ${dateStr}<br>
          г. Алматы
        </div>
      </div>

      <div class="title">
        ${type === 'act' ? `АКТ ВЫПОЛНЕННЫХ РАБОТ № ${project.id.replace('prj-', '')}` : `ДОГОВОР ОКАЗАНИЯ УСЛУГ № ${project.id.replace('prj-', '')}`}
      </div>

      <p style="font-size: 13px; line-height: 1.6;">
        Исполнитель: <strong>ТОО "Smart Digital Group"</strong>, с одной стороны, и<br>
        Заказчик: <strong>${project.client}</strong>, с другой стороны, подтверждают выполнение следующих обязательств по проекту:
      </p>

      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Наименование услуги / этапа</th>
            <th>Часы</th>
            <th>Сумма, ₸</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td><strong>${project.title}</strong><br><span style="color: #64748b;">(Сквозная разработка, настройка интеграций и передача в эксплуатацию)</span></td>
            <td>${project.planHours} ч</td>
            <td><strong>${priceFormatted}</strong></td>
          </tr>
        </tbody>
      </table>

      <p style="font-size: 13px; margin-top: 20px;">
        Всего оказано услуг на сумму: <strong>${priceFormatted}</strong>.<br>
        Работы выполнены в полном объеме, стороны претензий друг к другу по срокам и качеству не имеют.
      </p>

      <div class="signatures">
        <div class="sig-box">
          <strong>Исполнитель:</strong><br>
          ТОО "Smart Digital Group"<br><br><br>
          ________________ / Руководитель
        </div>
        <div class="sig-box">
          <strong>Заказчик:</strong><br>
          ${project.client}<br><br><br>
          ________________ / Представитель
        </div>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});

// ----------------------------------------------------
// 9. CSV EXPORT
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
  res.send('\uFEFF' + csv);
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Smart Digital Group - Ops Core Server is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
