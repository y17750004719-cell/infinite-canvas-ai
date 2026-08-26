const OPERATIONS = new Set(['generate', 'edit']);
const DELIVERY_MODES = new Set(['single', 'variants', 'series', 'composite']);
const PLACEHOLDER_PROMPT = /(?:\b(?:tbd|todo|to be determined|same as above|according to the contract)\b|待补充|稍后生成|同上|根据前文)/i;

const text = (value) => typeof value === 'string' ? value.trim() : '';
const positiveInteger = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export function normalizeImageExecutionContract(value, { referenceIds = [], aspectRatios = [] } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const operation = text(input.operation);
  const prompt = text(input.prompt);
  const refs = Array.from(new Set(
    (Array.isArray(input.referenceIds) ? input.referenceIds : []).map(text).filter(Boolean),
  ));
  const targetReferenceId = input.targetReferenceId == null ? null : text(input.targetReferenceId) || null;
  const outputCount = positiveInteger(input.outputCount);
  const aspectRatio = text(input.aspectRatio);
  const deliveryMode = text(input.deliveryMode);
  const panelCount = input.panelCount == null ? null : positiveInteger(input.panelCount);
  const items = (Array.isArray(input.items) ? input.items : []).map((item) => ({
    prompt: text(item?.prompt),
  }));
  const errors = [];
  if (!OPERATIONS.has(operation)) errors.push({ path: 'operation', code: 'invalid_operation', message: 'operation must be generate or edit' });
  if (!prompt) errors.push({ path: 'prompt', code: 'required', message: 'Final image prompt is required' });
  if (PLACEHOLDER_PROMPT.test(prompt)) errors.push({ path: 'prompt', code: 'placeholder', message: 'Final image prompt is incomplete' });
  if (refs.length > 20) errors.push({ path: 'referenceIds', code: 'too_many', message: 'At most 20 references are allowed' });
  const knownRefs = new Set(referenceIds.map(text).filter(Boolean));
  const missingReferenceIds = refs.filter((id) => !knownRefs.has(id));
  if (missingReferenceIds.length > 0) errors.push({ path: 'referenceIds', code: 'invalid_reference', message: `Unknown reference IDs: ${missingReferenceIds.join(', ')}` });
  if (!DELIVERY_MODES.has(deliveryMode)) errors.push({ path: 'deliveryMode', code: 'invalid_delivery_mode', message: 'deliveryMode is invalid' });
  if (outputCount < 1 || outputCount > 100) errors.push({ path: 'outputCount', code: 'invalid_count', message: 'outputCount must be between 1 and 100' });
  if (aspectRatios.length > 0 && !aspectRatios.includes(aspectRatio)) errors.push({ path: 'aspectRatio', code: 'invalid_aspect_ratio', message: 'aspectRatio is unsupported' });
  if (operation === 'edit' && (!targetReferenceId || !refs.includes(targetReferenceId))) {
    errors.push({ path: 'targetReferenceId', code: 'invalid_target', message: 'Edit target must be one of referenceIds' });
  }
  if (operation === 'generate' && targetReferenceId) errors.push({ path: 'targetReferenceId', code: 'unexpected', message: 'Generate cannot specify targetReferenceId' });
  if (deliveryMode === 'series' && items.length !== outputCount) errors.push({ path: 'items', code: 'count_mismatch', message: 'Series items must match outputCount' });
  if (deliveryMode !== 'series' && items.some((item) => !item.prompt)) errors.push({ path: 'items', code: 'invalid_item', message: 'Each item must contain a prompt' });
  if (deliveryMode === 'composite' && (!panelCount || panelCount < 2)) errors.push({ path: 'panelCount', code: 'invalid_panel_count', message: 'Composite delivery requires panelCount >= 2' });
  if (deliveryMode !== 'composite' && panelCount !== null) errors.push({ path: 'panelCount', code: 'unexpected', message: 'panelCount is only valid for composite delivery' });
  return {
    contract: errors.length === 0 ? {
      operation,
      prompt,
      referenceIds: refs,
      targetReferenceId,
      outputCount,
      aspectRatio,
      deliveryMode,
      panelCount,
      items,
    } : null,
    errors,
    missingReferenceIds,
  };
}

export function assertImageExecutionContract(value, options = {}) {
  const result = normalizeImageExecutionContract(value, options);
  if (result.contract) return result.contract;
  const error = new Error(result.errors.map((entry) => entry.message).join('; ') || 'Invalid image execution contract');
  error.code = result.missingReferenceIds.length > 0 ? 'invalid_reference' : 'invalid_tool_arguments';
  error.statusCode = 400;
  error.validationErrors = result.errors;
  error.missingReferenceIds = result.missingReferenceIds;
  throw error;
}

