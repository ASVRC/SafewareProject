import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDirectory = mkdtempSync(join(tmpdir(), 'ai-governance-'));
process.env.DATABASE_PATH = join(testDirectory, 'api.sqlite');
process.env.SEED_INITIAL_DATA = '0';
const { application, database } = await import('./index.js');
const { openDatabase, listTasks } = await import('./db.js');
const server = application.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const postJson = (path, payload) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  database.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test('任务与Agent失效API覆盖持久化、输入边界、评分及统计', async () => {
  assert.deepEqual(await (await fetch(`${baseUrl}/api/health`)).json(), { status: 'ok', seededData: false });
  assert.deepEqual(await (await fetch(`${baseUrl}/api/tasks`)).json(), { items: [] });

  const badTaskResponse = await postJson('/api/tasks', { title: 'x' });
  assert.equal(badTaskResponse.status, 400);
  assert.ok((await badTaskResponse.json()).details.length > 0);
  const taskResponse = await postJson('/api/tasks', {
    title: '验证需求来源', description: '检查结论均能追溯至原始访谈。', risk: 'low', reversible: true,
    autoVerifiable: true, safetyCritical: false, status: 'todo', owner: '测试组', dueDate: '2026-11-07',
  });
  assert.equal(taskResponse.status, 201);
  const task = (await taskResponse.json()).item;
  assert.equal(task.level, 'L1');
  assert.equal(task.autoVerifiable, true);
  assert.ok(task.createdAt);
  const reopenedDatabase = openDatabase(process.env.DATABASE_PATH);
  assert.equal(listTasks(reopenedDatabase).length, 1);
  reopenedDatabase.close();

  const badJsonResponse = await fetch(`${baseUrl}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' });
  assert.equal(badJsonResponse.status, 400);
  assert.match((await badJsonResponse.json()).error, /JSON/);
  const patchResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
  assert.equal((await patchResponse.json()).item.status, 'done');
  assert.equal((await fetch(`${baseUrl}/api/tasks/nope`, { method: 'PATCH' })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/tasks/9999`, { method: 'DELETE' })).status, 404);

  const dimensions = { wrongResult: 2, boundaryViolation: 1, insufficientEvidence: 1, instructionDrift: 0, recoveryCost: 1 };
  const badFailureResponse = await postJson('/api/failures', { taskId: task.id, dimensions: { ...dimensions, wrongResult: 5 }, reviewer: '复核者', summary: '发现摘要缺少证据出处', rootCause: '提示模板未要求标记引用' });
  assert.equal(badFailureResponse.status, 400);
  const failureResponse = await postJson('/api/failures', { taskId: task.id, dimensions, reviewer: '复核者', summary: '发现摘要缺少证据出处', rootCause: '提示模板未要求标记引用' });
  assert.equal(failureResponse.status, 201);
  const failure = (await failureResponse.json()).item;
  assert.equal(failure.failureScore, 30);
  assert.equal(failure.reliabilityScore, 70);
  assert.equal(failure.severity, 'medium');
  assert.deepEqual(failure.dimensions, dimensions);
  assert.equal((await fetch(`${baseUrl}/api/failures`)).status, 200);
  const boundaryEscalationResponse = await postJson('/api/failures', { taskId: task.id, dimensions: { wrongResult: 0, boundaryViolation: 4, insufficientEvidence: 0, instructionDrift: 0, recoveryCost: 0 }, reviewer: '复核者', summary: '发现未经许可的任务边界偏离', rootCause: '提示模板未要求标记引用' });
  assert.equal(boundaryEscalationResponse.status, 201);
  const boundaryEscalation = (await boundaryEscalationResponse.json()).item;
  assert.equal(boundaryEscalation.failureScore, 20);
  assert.equal(boundaryEscalation.severity, 'high');
  const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json();
  assert.equal(dashboard.taskCount, 1);
  assert.equal(dashboard.completedCount, 1);
  assert.equal(dashboard.levels.L1, 1);
  assert.equal(dashboard.failureCount, 2);
  assert.equal(dashboard.averageFailureScore, 25);
  assert.equal(dashboard.averageReliability, 75);
  assert.equal(dashboard.pareto[0].cause, '提示模板未要求标记引用');
  assert.equal(dashboard.pareto[0].count, 2);
  assert.equal((await fetch(`${baseUrl}/api/tasks/${task.id}`, { method: 'DELETE' })).status, 204);
  const retainedReviews = (await (await fetch(`${baseUrl}/api/failures`)).json()).items;
  assert.equal(retainedReviews.length, 2);
  assert.ok(retainedReviews.every((item) => item.taskId === null));
});


