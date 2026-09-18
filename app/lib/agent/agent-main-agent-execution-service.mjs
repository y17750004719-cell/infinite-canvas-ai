import { prepareNativeTurnFlow } from './agent-native-turn-flow.mjs';

/* Request-scoped orchestration for a single Main Agent native turn. */
export async function executeMainAgentTurn(scope) {
  const {
    mainAgentRegistry,
    selectedSkill,
    approvedConfirmation,
    recoveryCandidateForAgent,
    recoveryRevisionMessage,
    agentAnalysis,
    runMainAgent,
    prepareContext,
    buildNativeRequest,
    onSkillSelection,
    eventHandlers,
    toolCallbackOptions,
    startKeepalive,
    hasImageResult,
    toolCallCount,
  } = scope;

  const standardMainAgentToolNames = [
    'todo_read',
    'todo_update',
    'read_relevant_context',
    'submit_agent_analysis_checkpoint',
    'request_user_decision',
    ...(recoveryCandidateForAgent ? ['handle_failed_task'] : []),
  ];
  const activatedSkillToolNames = selectedSkill
    ? selectedSkill.allowedTools.filter((name) => name === 'get_canvas_context')
    : ['get_canvas_context'];
  const resolveToolNames = () => [
    ...standardMainAgentToolNames.filter((name) => (
      name !== 'submit_agent_analysis_checkpoint' || (agentAnalysis?.checkpointCount || 0) < 3
    )),
    'generate_image',
    ...activatedSkillToolNames,
    ...(recoveryRevisionMessage ? ['rewind_agent_analysis'] : []),
    ...(scope.relevantContextCandidateIds?.size >= 2 ? ['request_context_selection'] : []),
    'load_visual_reference',
  ].filter(Boolean);

  const toolNames = [
    ...standardMainAgentToolNames,
    'generate_image',
    ...activatedSkillToolNames,
    'rewind_agent_analysis',
    'request_context_selection',
    'load_visual_reference',
  ];
  const mainAgentTools = scope.getAgentModelTools(mainAgentRegistry, toolNames);

  const nativeTurn = async () => {
    scope.incrementRequestCount?.();
    const prepared = await prepareNativeTurnFlow({
      ...scope.nativeTurnContext,
      prepareContext,
      eventHandlers: scope.nativeContextEventHandlers,
    });
    return runMainAgent({
      mainAgentTools,
      resolveToolNames,
      approvedConfirmation,
      selectedSkill,
      prepareTurn: async () => prepared,
      buildRequest: ({ nativeTools: availableTools, preparedContext, onEvent }) => buildNativeRequest({
        nativeTools: availableTools,
        preparedContext,
        onEvent,
      }),
      startKeepalive,
      toolCallbackOptions: {
        ...toolCallbackOptions,
        resolveAllowedTools: resolveToolNames,
        executionContext: {
          ...toolCallbackOptions.executionContext,
          allowedTools: resolveToolNames(),
          confirmed: Boolean(approvedConfirmation),
          confirmationId: approvedConfirmation?.confirmationId,
        },
        onSkillSelection,
      },
      eventHandlers,
      hasImageResult,
      toolCallCount,
    });
  };

  const loopResult = await nativeTurn();
  return { loopResult, mainAgentTools, resolveToolNames };
}
