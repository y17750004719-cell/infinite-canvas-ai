/* Builds the request-scoped image execution adapter used by the main-agent flow. */
import { IMAGE_PIPELINE_ROUTE, requestImageGeneration } from './agent-image-pipeline-service.mjs';
import { createAgentImageExecutionFlow } from './agent-image-execution-flow.mjs';
import { resolveImageExecutionSelection } from './image-provider-selection.mjs';
import { resolveAgentImageCardReferences } from './agent-reference-context-service.mjs';

export function createAgentImageRuntimeContext(scope) {
  const {
    request,
    signal,
    runId,
    sessionId,
    taskId,
    operationId,
    flush,
    providers,
    providerImageOptionProfiles,
    selectedSkill,
    getSelectedSkill,
    resolveTaskReservation,
    persistAsset,
    materializeAsset,
    emit,
    writeProgress,
    writeLog,
    generatedAssetsFromResult,
    hashPrompt,
    heartbeat,
    recordSucceeded,
  } = scope;

  const imageExecutionFlow = createAgentImageExecutionFlow({
    request,
    signal,
    runId,
    sessionId,
    taskId,
    operationId,
    flush,
    resolveSelection: ({ imageOptions, override }) => resolveImageExecutionSelection({
      providers,
      requestedProviderId: override?.providerId || imageOptions?.providerId,
      requestedModel: override?.model || imageOptions?.model,
    }),
    resolveReferences: ({ referenceContext, referenceImages, imageTask }) => resolveAgentImageCardReferences({
      referenceContext,
      referenceImages,
      imageTask,
    }),
    buildRequests: ({ prompt, items, imageOptions, references, selection, outputCount }) => scope.buildRequests({
      prompt,
      generationPrompts: items.map((item) => item.prompt),
      linkedImagePreviews: references.linkedImagePreviews,
      referenceIds: references.referenceIds,
      providerId: selection.selection.providerId,
      modelId: selection.selection.model,
      allowedModelIds: selection.allowedModelIds,
      providerImageOptionProfiles,
      contractAspectRatio: typeof imageOptions?.aspectRatio === 'string' ? imageOptions.aspectRatio : undefined,
      selectedAspectRatio: imageOptions?.aspectRatio,
      requestedSize: imageOptions?.size,
      requestedQuality: imageOptions?.quality,
      requestedCount: outputCount,
    }),
    resolveExecutionMode: ({ selection, imageOptions }) => scope.resolveExecutionMode({
      modelId: selection.selection.model,
      size: imageOptions?.size,
      count: imageOptions?.count,
    }),
    reserveTask: ({ imageTask, outputCount }) => resolveTaskReservation({
      kind: 'image_pipeline',
      tool: 'generate_image',
      imageTask,
      outputCount,
    }),
    requestProvider: ({ request: imageRequest, signal: requestSignal, body, toolCallId, commentarySource, commentaryFallbackUsed }) => {
      const activeSkill = getSelectedSkill ? getSelectedSkill() : selectedSkill;
      return requestImageGeneration({
      request: imageRequest,
      url: IMAGE_PIPELINE_ROUTE,
      signal: requestSignal,
      body: {
        ...body,
        skill: activeSkill?.id || null,
        selectedSkillId: activeSkill?.id || null,
        ...(toolCallId ? { toolCallId } : {}),
        commentarySource: commentarySource || null,
        commentaryFallbackUsed: commentaryFallbackUsed === true,
      },
      });
    },
    persistAsset,
    materializeAsset,
    emit,
    writeProgress,
    writeLog,
    generatedAssetsFromResult,
    hashPrompt,
    heartbeat,
    buildPromptTrace: (index, sourcePrompt, requestBody, imageTask) => ({
      sourcePrompt,
      finalPrompt: String(requestBody?.messages?.[0]?.content || sourcePrompt),
      sourcePromptHash: hashPrompt(sourcePrompt),
      finalPromptHash: hashPrompt(String(requestBody?.messages?.[0]?.content || sourcePrompt)),
      supplierPromptHash: hashPrompt(String(requestBody?.messages?.[0]?.content || sourcePrompt)),
      operation: imageTask?.operation || 'generate',
      skillId: (getSelectedSkill ? getSelectedSkill() : selectedSkill)?.id || null,
    }),
    recordSucceeded,
  });

  const executeImagePayload = (finalPromptSource, imageOptions, referenceImages, countMetadata = {}, generationItems = [], streamOptions = {}, deliveryPlan, imageTask, _visualContext, presentation, referenceContext, resolvedImageSelectionOverride) => imageExecutionFlow.execute({
    finalPromptSource,
    imageOptions,
    referenceImages,
    countMetadata,
    generationItems,
    streamOptions,
    deliveryPlan,
    imageTask,
    presentation,
    referenceContext,
    resolvedImageSelectionOverride,
  });

  return { imageExecutionFlow, executeImagePayload };
}

export function createAgentSkillRuntimeContext(scope) {
  const {
    interactionService,
    getSelectedSkill,
    getSkillContent,
    setSkillContent,
    setSkillContentHash,
    getImagegenHostContent,
    setImagegenHostContent,
    setImagegenHostContentHash,
    imagegenHostSkillId,
  } = scope;
  const ensureSelectedSkillContent = async () => {
    const selectedSkill = getSelectedSkill();
    const current = getSkillContent();
    if (!selectedSkill || current) return current;
    const loaded = await interactionService.loadSkill(selectedSkill.id);
    setSkillContent(loaded.content);
    setSkillContentHash(loaded.contentHash);
    return loaded.content;
  };
  const ensureImagegenHostContent = async () => {
    const current = getImagegenHostContent();
    if (current) return current;
    const loaded = await interactionService.loadSkill(imagegenHostSkillId, { includeInternal: true });
    setImagegenHostContent(loaded.content);
    setImagegenHostContentHash(loaded.contentHash);
    return loaded.content;
  };
  const assertLockedImageSkill = async (skill, expectedHash) => {
    if (!skill) return '';
    const loaded = await interactionService.assertLockedSkill(skill, expectedHash);
    return loaded.contentHash;
  };
  return { ensureSelectedSkillContent, ensureImagegenHostContent, assertLockedImageSkill };
}
