import { useCallback, useEffect, useMemo, useState } from 'react';

const levelMeta = {
  L1: { label: '自主执行', short: '低风险 · 可验证', color: '#438c70', tone: 'sage' },
  L2: { label: '协作复核', short: '人在环 · 有检查点', color: '#bc8740', tone: 'amber' },
  L3: { label: '人工负责', short: '高风险 · 禁止自动决策', color: '#c2685f', tone: 'rose' },
};
const statusMeta = { todo: '待处理', in_progress: '进行中', done: '已完成' };
const severityMeta = { low: '常规审阅', medium: '加强协作', high: '人工接管', critical: '停止并复盘' };
const dimensionMeta = [
  ['wrongResult', '结果错误'], ['boundaryViolation', '越权越界'], ['insufficientEvidence', '证据不足'],
  ['instructionDrift', '指令偏离'], ['recoveryCost', '恢复代价'],
];
const emptyTask = { title: '', description: '', risk: 'low', reversible: true, autoVerifiable: true, safetyCritical: false, status: 'todo', owner: '', dueDate: '' };
const emptyFailure = { taskId: '', dimensions: Object.fromEntries(dimensionMeta.map(([key]) => [key, 0])), reviewer: '', summary: '', rootCause: '' };

async function requestJson(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.details?.join('；') || details.error || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    list: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function LevelBadge({ level }) {
  const meta = levelMeta[level] || levelMeta.L2;
  return <span className={`level-badge tone-${meta.tone}`}><span className="level-dot" />{level} · {meta.label}</span>;
}

function SectionHeading({ eyebrow, title, action }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>;
}

function EmptyState({ title, message }) {
  return <div className="empty-state"><span><Icon name="list" size={21} /></span><strong>{title}</strong><p>{message}</p></div>;
}

function LevelDonut({ levels, total }) {
  const slices = useMemo(() => {
    if (!total) return [];
    let offset = 0;
    return ['L1', 'L2', 'L3'].map((level) => {
      const value = levels[level] || 0;
      const slice = { level, value, offset, length: value / total * 100 };
      offset += slice.length;
      return slice;
    });
  }, [levels, total]);
  return <div className="level-chart-area">
    <svg className="donut" viewBox="0 0 42 42" role="img" aria-label={`共 ${total} 项任务，L1 ${levels.L1 || 0} 项，L2 ${levels.L2 || 0} 项，L3 ${levels.L3 || 0} 项`}>
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="#edf0eb" strokeWidth="5" />
      {slices.map(({ level, length, offset }) => <circle key={level} cx="21" cy="21" r="15.9" fill="none" stroke={levelMeta[level].color} strokeWidth="5" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} transform="rotate(-90 21 21)" />)}
      <text x="21" y="20" textAnchor="middle" className="donut-count">{total}</text>
      <text x="21" y="25" textAnchor="middle" className="donut-label">任务</text>
    </svg>
    <div className="level-legend">{['L1', 'L2', 'L3'].map((level) => <div className="legend-row" key={level}><span className={`legend-dot tone-${levelMeta[level].tone}`} /><span>{level} {levelMeta[level].label}</span><strong>{levels[level] || 0}</strong></div>)}</div>
  </div>;
}

function ParetoChart({ entries }) {
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  if (!entries.length) return <EmptyState title="还没有失效样本" message="记录一次 Agent 失效复盘后，缺陷原因将显示在这里。" />;
  return <div className="pareto-list" aria-label="失效根因帕累托图">{entries.slice(0, 5).map((entry, index) => <div className="pareto-item" key={entry.cause}>
    <div className="pareto-top"><div><span className="pareto-index">0{index + 1}</span><span className="pareto-cause">{entry.cause}</span></div><span className="pareto-count">{entry.count} 次 <span>· {entry.cumulativePercent}% 累计</span></span></div>
    <div className="pareto-track"><span style={{ width: `${Math.max(6, entry.count / max * 100)}%` }} /></div>
  </div>)}</div>;
}

