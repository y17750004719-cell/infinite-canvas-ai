export function applyClarificationResponse({ state, response } = {}) {
  const next = state && typeof state === 'object' ? structuredClone(state) : {};
  const answer = typeof response?.customText === 'string' ? response.customText.trim() : '';
  if (answer) next.workingBrief = answer;
  if (response?.proceedWithCurrent === true) next.proceedWithCurrent = true;
  return next;
}

export function resolveImageOperationResponse(response = {}, ..._args) {
  const text = typeof response.customText === 'string' ? response.customText.trim().toLowerCase() : '';
  if (response.selectedOptionId === 'edit' || /编辑|修改|替换/.test(text)) return 'edit';
  if (response.selectedOptionId === 'generate' || /生成|制作|新建/.test(text)) return 'generate';
  return null;
}

export async function resolveAgentClarification({ state, userMessage } = {}, ..._args) {
  return { failed: false, result: { workingBrief: String(userMessage || state?.workingBrief || ''), question: null } };
}

export function shouldAskClarification(..._args) {
  return false;
}
