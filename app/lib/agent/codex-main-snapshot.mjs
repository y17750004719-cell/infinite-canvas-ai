/**
 * Manual Codex Main runtime snapshot.
 *
 * This is deliberately metadata only: startup never fetches or replaces a
 * binary. The checked-in build manifest remains the executable integrity
 * authority; this file records the upstream revision the adapter targets.
 */
export const CODEX_MAIN_SNAPSHOT = Object.freeze({
  sourceCommit: '53c542d944c705f3a66780a19223223bee57cbb6',
  repository: '/Volumes/ZO/codex-main',
  wireApi: 'responses',
  protocolSchema: 'codex-rs/app-server-protocol',
  transport: 'stdio://',
  supportedRequests: Object.freeze([
    'initialize',
    'thread/start',
    'thread/resume',
    'thread/read',
    'thread/turns/list',
    'thread/items/list',
    'turn/start',
    'turn/steer',
    'turn/interrupt',
    'skills/list',
    'skills/extraRoots/set',
  ]),
  dynamicToolMethod: 'item/tool/call',
  lifecycleEvents: Object.freeze([
    'thread/started',
    'turn/started',
    'turn/completed',
    'turn/failed',
    'item/started',
    'item/updated',
    'item/completed',
    'item/agentMessage/delta',
    'item/reasoning/summaryTextDelta',
    'item/plan/delta',
    'error',
  ]),
  disabledFeatures: Object.freeze([
    'shell',
    'code_mode',
    'plugins',
    'mcp',
    'multi_agent',
    'image_generation',
    'realtime',
  ]),
});