function TaskForm({ onClose, onSubmit, busy }) {
  const [form, setForm] = useState(emptyTask);
  const [error, setError] = useState('');
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  async function submit(event) {
    event.preventDefault();
    try { await onSubmit({ ...form, dueDate: form.dueDate || null }); }
    catch (caught) { setError(caught.message); }
  }
  const recommendation = form.safetyCritical || form.risk === 'high' || !form.reversible ? 'L3' : form.risk === 'low' && form.autoVerifiable ? 'L1' : 'L2';
  return <form className="modal-panel" onSubmit={submit}>
    <div className="modal-top"><div><span className="eyebrow">任务登记</span><h2>新建工作项</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><Icon name="close" /></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <label className="field-label">任务名称 <span>*</span><input required minLength={3} maxLength={120} value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：检查需求追溯完整性" /></label>
    <label className="field-label">工作说明<textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="描述目标、验收条件与负责边界" /></label>
    <div className="field-grid"><label className="field-label">任务风险<select value={form.risk} onChange={(event) => update('risk', event.target.value)}><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label><label className="field-label">负责人<input maxLength={100} value={form.owner} onChange={(event) => update('owner', event.target.value)} placeholder="团队成员" /></label></div>
    <div className="toggle-stack"><label className="toggle-row"><input type="checkbox" checked={form.reversible} onChange={(event) => update('reversible', event.target.checked)} /><span><strong>操作可逆</strong><small>能够通过回滚恢复原始状态</small></span></label><label className="toggle-row"><input type="checkbox" checked={form.autoVerifiable} onChange={(event) => update('autoVerifiable', event.target.checked)} /><span><strong>可以自动验收</strong><small>存在可重复执行的测试或指标</small></span></label><label className="toggle-row"><input type="checkbox" checked={form.safetyCritical} onChange={(event) => update('safetyCritical', event.target.checked)} /><span><strong>涉及安全关键责任</strong><small>必须由责任人审批和执行</small></span></label></div>
    <div className="recommendation"><span>分级建议</span><LevelBadge level={recommendation} /><small>建议仅供参考；需要人工审批的任务不会由 Agent 自动执行。</small></div>
    <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存任务'} <Icon name="arrow" size={16} /></button></div>
  </form>;
}

