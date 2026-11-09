import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classifyTask, scoreFailure } from './rules.js';

const initialTasks = [
  { title: '整理需求访谈纪要', description: '从访谈文字中提取主题并形成待确认的需求列表。', risk: 'low', reversible: true, autoVerifiable: true, safetyCritical: false, status: 'in_progress', owner: '项目组' },
  { title: '审核发布前的架构变更', description: '审查核心模块改动及其回滚方案，负责人完成最终批准。', risk: 'medium', reversible: true, autoVerifiable: false, safetyCritical: false, status: 'todo', owner: '架构负责人' },
  { title: '生产数据库迁移审批', description: '评估生产数据库迁移风险；Agent不得发起或批准变更。', risk: 'high', reversible: false, autoVerifiable: false, safetyCritical: true, status: 'todo', owner: '数据库管理员' },
  { title: '生成单元测试样例', description: '为纯逻辑校验函数生成边界测试，开发者检查测试覆盖情况。', risk: 'low', reversible: true, autoVerifiable: true, safetyCritical: false, status: 'done', owner: '测试负责人' },
];

const initialFailures = [
  { taskId: 1, dimensions: { wrongResult: 2, boundaryViolation: 0, insufficientEvidence: 2, instructionDrift: 1, recoveryCost: 2 }, summary: '摘要遗漏需求依据；补充来源标注并逐条复核。', rootCause: '验收提示缺少来源追溯' },
  { taskId: 2, dimensions: { wrongResult: 1, boundaryViolation: 1, insufficientEvidence: 1, instructionDrift: 2, recoveryCost: 1 }, summary: '边界条件遗漏导致设计建议范围过宽；增加权限检查项。', rootCause: '需求边界未写入任务卡' },
  { taskId: 3, dimensions: { wrongResult: 3, boundaryViolation: 0, insufficientEvidence: 2, instructionDrift: 1, recoveryCost: 2 }, summary: '规则建议未列出关键需求来源；先核对需求后再复核方案。', rootCause: '验收提示缺少来源追溯' },
  { taskId: 1, dimensions: { wrongResult: 1, boundaryViolation: 0, insufficientEvidence: 3, instructionDrift: 1, recoveryCost: 1 }, summary: '测试说明没有列明引用的需求编号；补录来源和追踪关系。', rootCause: '验收提示缺少来源追溯' },
  { taskId: 2, dimensions: { wrongResult: 1, boundaryViolation: 2, insufficientEvidence: 0, instructionDrift: 2, recoveryCost: 1 }, summary: '任务说明没有写入不可修改目录边界；人工驳回候选改动。', rootCause: '需求边界未写入任务卡' },
  { taskId: 3, dimensions: { wrongResult: 2, boundaryViolation: 0, insufficientEvidence: 2, instructionDrift: 2, recoveryCost: 2 }, summary: '对约束的解释超出需求描述；架构负责人要求退回修订。', rootCause: '需求边界未写入任务卡' },
  { taskId: 1, dimensions: { wrongResult: 1, boundaryViolation: 0, insufficientEvidence: 1, instructionDrift: 2, recoveryCost: 3 }, summary: '修复建议未说明撤销流程；先补充恢复步骤及检查点。', rootCause: '恢复步骤未定义' },
  { taskId: 4, dimensions: { wrongResult: 0, boundaryViolation: 0, insufficientEvidence: 1, instructionDrift: 1, recoveryCost: 2 }, summary: '补丁缺少回滚说明；负责人补齐恢复方案。', rootCause: '恢复步骤未定义' },
  { taskId: 2, dimensions: { wrongResult: 1, boundaryViolation: 0, insufficientEvidence: 2, instructionDrift: 2, recoveryCost: 1 }, summary: '输出表格未遵循指定列名；统一字段并重新验收。', rootCause: '格式约束遗漏' },
  { taskId: 4, dimensions: { wrongResult: 1, boundaryViolation: 0, insufficientEvidence: 1, instructionDrift: 1, recoveryCost: 1 }, summary: '输出格式包含未要求的附加段落；按任务模板修订。', rootCause: '验收提示缺少来源追溯' },
].map((failure) => ({ ...failure, reviewer: '项目复核人员' }));

