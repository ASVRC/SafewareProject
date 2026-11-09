import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openDatabase, listTasks, createTask, updateTask, deleteTask, listFailures, insertFailure, getDashboard } from './db.js';
import { classifyTask } from './rules.js';

export const application = express();
application.use(express.json({ limit: '32kb' }));
export const database = openDatabase();
application.get('/api/health', (_request, response) => response.json({ status: 'ok', seededData: process.env.SEED_INITIAL_DATA !== '0' }));
application.get('/api/tasks', (_request, response) => response.json({ items: listTasks(database) }));
application.post('/api/tasks', (request, response) => {
  const errors = validateTask(request.body);
  if (errors.length) return response.status(400).json({ error: '任务输入无效', details: errors });
  return response.status(201).json({ item: createTask(database, request.body) });
});
application.patch('/api/tasks/:id', (request, response) => {
  const id = parseId(request.params.id);
  if (!id) return response.status(400).json({ error: '任务编号无效' });
  const item = updateTask(database, id, request.body);
  return item ? response.json({ item }) : response.status(404).json({ error: '任务不存在' });
});
application.delete('/api/tasks/:id', (request, response) => {
  const id = parseId(request.params.id);
  if (!id) return response.status(400).json({ error: '任务编号无效' });
  return deleteTask(database, id) ? response.status(204).end() : response.status(404).json({ error: '任务不存在' });
});
application.get('/api/failures', (_request, response) => response.json({ items: listFailures(database) }));
application.post('/api/failures', (request, response) => {
  const errors = validateFailure(request.body);
  if (errors.length) return response.status(400).json({ error: '失效复盘输入无效', details: errors });
  try {
    return response.status(201).json({ item: insertFailure(database, request.body) });
  } catch (error) {
    if (error instanceof RangeError) return response.status(400).json({ error: error.message });
    throw error;
  }
});
application.get('/api/dashboard', (_request, response) => response.json(getDashboard(database)));
application.post('/api/classify', (request, response) => {
  try { return response.json(classifyTask(request.body)); }
  catch (error) { return response.status(400).json({ error: error.message }); }
});

const docsDirectory = resolve(fileURLToPath(new URL('../docs/', import.meta.url)));
application.use('/docs', express.static(docsDirectory));
const clientDirectory = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
application.use(express.static(clientDirectory));
application.get('{*path}', (_request, response, next) => {
  if (_request.path.startsWith('/api/')) return next();
  return response.sendFile(resolve(clientDirectory, 'index.html'), (error) => { if (error) next(); });
});
application.use((error, _request, response, _next) => {
  if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: '请求体必须为有效 JSON' });
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: '请求体不能超过 32 KB' });
  console.error(error);
  return response.status(500).json({ error: '服务器内部错误' });
});

export function validateTask(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['请求体必须为 JSON 对象'];
  if (typeof body.title !== 'string' || body.title.trim().length < 3 || body.title.trim().length > 120) errors.push('title 长度需为 3 至 120 个字符');
  if (typeof body.description !== 'string' || body.description.length > 1000) errors.push('description 必须为字符串且不超过 1000 个字符');
  if (!['low','medium','high'].includes(body.risk)) errors.push('risk 必须为 low、medium 或 high');
  for (const field of ['reversible','autoVerifiable','safetyCritical']) if (typeof body[field] !== 'boolean') errors.push(`${field} 必须为布尔值`);
  if (body.status != null && !['todo','in_progress','done'].includes(body.status)) errors.push('status 无效');
  if (body.owner != null && (typeof body.owner !== 'string' || body.owner.length > 100)) errors.push('owner 不能超过 100 个字符');
  if (body.dueDate != null && (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || Number.isNaN(Date.parse(`${body.dueDate}T00:00:00Z`)) || new Date(`${body.dueDate}T00:00:00Z`).toISOString().slice(0,10) !== body.dueDate)) errors.push('dueDate 必须为有效的 YYYY-MM-DD 日期');
  return errors;
}

export function validateFailure(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['请求体必须为 JSON 对象'];
  if (body.taskId != null && (!Number.isSafeInteger(body.taskId) || body.taskId < 1)) errors.push('taskId 必须为正整数');
  const dimensions = body.dimensions;
  const expected = ['wrongResult','boundaryViolation','insufficientEvidence','instructionDrift','recoveryCost'].sort();
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions) || Object.keys(dimensions).sort().join('|') !== expected.join('|')) errors.push(`dimensions 必须恰好包含：${expected.join('、')}`);
  else for (const [name, value] of Object.entries(dimensions)) if (!Number.isInteger(value) || value < 0 || value > 4) errors.push(`${name} 必须为 0 至 4 的整数`);
  for (const field of ['reviewer','summary','rootCause']) if (typeof body[field] !== 'string' || body[field].trim().length < 2 || body[field].length > 500) errors.push(`${field} 长度需为 2 至 500 个字符`);
  return errors;
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const port = Number(process.env.PORT || 3000);
  const server = application.listen(port, '0.0.0.0', () => console.log(`AI治理平台已启动：http://localhost:${port}`));
  const close = () => server.close(() => { database.close(); process.exit(0); });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