function FailureForm({ tasks, onClose, onSubmit, busy }) {
  const [form, setForm] = useState(emptyFailure);
  const [error, setError] = useState('');
  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function updateDimension(name, value) { setForm((current) => ({ ...current, dimensions: { ...current.dimensions, [name]: Number(value) } })); }
  const score = useMemo(() => Math.round(Object.entries(form.dimensions).reduce((sum, [name, value]) => sum + value * { wrongResult: 0.35, boundaryViolation: 0.2, insufficientEvidence: 0.2, instructionDrift: 0.15, recoveryCost: 0.1 }[name], 0) * 25), [form.dimensions]);
  const action = form.dimensions.boundaryViolation === 4 && score < 60 ? '人工接管（越界升级）' : score >= 60 ? '停止并复盘' : score >= 40 ? '人工接管' : score >= 20 ? '加强协作' : '常规审阅';
  async function submit(event) {
    event.preventDefault();
    try { await onSubmit({ ...form, taskId: form.taskId ? Number(form.taskId) : null }); }
    catch (caught) { setError(caught.message); }
  }
  return <form className="modal-panel" onSubmit={submit}>
    <div className="modal-top"><div><span className="eyebrow">运行复盘</span><h2>记录一次失效</h2></div><button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><Icon name="close" /></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="form-intro">按观察证据为每个维度选择 0–4 分，0 表示未观察到问题，4 表示严重失效。</p>
    <label className="field-label">关联任务<select value={form.taskId} onChange={(event) => update('taskId', event.target.value)}><option value="">不关联具体任务</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.title} · {task.level}</option>)}</select></label>
    <div className="dimension-picker">{dimensionMeta.map(([key, label]) => <label className="dimension-row" key={key}><span>{label}<small>{{ wrongResult: '权重 35%', boundaryViolation: '权重 20%', insufficientEvidence: '权重 20%', instructionDrift: '权重 15%', recoveryCost: '权重 10%' }[key]}</small></span><select aria-label={`${label}评分`} value={form.dimensions[key]} onChange={(event) => updateDimension(key, event.target.value)}>{[0,1,2,3,4].map((value) => <option key={value} value={value}>{value} 分</option>)}</select></label>)}</div>
    <div className="live-score"><span>当前失败评分</span><strong>{score}<small> / 100</small></strong><em>{action}</em></div>
    <label className="field-label">复核人 <span>*</span><input required minLength={2} maxLength={100} value={form.reviewer} onChange={(event) => update('reviewer', event.target.value)} placeholder="负责人或复核人员" /></label>
    <label className="field-label">失效现象 <span>*</span><textarea required minLength={2} maxLength={500} rows={2} value={form.summary} onChange={(event) => update('summary', event.target.value)} placeholder="描述观察到的输出或操作及影响" /></label>
    <label className="field-label">根因归类 <span>*</span><input required minLength={2} maxLength={500} value={form.rootCause} onChange={(event) => update('rootCause', event.target.value)} placeholder="例如：提示模板缺少来源追溯要求" /></label>
    <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? '提交中…' : '保存复盘'} <Icon name="arrow" size={16} /></button></div>
  </form>;
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [failures, setFailures] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [taskResult, failureResult, summary] = await Promise.all([requestJson('/api/tasks'), requestJson('/api/failures'), requestJson('/api/dashboard')]);
      setTasks(taskResult.items);
      setFailures(failureResult.items);
      setDashboard(summary);
    } catch (caught) { setError(caught.message || '暂时无法连接到治理服务。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function createTask(data) {
    setBusy(true);
    try { await requestJson('/api/tasks', { method: 'POST', body: JSON.stringify(data) }); setModal(null); await loadData(); }
    finally { setBusy(false); }
  }
  async function createFailure(data) {
    setBusy(true);
    try { await requestJson('/api/failures', { method: 'POST', body: JSON.stringify(data) }); setModal(null); await loadData(); }
    finally { setBusy(false); }
  }
  async function changeStatus(task, status) {
    try { await requestJson(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadData(); }
    catch (caught) { setError(caught.message); }
  }

  const filteredTasks = useMemo(() => tasks.filter((task) => (filter === 'all' || task.level === filter) && `${task.title} ${task.description} ${task.owner}`.toLowerCase().includes(query.trim().toLowerCase())), [tasks, filter, query]);
  const activeTasks = dashboard?.inProgressCount ?? 0;
  const reliability = dashboard?.averageReliability;
  const latestFailures = failures.slice(0, 3);

  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#overview"><span className="brand-mark"><span /><span /><span /><span /></span><span>循证工作台<small>ENGINEERING GOVERNANCE</small></span></a><div className="sidebar-label">工作空间</div><nav className="side-nav" aria-label="主导航"><a className="nav-link selected" href="#overview"><Icon name="grid" />总览</a><a className="nav-link" href="#tasks"><Icon name="list" />任务管理<span className="nav-count">{tasks.length}</span></a><a className="nav-link" href="#reliability"><Icon name="shield" />Agent 可靠性</a><a className="nav-link" href="#insights"><Icon name="chart" />失效分析</a></nav><div className="sidebar-bottom"><div className="project-mini"><span className="project-icon">SE</span><span><strong>软件工程大作业</strong><small>工程项目 · 2026 秋</small></span><Icon name="chevron" size={16} /></div><div className="side-note"><span className="online-dot" />系统运行正常<small>记录与复核结果持续更新</small></div></div></aside>
    <main className="main-content" id="overview"><header className="topbar"><div className="breadcrumb">工作空间 <Icon name="chevron" size={14} /> <strong>治理总览</strong></div><div className="topbar-actions"><span className="sync-pill"><span />数据已同步</span><span className="avatar">C</span><span className="user-name">项目成员</span></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={loadData}>重新加载</button></div>}
      <section className="page-intro"><div><div className="date-line"><span className="tiny-dot" />PROJECT OVERVIEW <span className="separator">/</span> 2026.11</div><h1>你好，项目组 <span className="wave">✳</span></h1><p>把重要工作留给人的判断，让 Agent 的每一步都可分级、可复核、可追溯。</p></div><div className="intro-actions"><button className="button secondary" type="button" onClick={() => setModal('failure')}><Icon name="shield" size={16} />记录失效</button><button className="button primary" type="button" onClick={() => setModal('task')}><Icon name="plus" size={17} />新建任务</button></div></section>
      <section className="metrics-grid" aria-label="项目核心指标"><article className="metric-card"><div className="metric-top"><span>任务总数</span><span className="metric-icon sage-icon"><Icon name="list" size={17} /></span></div><div className="metric-value">{loading ? '—' : dashboard?.taskCount ?? 0}<span className="metric-unit">项</span></div><div className="metric-foot"><span>覆盖 L1–L3 三个治理等级</span><Icon name="arrow" size={14} /></div></article><article className="metric-card"><div className="metric-top"><span>正在推进</span><span className="metric-icon blue-icon"><Icon name="clock" size={17} /></span></div><div className="metric-value">{loading ? '—' : activeTasks}<span className="metric-unit">项</span></div><div className="metric-foot"><span>{dashboard?.completedCount ?? 0} 项已完成</span><span className="neutral-trend">同步自任务列表</span></div></article><article className="metric-card reliability-card"><div className="metric-top"><span>Agent 平均可靠度</span><span className="metric-icon green-icon"><Icon name="shield" size={17} /></span></div><div className="metric-value">{reliability == null ? '—' : reliability}<span className="metric-unit">{reliability == null ? '' : ' / 100'}</span></div><div className="metric-progress"><span style={{ width: `${reliability ?? 0}%` }} /></div><div className="metric-foot"><span>依据失效样本量化评审</span><span className="neutral-trend">{dashboard?.failureCount ?? 0} 条样本</span></div></article><article className="metric-card"><div className="metric-top"><span>需要重点复核</span><span className="metric-icon amber-icon"><Icon name="chart" size={17} /></span></div><div className="metric-value">{loading ? '—' : dashboard?.highPriorityFailures ?? 0}<span className="metric-unit">条</span></div><div className="metric-foot"><span>人工接管或停止并复盘</span><a className="text-link" href="#reliability">查看记录 <Icon name="chevron" size={13} /></a></div></article></section>
      <section className="overview-grid"><article className="panel level-panel"><SectionHeading eyebrow="RISK CLASSIFICATION" title="任务分级概况" action={<a href="#tasks" className="quiet-link">全部任务 <Icon name="chevron" size={14} /></a>} />{loading ? <div className="loading-line">正在读取任务数据…</div> : tasks.length ? <LevelDonut levels={dashboard?.levels || {}} total={dashboard?.taskCount ?? 0} /> : <EmptyState title="暂无分级数据" message="添加一项任务以查看分级概况。" />}<div className="governance-note"><span><Icon name="shield" size={16} /></span><p><strong>分级是治理起点</strong><br />L3 任务由责任人审批，AI 不执行最终操作。</p></div></article><article className="panel tasks-panel" id="tasks"><SectionHeading eyebrow="YOUR WORK QUEUE" title="最近任务" action={<button className="quiet-link button-link" type="button" onClick={() => setModal('task')}><Icon name="plus" size={14} />新建任务</button>} /><div className="task-toolbar"><label className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务或负责人" aria-label="搜索任务或负责人" /></label><div className="filter-group" role="group" aria-label="按任务级别筛选">{['all','L1','L2','L3'].map((level) => <button key={level} type="button" className={filter === level ? 'active' : ''} onClick={() => setFilter(level)}>{level === 'all' ? '全部' : level}</button>)}</div></div><div className="task-list">{loading ? <div className="loading-line">任务队列加载中…</div> : filteredTasks.length ? filteredTasks.slice(0, 6).map((task) => <article className="task-row" key={task.id}><span className={`task-check ${task.status === 'done' ? 'checked' : ''}`}><Icon name="check" size={13} /></span><div className="task-copy"><div className="task-title-line"><strong>{task.title}</strong>{task.status === 'in_progress' && <span className="task-status-dot" />}</div><span>{task.owner || '未指定负责人'} <span className="middle-dot">·</span> {task.description || '暂无补充说明'}</span></div><LevelBadge level={task.level} /><select aria-label={`${task.title}的任务状态`} className={`status-select status-${task.status}`} value={task.status} onChange={(event) => changeStatus(task, event.target.value)}><option value="todo">待处理</option><option value="in_progress">进行中</option><option value="done">已完成</option></select></article>) : <EmptyState title="没有匹配的任务" message="试试切换筛选条件，或新建一项工作。" />}</div><div className="task-footer">显示 {filteredTasks.length} 项任务中的 {Math.min(filteredTasks.length, 6)} 项 <span>{tasks.filter((task) => task.status === 'done').length} 项已完成</span></div></article></section>
      <section className="insights-grid" id="insights"><article className="panel insight-panel"><SectionHeading eyebrow="QUALITY SIGNALS" title="失效根因 · 累计分布" action={<span className="soft-tag">帕累托分析</span>} /><p className="panel-subtitle">聚焦最常出现的失效原因，优先修复系统性问题。</p><ParetoChart entries={dashboard?.pareto || []} /></article><article className="panel reliability-panel" id="reliability"><SectionHeading eyebrow="AGENT REVIEW" title="最近失效复盘" action={<button className="quiet-link button-link" type="button" onClick={() => setModal('failure')}><Icon name="plus" size={14} />登记复盘</button>} /><div className="review-summary"><div><span>平均失败评分</span><strong>{dashboard?.averageFailureScore ?? '—'}<small> / 100</small></strong></div><div className="review-vline" /><div><span>可靠度样本</span><strong>{dashboard?.failureCount ?? 0}<small> 条</small></strong></div></div>{loading ? <div className="loading-line">正在加载复盘记录…</div> : latestFailures.length ? <div className="failure-list">{latestFailures.map((failure) => <article className="failure-row" key={failure.id}><div className={`failure-avatar severity-${failure.severity}`}><Icon name="shield" size={17} /></div><div className="failure-copy"><strong>{failure.summary}</strong><span>{failure.rootCause} <i>·</i> {failure.reviewer}</span></div><div className="failure-result"><strong>{failure.failureScore}</strong><span className={`severity-label severity-text-${failure.severity}`}>{severityMeta[failure.severity]}</span></div></article>)}</div> : <EmptyState title="暂未记录 Agent 失效" message="遇到输出偏差、越界或证据不足时，请记录并复核。" />}<div className="scoring-note"><span className="online-dot" />失效评分 = 五项维度加权（各项 0–4 分）<a href="/docs/07-Agent失效评分.md" target="_blank" rel="noreferrer">评分标准</a></div></article></section>
      <footer className="footer-bar"><span>循证工作台 <span>·</span> 软件工程项目</span><span>清晰分级 <span>·</span> 人在环 <span>·</span> 全程可追溯</span></footer>
    </main>
    {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div role="dialog" aria-modal="true" aria-label={modal === 'task' ? '新建工作项' : 'Agent 失效复盘'}>{modal === 'task' ? <TaskForm busy={busy} onClose={() => setModal(null)} onSubmit={createTask} /> : <FailureForm busy={busy} tasks={tasks} onClose={() => setModal(null)} onSubmit={createFailure} />}</div></div>}
  </div>;
}

export default App;