export function openDatabase(databasePath = process.env.DATABASE_PATH || './data/engineering.sqlite') {
  const resolvedPath = databasePath === ':memory:' ? ':memory:' : resolve(databasePath);
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
      description TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL CHECK(risk IN ('low','medium','high')),
      reversible INTEGER NOT NULL CHECK(reversible IN (0,1)),
      auto_verifiable INTEGER NOT NULL CHECK(auto_verifiable IN (0,1)),
      safety_critical INTEGER NOT NULL CHECK(safety_critical IN (0,1)),
      level TEXT NOT NULL CHECK(level IN ('L1','L2','L3')),
      status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done')),
      owner TEXT NOT NULL DEFAULT '', due_date TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      wrong_result INTEGER NOT NULL CHECK(wrong_result BETWEEN 0 AND 4),
      boundary_violation INTEGER NOT NULL CHECK(boundary_violation BETWEEN 0 AND 4),
      insufficient_evidence INTEGER NOT NULL CHECK(insufficient_evidence BETWEEN 0 AND 4),
      instruction_drift INTEGER NOT NULL CHECK(instruction_drift BETWEEN 0 AND 4),
      recovery_cost INTEGER NOT NULL CHECK(recovery_cost BETWEEN 0 AND 4),
      failure_score INTEGER NOT NULL CHECK(failure_score BETWEEN 0 AND 100),
      reliability_score INTEGER NOT NULL CHECK(reliability_score BETWEEN 0 AND 100),
      severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
      reviewer TEXT NOT NULL, summary TEXT NOT NULL, root_cause TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  if (process.env.SEED_INITIAL_DATA !== '0') seedDatabase(database);
  return database;
}