// Compatibility shape for existing local delivery code. It is never exposed to the model.
export function toInternalImageExecutionState(contract, { skillId = null, presentation = {} } = {}) {
  const items = contract.items.map((item, index) => ({
    index: index + 1,
    label: `系列 ${index + 1}`,
    subject: `系列 ${index + 1}`,
    variation: `系列 ${index + 1}`,
    prompt: item.prompt,
  }));
  return {
    version: 4,
    intent: 'image',
    skillId,
    confidence: 'high',
    needsClarification: false,
    clarification: null,
    contextReferences: [...contract.referenceIds],
    visualContext: {
      references: contract.referenceIds.map((referenceId) => ({
        referenceId,
        summary: referenceId,
        salientSubjects: [],
        visibleText: [],
        styleAndComposition: '',
        inferredRole: referenceId === contract.targetReferenceId ? 'edit_target' : 'content_reference',
      })),
      targetSelectionReason: null,
      targetSelectionConfidence: null,
    },
    imageTask: {
      operation: contract.operation,
      targetReferenceId: contract.targetReferenceId,
      supportingReferenceIds: contract.referenceIds.filter((id) => id !== contract.targetReferenceId),
      instruction: contract.prompt,
      mustChange: [],
      mustPreserve: [],
    },
    presentation: {
      title: presentation.completedLabel || (contract.operation === 'edit' ? '图片编辑' : '图片生成'),
      completionSummary: presentation.completionSummary || (contract.operation === 'edit' ? '图片编辑完成。' : '图片生成完成。'),
    },
    brief: { deliverable: 'image', subject: contract.prompt, style: [], literalCopy: [], constraints: [] },
    delivery: {
      mode: contract.deliveryMode,
      outputCount: contract.outputCount,
      panelCount: contract.panelCount,
      variationAxes: [],
      sharedInvariants: [],
      distinctPerItem: [],
      items,
    },
    generation: {
      aspectRatio: contract.aspectRatio,
      promptFormat: 'text',
      prompt: contract.prompt,
      items,
    },
    execution: { kind: 'image_pipeline', requiresConfirmation: false, tool: 'generate_image' },
  };
}

export function toImageDeliveryPlan(state) {
  const delivery = state?.delivery || {};
  const mode = delivery.mode === 'single' ? 'variants' : delivery.mode || 'variants';
  const outputCount = positiveInteger(delivery.outputCount, 1);
  return {
    mode,
    outputCount,
    promptCount: mode === 'series' ? outputCount : 1,
    panelCount: mode === 'composite' ? positiveInteger(delivery.panelCount) || undefined : undefined,
    variationAxes: Array.isArray(delivery.variationAxes) ? delivery.variationAxes.map(text).filter(Boolean) : [],
    evidence: ['direct_tool'],
    confidence: 'high',
    requiresClarification: false,
  };
}

export function toExecutionBrief(state, userMessage, contextEntities = []) {
  const refs = (state?.contextReferences || []).map((id) => contextEntities.find((entity) => entity.id === id)).filter(Boolean);
  const imageTask = state?.imageTask || null;
  const brief = state?.brief || {};
  const itemLines = (state?.delivery?.items || []).map((item) => `Item ${item.index}: ${item.label}; subject: ${item.subject}; variation: ${item.variation}`);
  const plainText = [
    imageTask?.instruction,
    ...(imageTask?.mustChange || []),
    ...(imageTask?.mustPreserve || []),
    brief.deliverable,
    brief.subject,
    ...(brief.style || []),
    ...(brief.constraints || []),
    ...itemLines,
    text(userMessage) ? `User request: ${text(userMessage)}` : '',
  ].filter(Boolean).join('\n');
  return {
    version: 1,
    originalRequest: text(userMessage),
    resolvedEntityIds: refs.map((entity) => entity.id),
    resolvedLabels: refs.map((entity) => entity.label).filter(Boolean),
    plainText: plainText || text(userMessage),
    mustPreserve: imageTask?.mustPreserve || brief.constraints || [],
    referenceImageUrls: [],
    canvasItemIds: [],
  };
}

export function toAgentTaskContract(state) {
  return {
    intent: state?.intent || 'image',
    skillId: state?.skillId ?? null,
    brief: structuredClone(state?.brief || { deliverable: 'image', subject: '', style: [], literalCopy: [], constraints: [] }),
    delivery: structuredClone(state?.delivery || { mode: 'single', outputCount: 1, panelCount: null, variationAxes: [], sharedInvariants: [], distinctPerItem: [], items: [] }),
    ...(state?.imageTask ? { imageTask: structuredClone(state.imageTask) } : {}),
    generation: state?.generation ? structuredClone(state.generation) : null,
    execution: structuredClone(state?.execution || { kind: 'image_pipeline', requiresConfirmation: false, tool: 'generate_image' }),
  };
}
