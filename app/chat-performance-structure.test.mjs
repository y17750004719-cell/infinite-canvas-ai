import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pageSource = fs.readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

const sourceBetween = (source, start, end) => source.slice(
  source.indexOf(start),
  source.indexOf(end, source.indexOf(start))
);

test('chat typing stays outside the workspace React state hot path', () => {
  const inputSource = sourceBetween(
    pageSource,
    'const handleChatEditorInput =',
    'const handleSelectedTextCardPanelInputChange ='
  );

  assert.equal(inputSource.includes('latestChatInputRef.current = editorText;'), true);
  assert.equal(inputSource.includes('setChatInput(editorText);'), false);
  assert.equal(inputSource.includes('syncChatComposerControls(editorText);'), true);

  const pasteSource = sourceBetween(
    pageSource,
    'const handleChatPaste =',
    'const handleChatEditorInput ='
  );
  assert.equal(pasteSource.includes('setChatInput(editorText);'), false);
  assert.equal(pasteSource.includes('latestChatInputRef.current = editorText;'), true);
});

test('chat editor protects IME composition from external DOM synchronization', () => {
  assert.equal(pageSource.includes('const isChatInputComposingRef = useRef(false);'), true);
  assert.equal(pageSource.includes('const pendingChatEditorSyncRef = useRef(false);'), true);
  assert.equal(pageSource.includes('const pendingProgrammaticChatInputRef = useRef<string | null>(null);'), true);
  assert.equal(pageSource.includes('onCompositionStart={handleChatCompositionStart}'), true);
  assert.equal(pageSource.includes('onCompositionEnd={handleChatCompositionEnd}'), true);

  const syncSource = sourceBetween(
    pageSource,
    'const syncEditorTextFromState = useCallback',
    'const isCaretAtEditorStart ='
  );
  assert.equal(syncSource.includes('if (isChatInputComposingRef.current) {'), true);
  assert.equal(syncSource.includes('pendingChatEditorSyncRef.current = true;'), true);

  const keyDownSource = sourceBetween(
    pageSource,
    'const handleChatEditorKeyDown =',
    'const removeChatReferenceToken ='
  );
  assert.equal(keyDownSource.includes('e.nativeEvent.isComposing || isChatInputComposingRef.current'), true);
  assert.ok(
    keyDownSource.indexOf('e.nativeEvent.isComposing || isChatInputComposingRef.current')
      < keyDownSource.indexOf("e.key === 'Enter'")
  );

  const compositionEndSource = sourceBetween(
    pageSource,
    'const handleChatCompositionEnd =',
    'const handleSelectedTextCardPanelInputChange ='
  );
  assert.equal(compositionEndSource.includes('pendingProgrammaticChatInputRef.current'), true);
  assert.equal(compositionEndSource.includes('syncEditorTextFromState(latestChatInputRef.current'), true);
});

test('stream metadata and progress updates share one bounded message batch', () => {
  assert.equal(pageSource.includes("from './lib/chat-stream-update-batcher.mjs'"), true);
  assert.equal(pageSource.includes('const pendingChatMessageUpdatesRef = useRef('), true);
  assert.equal(pageSource.includes('applyQueuedChatMessageUpdates(prev, queuedUpdates)'), true);
  assert.equal(pageSource.includes('setTimeout(flushQueuedChatMessageUpdates, 64)'), true);

  const updateSource = sourceBetween(
    pageSource,
    'const updateChatMessageById =',
    'const updatePendingAssistantMessage ='
  );
  assert.equal(updateSource.includes('setChatMessages((prev) => prev.map('), false);
  assert.equal(updateSource.includes('pendingChatMessageUpdatesRef.current'), true);
  assert.equal(updateSource.includes('scheduleQueuedChatMessageUpdates();'), true);
});

test('generated asset streaming uses the bounded preload queue instead of blocking the reader on a batch', () => {
  assert.equal(pageSource.includes("from './lib/generated-asset-preload-queue.mjs'"), true);
  assert.equal(pageSource.includes('runGeneratedAssetPreloadQueue('), true);

  const assetSource = sourceBetween(
    pageSource,
    "if (event.type === 'client_action' && event.action?.type === 'add_generated_assets')",
    "if (event.type === 'agent_completion_summary')"
  );
  assert.equal(assetSource.includes('await preloadGeneratedAssets(freshAssets'), false);
  assert.equal(assetSource.includes('generatedAssetPreloadChain = generatedAssetPreloadChain.then(async () => {'), true);
  assert.ok(
    assetSource.indexOf('generatedAssetPreloadChain = generatedAssetPreloadChain.then(async () => {')
      < assetSource.indexOf('await runGeneratedAssetPreloadQueue(')
  );
  assert.ok(pageSource.indexOf('await generatedAssetPreloadChain;') > pageSource.indexOf("if (event.type === 'agent_completion_summary')"));
  assert.equal(assetSource.includes('concurrency: 2'), true);
  assert.equal(assetSource.includes('signal: controller.signal'), true);
});

test('workspace commit performance is sampled only through the existing development performance switch', () => {
  assert.equal(pageSource.includes('const handleWorkspaceProfilerRender = useCallback'), true);
  assert.equal(pageSource.includes("console.info('[workspace-commit-perf]'"), true);
  assert.equal(pageSource.includes('<React.Profiler id="workspace-performance" onRender={handleWorkspaceProfilerRender}>'), true);
});

test('chat scroll contextSafe wrapper remains analyzable by the hooks rule', () => {
  assert.equal(pageSource.includes('const scrollChatToBottom = React.useMemo(() => workspaceContextSafe('), true);
});

test('skill job polling declares its stable state update dependencies', () => {
  const pollingSource = sourceBetween(
    pageSource,
    'useEffect(() => {\n    if (!activeSkillJobId) return;',
    'const handleWorkspaceProfilerRender = useCallback'
  );
  const dependencySource = pollingSource.slice(pollingSource.lastIndexOf('}, ['));
  assert.equal(dependencySource.includes('setChatMessages'), true);
  assert.equal(dependencySource.includes('setItems'), true);
  assert.equal(dependencySource.includes('updateChatMessageById'), true);
});