export function seedDatabase(database) {
  const taskCount = database.prepare('SELECT count(*) AS count FROM tasks').get().count;
  if (taskCount === 0) {
    const insertTask = database.prepare(`INSERT INTO tasks
      (title,description,risk,reversible,auto_verifiable,safety_critical,level,status,owner,due_date,created_at)
      VALUES (@title,@description,@risk,@reversible,@autoVerifiable,@safetyCritical,@level,@status,@owner,@dueDate,@createdAt)`);
      for (const task of initialTasks) {
      const recommendation = classifyTask(task);
      insertTask.run({
        ...task,
        level: recommendation.level,
        reversible: Number(task.reversible),
        autoVerifiable: Number(task.autoVerifiable),
        safetyCritical: Number(task.safetyCritical),
        dueDate: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
  if (database.prepare('SELECT count(*) AS count FROM failures').get().count === 0) {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const failure of initialFailures) insertFailure(database, { ...failure, createdAt: new Date().toISOString() });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

function toPublicTask(row) {
  if (!row) return null;
  return { ...row, reversible: Boolean(row.reversible), autoVerifiable: Boolean(row.auto_verifiable), safetyCritical: Boolean(row.safety_critical), dueDate: row.due_date, createdAt: row.created_at, auto_verifiable: undefined, safety_critical: undefined, due_date: undefined, created_at: undefined };
}

function toPublicFailure(row) {
  if (!row) return null;
  return { id: row.id, taskId: row.task_id, dimensions: { wrongResult: row.wrong_result, boundaryViolation: row.boundary_violation, insufficientEvidence: row.insufficient_evidence, instructionDrift: row.instruction_drift, recoveryCost: row.recovery_cost }, failureScore: row.failure_score, reliabilityScore: row.reliability_score, severity: row.severity, reviewer: row.reviewer, summary: row.summary, rootCause: row.root_cause, createdAt: row.created_at };
}

export function listTasks(database) {
  return database.prepare('SELECT * FROM tasks ORDER BY id DESC').all().map(toPublicTask);
}

export function createTask(database, input) {
  const classification = classifyTask(input);
  const createdAt = new Date().toISOString();
  const result = database.prepare(`INSERT INTO tasks
    (title,description,risk,reversible,auto_verifiable,safety_critical,level,status,owner,due_date,created_at)
    VALUES (@title,@description,@risk,@reversible,@autoVerifiable,@safetyCritical,@level,@status,@owner,@dueDate,@createdAt)`).run({
    title: input.title.trim(), description: input.description.trim(), risk: input.risk,
    reversible: Number(input.reversible), autoVerifiable: Number(input.autoVerifiable), safetyCritical: Number(input.safetyCritical),
    level: classification.level, status: input.status || 'todo', owner: (input.owner || '').trim(), dueDate: input.dueDate || null, createdAt,
  });
  return toPublicTask(database.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(result.lastInsertRowid)));
}

export function updateTask(database, id, fields) {
  const existing = database.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) return null;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length !== 1 || !Object.hasOwn(fields, 'status')) {
    throw new TypeError('仅支持将 status 更新为 todo、in_progress 或 done');
  }
  if (!['todo', 'in_progress', 'done'].includes(fields.status)) throw new TypeError('status 无效');
  database.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(fields.status, id);
  return toPublicTask(database.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

export function deleteTask(database, id) {
  return database.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
}

export function listFailures(database) {
  return database.prepare('SELECT * FROM failures ORDER BY id DESC').all().map(toPublicFailure);
}

export function insertFailure(database, input) {
  if (input.taskId != null && !database.prepare('SELECT id FROM tasks WHERE id = ?').get(input.taskId)) throw new RangeError('taskId 对应的任务不存在');
  const { failureScore, reliabilityScore, severity } = scoreFailure(input.dimensions);
  const result = database.prepare(`INSERT INTO failures
    (task_id,wrong_result,boundary_violation,insufficient_evidence,instruction_drift,recovery_cost,failure_score,reliability_score,severity,reviewer,summary,root_cause,created_at)
    VALUES (@taskId,@wrongResult,@boundaryViolation,@insufficientEvidence,@instructionDrift,@recoveryCost,@failureScore,@reliabilityScore,@severity,@reviewer,@summary,@rootCause,@createdAt)`).run({
    taskId: input.taskId ?? null, ...input.dimensions, failureScore, reliabilityScore, severity,
    reviewer: input.reviewer.trim(), summary: input.summary.trim(), rootCause: input.rootCause.trim(), createdAt: input.createdAt || new Date().toISOString(),
  });
  return toPublicFailure(database.prepare('SELECT * FROM failures WHERE id = ?').get(Number(result.lastInsertRowid)));
}

export function getDashboard(database) {
  const tasks = listTasks(database);
  const failures = listFailures(database);
  const levels = Object.fromEntries(['L1','L2','L3'].map((level) => [level, tasks.filter((task) => task.level === level).length]));
  const statusCounts = Object.fromEntries(['todo','in_progress','done'].map((status) => [status, tasks.filter((task) => task.status === status).length]));
  const causes = new Map();
  for (const failure of failures) {
    const cause = failure.rootCause.trim() || '未分类';
    causes.set(cause, (causes.get(cause) || 0) + 1);
  }
  const pareto = [...causes].map(([cause, count]) => ({ cause, count })).sort((left, right) => right.count - left.count || left.cause.localeCompare(right.cause, 'zh-CN'));
  let cumulativeCount = 0;
  const total = failures.length;
  const paretoWithCumulative = pareto.map((entry) => {
    cumulativeCount += entry.count;
    return { ...entry, cumulativePercent: total ? Math.round(cumulativeCount / total * 100) : 0 };
  });
  return {
    taskCount: tasks.length, inProgressCount: statusCounts.in_progress, completedCount: statusCounts.done,
    levels, statuses: statusCounts, failureCount: failures.length,
    averageReliability: total ? Math.round(failures.reduce((sum, failure) => sum + failure.reliabilityScore, 0) / total) : null,
    averageFailureScore: total ? Math.round(failures.reduce((sum, failure) => sum + failure.failureScore, 0) / total) : null,
    highPriorityFailures: failures.filter((failure) => ['high', 'critical'].includes(failure.severity)).length,
    pareto: paretoWithCumulative,
    recentFailures: failures.slice(0, 5),
  };
}

