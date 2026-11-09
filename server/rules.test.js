import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask, FAILURE_WEIGHTS, scoreFailure } from './rules.js';

const zeroDimensions = { wrongResult: 0, boundaryViolation: 0, insufficientEvidence: 0, instructionDrift: 0, recoveryCost: 0 };

test('评分权重合计为1，零失效对应满分可靠度', () => {
  assert.equal(Object.values(FAILURE_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 1);
  assert.deepEqual(scoreFailure(zeroDimensions), { failureScore: 0, reliabilityScore: 100, severity: 'low', action: '常规审阅' });
});

test('失败评分到达100分时，停止相关AI任务并复盘', () => {
  const result = scoreFailure(Object.fromEntries(Object.keys(zeroDimensions).map((key) => [key, 4])));
  assert.deepEqual(result, { failureScore: 100, reliabilityScore: 0, severity: 'critical', action: '停止并复盘' });
});

test('真实可达的四个整数阈值边界映射到正确的严重度', () => {
  const cases = [
    { target: 19, dimensions: { ...zeroDimensions, instructionDrift: 3, recoveryCost: 3 }, severity: 'low' },
    { target: 20, dimensions: { ...zeroDimensions, instructionDrift: 4, recoveryCost: 2 }, severity: 'medium' },
    { target: 39, dimensions: { ...zeroDimensions, insufficientEvidence: 4, instructionDrift: 3, recoveryCost: 3 }, severity: 'medium' },
    { target: 40, dimensions: { ...zeroDimensions, insufficientEvidence: 3, instructionDrift: 4, recoveryCost: 4 }, severity: 'high' },
    { target: 59, dimensions: { ...zeroDimensions, boundaryViolation: 4, insufficientEvidence: 4, instructionDrift: 3, recoveryCost: 3 }, severity: 'high' },
    { target: 60, dimensions: { ...zeroDimensions, boundaryViolation: 3, insufficientEvidence: 4, instructionDrift: 4, recoveryCost: 4 }, severity: 'critical' },
  ];
  for (const { target, dimensions, severity } of cases) {
    const result = scoreFailure(dimensions);
    assert.equal(result.failureScore, target);
    assert.equal(result.reliabilityScore, 100 - target);
    assert.equal(result.severity, severity);
  }
});

test('半分取整与越界维度满分时的人工升级规则保持一致', () => {
  const rounding = scoreFailure({ ...zeroDimensions, recoveryCost: 1 });
  assert.equal(rounding.failureScore, 3);
  const escalation = scoreFailure({ ...zeroDimensions, boundaryViolation: 4 });
  assert.equal(escalation.failureScore, 20);
  assert.equal(escalation.severity, 'high');
  assert.equal(escalation.action, '人工接管（越界升级）');
  const criticalBoundary = scoreFailure({ wrongResult: 2, boundaryViolation: 4, insufficientEvidence: 3, instructionDrift: 2, recoveryCost: 1 });
  assert.deepEqual(criticalBoundary, { failureScore: 63, reliabilityScore: 37, severity: 'critical', action: '停止并复盘' });
});

test('拒绝缺少维度、超出边界和非整数分值', () => {
  assert.throws(() => scoreFailure({ ...zeroDimensions, extra: 0 }), /恰好包含/);
  assert.throws(() => scoreFailure({ ...zeroDimensions, wrongResult: -1 }), /0 至 4/);
  assert.throws(() => scoreFailure({ ...zeroDimensions, recoveryCost: 1.5 }), /0 至 4/);
});

test('任务风险、可逆性、自动验收和安全属性共同决定分级建议', () => {
  assert.deepEqual(classifyTask({ risk: 'low', reversible: true, autoVerifiable: true, safetyCritical: false }), { level: 'L1', description: '低风险、可逆且可自动验收，可由 Agent 执行；需抽样检查。', approvalRequired: false });
  assert.equal(classifyTask({ risk: 'low', reversible: true, autoVerifiable: false, safetyCritical: false }).level, 'L2');
  for (const task of [
    { risk: 'high', reversible: true, autoVerifiable: true, safetyCritical: false },
    { risk: 'low', reversible: false, autoVerifiable: true, safetyCritical: false },
    { risk: 'low', reversible: true, autoVerifiable: true, safetyCritical: true },
  ]) assert.equal(classifyTask(task).level, 'L3');
  assert.throws(() => classifyTask({ risk: 'extreme', reversible: true, autoVerifiable: true, safetyCritical: false }), /risk/);
  assert.throws(() => classifyTask({ risk: 'low', reversible: 1, autoVerifiable: true, safetyCritical: false }), /reversible/);
});
