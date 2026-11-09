export const FAILURE_WEIGHTS = Object.freeze({
  wrongResult: 0.35,
  boundaryViolation: 0.20,
  insufficientEvidence: 0.20,
  instructionDrift: 0.15,
  recoveryCost: 0.10,
});

export const FAILURE_SEVERITIES = Object.freeze([
  { minimum: 60, label: '停止并复盘', key: 'critical' },
  { minimum: 40, label: '人工接管', key: 'high' },
  { minimum: 20, label: '加强协作', key: 'medium' },
  { minimum: 0, label: '常规审阅', key: 'low' },
]);

export const TASK_LEVELS = Object.freeze(['L1', 'L2', 'L3']);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const DIMENSION_NAMES = Object.keys(FAILURE_WEIGHTS);

export function classifyTask(input) {
  if (!input || !RISK_LEVELS.has(input.risk)) {
    throw new TypeError('risk 必须为 low、medium 或 high');
  }
  for (const field of ['reversible', 'autoVerifiable', 'safetyCritical']) {
    if (typeof input[field] !== 'boolean') throw new TypeError(`${field} 必须为布尔值`);
  }

  let level;
  if (input.risk === 'high' || input.safetyCritical || !input.reversible) level = 'L3';
  else if (input.risk === 'low' && input.reversible && input.autoVerifiable) level = 'L1';
  else level = 'L2';

  const descriptions = {
    L1: '低风险、可逆且可自动验收，可由 Agent 执行；需抽样检查。',
    L2: '存在不确定性或需领域判断，Agent 协助执行并由人员逐项复核。',
    L3: '高风险、不可逆或涉及安全责任；由人员执行并审批，Agent 仅作信息整理。',
  };
  return { level, description: descriptions[level], approvalRequired: level !== 'L1' };
}

export function scoreFailure(dimensions) {
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    throw new TypeError('dimensions 必须包含五个失效维度');
  }
  const actualNames = Object.keys(dimensions).sort();
  const expectedNames = [...DIMENSION_NAMES].sort();
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new TypeError(`dimensions 必须恰好包含：${DIMENSION_NAMES.join('、')}`);
  }

  let weightedSum = 0;
  for (const [name, weight] of Object.entries(FAILURE_WEIGHTS)) {
    const value = dimensions[name];
    if (!Number.isInteger(value) || value < 0 || value > 4) {
      throw new RangeError(`${name} 的分值必须为 0 至 4 的整数`);
    }
    weightedSum += value * weight;
  }
  const failureScore = Math.round(weightedSum * 25);
  const baseSeverity = FAILURE_SEVERITIES.find(({ minimum }) => failureScore >= minimum);
  const boundaryEscalation = dimensions.boundaryViolation === 4 && ['low', 'medium'].includes(baseSeverity.key);
  const severity = boundaryEscalation
    ? FAILURE_SEVERITIES.find(({ key }) => key === 'high')
    : baseSeverity;
  return {
    failureScore,
    reliabilityScore: 100 - failureScore,
    severity: severity.key,
    action: boundaryEscalation ? '人工接管（越界升级）' : severity.label,
  };
}
