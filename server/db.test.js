import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, getDashboard, listFailures, listTasks } from './db.js';

test('缺省初始化具备十条可解释失效样本和可复算帕累托排序', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-governance-seed-'));
  const database = openDatabase(join(directory, 'seed.sqlite'));
  try {
    const dashboard = getDashboard(database);
    assert.equal(listTasks(database).length, 4);
    assert.equal(listFailures(database).length, 10);
    assert.equal(dashboard.failureCount, 10);
    assert.deepEqual(dashboard.pareto.map(({ count, cumulativePercent }) => [count, cumulativePercent]), [[4,40],[3,70],[2,90],[1,100]]);
    assert.ok(listFailures(database).every(({ reviewer }) => reviewer === '项目复核人员'));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('可创建不含初始化任务和复盘的空数据库', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-governance-empty-'));
  const previousSeedSetting = process.env.SEED_INITIAL_DATA;
  process.env.SEED_INITIAL_DATA = '0';
  const database = openDatabase(join(directory, 'empty.sqlite'));
  try {
    assert.equal(listTasks(database).length, 0);
    assert.equal(listFailures(database).length, 0);
  } finally {
    database.close();
    if (previousSeedSetting === undefined) delete process.env.SEED_INITIAL_DATA;
    else process.env.SEED_INITIAL_DATA = previousSeedSetting;
    rmSync(directory, { recursive: true, force: true });
  }
});
