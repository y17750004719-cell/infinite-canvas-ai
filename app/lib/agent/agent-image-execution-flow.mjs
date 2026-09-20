import {
  executeImageBatch,
  persistImageAssets,
  requestImageGeneration,
} from './agent-image-pipeline-service.mjs';
import { executeNativeBusinessOperation } from './native-business-ledger.mjs';
import { enrichGeneratedAssetDeliveryAction } from './generated-asset-delivery.mjs';

/**
 * Request-level image execution boundary.
 *
 * The runtime supplies adapters for application state and event delivery. The
 * flow owns the image-specific lifecycle: request fan-out, durable execution,
 * provider dispatch, partial results, and asset delivery. Keeping those
 * decisions here makes image execution usable by native tool calls and
 * continuation turns without importing request-runtime internals.
 */
export function createAgentImageExecutionFlow(dependencies = {}) {
  const {
    flush = async () => {},
    resolveSelection,
    resolveReferences,
    buildRequests,
    resolveExecutionMode = () => 'serial',
    reserveTask = () => null,
    executeBusinessOperation = executeNativeBusinessOperation,
    persistAsset,
    emit = () => {},
    writeProgress = () => {},
    writeLog = () => {},
    recordSucceeded = () => {},
    heartbeat = () => () => {},
    buildPromptTrace = () => ({}),
    generatedAssetsFromResult = (payload) => payload?.result?.outputs || [],
    hashPrompt = (value) => String(value || ''),
    makePartialFailureMessage = ({ requestedCount, completedCount, requestFailureCount }) => (
      requestFailureCount > 0 ? `实际完成 ${completedCount}/${requestedCount} 张。` : ''
    ),
    materializeAsset = persistAsset,
    requestProvider = requestImageGeneration,
    signal,
    request,
    runId,
    sessionId,
    taskId,
    operationId,
  } = dependencies;

  async function execute(input = {}) {
    await flush();
    const {
      finalPromptSource,
      imageOptions = {},
      referenceImages = [],
      countMetadata = {},
      generationItems = [],
      streamOptions = {},
      deliveryPlan,
      imageTask,
      presentation,
      referenceContext,
      resolvedImageSelectionOverride,
    } = input;

    const prompt = String(finalPromptSource || '').trim();
    if (!prompt) throw new Error('Main Agent returned an empty image prompt');

    const outputCount = Number(countMetadata.totalCount) > 0
      ? Number(countMetadata.totalCount)
      : Math.max(1, Number(imageOptions.count) || 1);
    const selection = await resolveSelection({
      imageOptions,
      override: resolvedImageSelectionOverride,
    });
    const resolvedReferences = await resolveReferences({
      referenceContext,
      referenceImages,
      imageTask,
    });
    const items = generationItems.length
      ? generationItems
      : outputCount > 1
        ? Array.from({ length: outputCount }, (_, index) => ({
            id: `${deliveryPlan?.mode || 'variant'}-${index + 1}`,
            index: index + 1,
            label: `图片 ${index + 1}`,
            prompt,
          }))
        : [];
    const built = await buildRequests({
      prompt,
      items,
      imageOptions,
      references: resolvedReferences,
      selection,
      outputCount,
    });
    const requests = Array.isArray(built?.requests) ? built.requests : [];
    if (!requests.length) throw new Error('Image generation request is empty');
    if (requests.length !== outputCount) {
      throw new Error(`图片请求数量不一致：要求 ${outputCount} 张，实际创建 ${requests.length} 个任务。`);
    }

    const reservation = await reserveTask({
      imageTask,
      outputCount,
      requests,
      runId,
      taskId,
    });
    const toolCallId = streamOptions.toolCallId;
    const stopHeartbeat = toolCallId ? heartbeat(toolCallId) : () => {};
    let providerCalled = false;
    let settled = 0;
    const materializedAssetsByIndex = new Map();
    const providerReturnedAtByIndex = new Map();
    const progressivelyEmittedIndices = new Set();
    const deliverAssets = async (assets) => {
      if (!assets.length) return;
      emit({ type: 'client_action', action: { type: 'register_session_visual_assets', sessionId, assets } });
      const action = enrichGeneratedAssetDeliveryAction({
        type: 'add_generated_assets', runId, taskId: reservation?.taskId || taskId,
        batchId: reservation?.latestBatchId,
        providerId: selection.selection?.providerId || selection.providerId,
        model: selection.selection?.model || selection.model,
        assets: assets.map((asset) => ({
          ...asset, src: asset.durableSrc || asset.src, assetId: asset.assetId || asset.id,
        })),
        ...(presentation ? { presentation: {
          title: presentation.title, summary: presentation.completionSummary,
          operation: imageTask?.operation === 'edit' ? 'edit' : 'generate',
        } } : {}),
        ...(imageTask?.sourceReferenceId ? { sourceReferenceId: imageTask.sourceReferenceId } : {}),
      });
      emit({ type: 'client_action', action });
      // Persist the delivery event before returning control to Native. Its
      // final response may fail, but the saved image must remain replayable.
      await flush();
      writeLog('image.delivery_queued', {
        runId, toolCallId, assetCount: assets.length,
        deliveryEventAt: action.deliveryEventAt,
        deliveryIds: action.assets.map((asset) => asset.deliveryId),
      });
    };

    try {
      requests.forEach((requestBody, index) => {
        const supplierPrompt = String(requestBody?.messages?.[0]?.content || '');
        emit({
          type: 'image_prompts_ready',
          index,
          label: items[index]?.label || `图片 ${index + 1}`,
          prompt: supplierPrompt,
          promptHash: hashPrompt(supplierPrompt),
          ...(toolCallId ? { toolCallId } : {}),
        });
      });
      writeLog('image.requests_built', {
        runId,
        toolCallId,
        selectedSkillId: imageTask?.selectedSkillId || null,
        commentarySource: streamOptions.commentarySource || null,
        commentaryFallbackUsed: streamOptions.commentaryFallbackUsed === true,
        executionReached: true,
        providerRequestStarted: false,
        assetCount: 0,
        failureStage: null,
        requestedCount: outputCount,
        actualRequestCount: requests.length,
        providerReceivedImage: requests.some((item) => Array.isArray(item?.reference_images)
          && item.reference_images.some((src) => typeof src === 'string' && src.trim())),
      });

      const taskResults = await executeImageBatch({
        requests,
        executionMode: resolveExecutionMode({ selection, imageOptions, deliveryPlan }),
        runTask: async (requestBody) => {
          const index = requests.indexOf(requestBody);
          const slot = reservation?.identities?.[index]?.slotId || String(index);
          const run = async () => {
            providerCalled = true;
            writeLog('image.provider_request_started', {
              runId,
              toolCallId,
              selectedSkillId: imageTask?.selectedSkillId || null,
              commentarySource: streamOptions.commentarySource || null,
              commentaryFallbackUsed: streamOptions.commentaryFallbackUsed === true,
              executionReached: true,
              providerRequestStarted: true,
              assetCount: 0,
              failureStage: 'provider_request',
            });
            writeProgress({
              stepId: 'generate_image',
              phase: 'generating',
              status: 'active',
              label: '正在调用图片供应商',
              ...(toolCallId ? { toolCallId } : {}),
              toolName: 'generate_image',
            });
            const payload = await requestProvider({
              request,
              signal,
              body: { ...requestBody, cancelWithRequest: true },
              toolCallId,
              commentarySource: streamOptions.commentarySource || null,
              commentaryFallbackUsed: streamOptions.commentaryFallbackUsed === true,
            });
            providerReturnedAtByIndex.set(index, Date.now());
            if (payload?.status !== 'completed') throw new Error('Image generation returned an incomplete result');
            return payload;
          };
          const recorded = typeof executeBusinessOperation === 'function'
            ? await executeBusinessOperation({
                sessionId,
                taskId: reservation?.taskId || taskId,
                operationId: `${operationId || runId}:image:${slot}`,
                runId,
                signal,
                contract: { request: requestBody },
              }, run)
            : await run();
          return recorded?.payload || recorded;
        },
        onSettled: streamOptions.enabled === true && requests.length > 1
          ? async (result, index) => {
              settled += 1;
              writeProgress({
                stepId: 'generate_image',
                phase: 'generating',
                status: 'active',
                label: `正在生成图片（${settled}/${requests.length}）`,
                ...(toolCallId ? { toolCallId } : {}),
                toolName: 'generate_image',
              });
              if (result.status === 'fulfilled') {
                const assets = generatedAssetsFromResult(result.value);
                if (assets.length && typeof materializeAsset === 'function') {
                  const enrichedAssets = assets.map((asset) => ({
                    ...asset,
                    providerReturnedAt: providerReturnedAtByIndex.get(index),
                    promptTrace: buildPromptTrace(index, prompt, requests[index], imageTask),
                    ...(reservation?.identities?.[index] || {}),
                  }));
                  const durable = (await persistImageAssets({ assets: enrichedAssets, persist: materializeAsset }))
                    .map((asset) => ({ ...asset, locallyStoredAt: asset.locallyStoredAt || Date.now() }));
                  materializedAssetsByIndex.set(index, durable);
                  progressivelyEmittedIndices.add(index);
                  await deliverAssets(durable);
                }
              }
              return index;
            }
          : undefined,
      });

      const usable = taskResults.map((result) => result.status === 'fulfilled'
        ? generatedAssetsFromResult(result.value)
        : []);
      const successfulPayloads = taskResults.flatMap((result, index) => (
        result.status === 'fulfilled' && usable[index].length ? [result.value] : []
      ));
      const requestFailureCount = requests.length - successfulPayloads.length;
      if (!successfulPayloads.length) {
        const firstFailure = taskResults.find((result) => result.status === 'rejected');
        if (firstFailure?.reason) throw firstFailure.reason;
        throw Object.assign(new Error('Image generation returned no usable outputs'), {
          failureStage: 'local_delivery',
          providerRequestStarted: providerCalled,
          assetCount: 0,
        });
      }

      const assetsByIndex = usable.map((requestAssets, index) => requestAssets.map((asset) => ({
          ...asset,
          providerReturnedAt: providerReturnedAtByIndex.get(index),
          promptTrace: buildPromptTrace(index, prompt, requests[index], imageTask),
          ...(reservation?.identities?.[index] || {}),
        })));
      const durableAssetsByIndex = typeof materializeAsset === 'function'
        ? await Promise.all(assetsByIndex.map(async (requestAssets, index) => {
            const cached = materializedAssetsByIndex.get(index);
            if (cached?.length) return cached;
            return (await persistImageAssets({ assets: requestAssets, persist: materializeAsset }))
              .map((asset) => ({ ...asset, locallyStoredAt: asset.locallyStoredAt || Date.now() }));
          }))
        : assetsByIndex;
      const durableAssets = Array.isArray(durableAssetsByIndex)
        ? durableAssetsByIndex.flat()
        : durableAssetsByIndex;
      const finalDeliveryAssets = Array.isArray(durableAssetsByIndex)
        ? durableAssetsByIndex.flatMap((entries, index) => progressivelyEmittedIndices.has(index) ? [] : entries)
        : durableAssets;
      recordSucceeded(durableAssets, reservation, selection, items);
      await deliverAssets(finalDeliveryAssets);
      const payload = {
        status: 'completed',
        assetDeliveryQueued: true,
        result: {
          type: 'image',
          outputs: durableAssets.map((asset) => ({
            localUrl: asset.durableSrc || asset.src,
            assetId: asset.assetId || asset.id,
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
            promptTrace: asset.promptTrace,
            ...(asset.slotId ? { slotId: asset.slotId } : {}),
            ...(asset.versionId ? { versionId: asset.versionId } : {}),
            ...(asset.providerReturnedAt ? { providerReturnedAt: asset.providerReturnedAt } : {}),
            ...(asset.locallyStoredAt ? { locallyStoredAt: asset.locallyStoredAt } : {}),
          })),
        },
        requestStats: {
          requested: requests.length,
          succeeded: successfulPayloads.length,
          failed: requestFailureCount,
        },
        partialFailureMessage: makePartialFailureMessage({
          requestedCount: requests.length,
          completedCount: successfulPayloads.length,
          requestFailureCount,
        }),
        ...(presentation ? {
          presentation: {
            title: presentation.title,
            summary: requestFailureCount > 0
              ? `${presentation.completionSummary} 实际完成 ${successfulPayloads.length}/${requests.length} 张。`
              : presentation.completionSummary,
            operation: imageTask?.operation === 'edit' ? 'edit' : 'generate',
          },
        } : {}),
        resolvedImageOptions: {
          ...(built.options || {}),
          providerId: selection.selection?.providerId || selection.providerId,
          model: selection.selection?.model || selection.model,
          requestedCount: outputCount,
          deliveryMode: deliveryPlan?.mode,
          panelCount: deliveryPlan?.panelCount,
        },
        providerCalled,
      };
      writeLog('image.execution_completed', {
        runId,
        toolCallId,
        selectedSkillId: imageTask?.selectedSkillId || null,
        commentarySource: streamOptions.commentarySource || null,
        commentaryFallbackUsed: streamOptions.commentaryFallbackUsed === true,
        executionReached: true,
        providerRequestStarted: providerCalled,
        assetCount: durableAssets.length,
        failureStage: null,
      });
      return payload;
    } catch (error) {
      writeLog('image.execution_failed', {
        runId,
        toolCallId,
        selectedSkillId: imageTask?.selectedSkillId || null,
        commentarySource: streamOptions.commentarySource || null,
        commentaryFallbackUsed: streamOptions.commentaryFallbackUsed === true,
        executionReached: true,
        providerRequestStarted: providerCalled,
        assetCount: 0,
        failureStage: error?.failureStage || (providerCalled ? 'provider_request' : 'tool_dispatch'),
      });
      throw error;
    } finally {
      stopHeartbeat();
    }
  }

  return { execute };
}
