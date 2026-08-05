import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const pageSource = fs.readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const globalStylesSource = fs.readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

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

test('chat input uses native contenteditable sizing without layout reads in the input handler', () => {
  const inputSource = sourceBetween(
    pageSource,
    'const handleChatEditorInput =',
    'const handleChatCompositionStart ='
  );
  const editorMarkup = sourceBetween(
    pageSource,
    'ref={chatInputEditorRef}',
    '<span\n                    ref={chatComposerPlaceholderRef}'
  );

  assert.equal(inputSource.includes('scrollHeight'), false);
  assert.equal(inputSource.includes('syncEditorHeight()'), false);
  assert.match(editorMarkup, /className="[^"]*workspace-chat-editor/);
  assert.match(globalStylesSource, /\.workspace-chat-editor\s*\{[\s\S]{0,160}min-height:\s*72px/);
  assert.match(globalStylesSource, /\.workspace-chat-editor\s*\{[\s\S]{0,160}max-height:\s*240px/);
  assert.match(globalStylesSource, /\.workspace-chat-editor\s*\{[\s\S]{0,160}overflow-y:\s*auto/);
  assert.doesNotMatch(editorMarkup, /style=\{\{[^}]*height/);
});

test('plain chat text bypasses structured composer parsing while token edits keep the structured path', () => {
  const inputSource = sourceBetween(
    pageSource,
    'const handleChatEditorInput =',
    'const handleChatCompositionStart ='
  );
  assert.match(pageSource, /const getPlainContentEditableText = \(root: HTMLElement\)/);
  assert.match(inputSource, /parseChatEditorSegments\(editor\)/);
  assert.match(inputSource, /getPlainContentEditableText\(editor\)/);
  assert.match(
    inputSource,
    /(?:activeSkill|resolvedChatReferenceTokens\.length)[\s\S]{0,240}\?[\s\S]{0,160}parseChatEditorSegments\(editor\)[\s\S]{0,160}getPlainContentEditableText\(editor\)/
  );
});

test('skill picker filters precomputed searchable text', () => {
  const filteringSource = sourceBetween(
    pageSource,
    'const filteredQuickActions = React.useMemo',
    'const [imageAspectRatio'
  );

  assert.match(pageSource, /interface SkillMenuAction\s*\{[\s\S]{0,180}searchText:\s*string/);
  assert.match(pageSource, /searchText:\s*`[^\n]*(?:id|label|description)/);
  assert.match(filteringSource, /action\.searchText\.includes\(query\)/);
  assert.doesNotMatch(filteringSource, /action\.(?:id|label|description)[\s\S]{0,120}toLocaleLowerCase/);
});

test('skill picker scrolls active options only after keyboard navigation', () => {
  const scrollCallIndex = pageSource.indexOf("document.getElementById(`skill-option-${activeAction.id}`)");
  const scrollingSource = pageSource.slice(
    pageSource.lastIndexOf('useEffect(() => {', scrollCallIndex),
    pageSource.indexOf('useGSAP(', scrollCallIndex)
  );

  assert.match(scrollingSource, /keyboard/i);
  assert.match(scrollingSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
});

test('skill keyboard selection reads synchronous query and index refs', () => {
  const keyDownSource = sourceBetween(
    pageSource,
    'const handleChatEditorKeyDown =',
    'const removeChatReferenceToken ='
  );

  assert.match(pageSource, /const skillMenuQueryRef = useRef\(''\)/);
  assert.match(pageSource, /const skillMenuActiveIndexRef = useRef\(0\)/);
  assert.match(keyDownSource, /latestQuery = skillMenuQueryRef\.current/);
  assert.match(keyDownSource, /skillMenuActiveIndexRef\.current = nextIndex/);
  assert.match(keyDownSource, /latestFilteredQuickActions\[skillMenuActiveIndexRef\.current\]/);
});

test('skill pointer hover updates highlight synchronously', () => {
  const listStart = pageSource.indexOf('{filteredQuickActions.map((action, index) => {');
  const hoverStart = pageSource.indexOf('onMouseEnter={(event) => {', listStart);
  const hoverEnd = pageSource.indexOf('onClick={() => {', hoverStart);
  const hoverSource = pageSource.slice(hoverStart, hoverEnd);

  assert.match(hoverSource, /skillMenuActiveIndexRef\.current = index/);
  assert.match(hoverSource, /classList\.remove\('is-selected'\)/);
  assert.match(hoverSource, /classList\.add\('is-selected'\)/);
  assert.match(hoverSource, /setAttribute\('aria-selected', 'false'\)/);
  assert.match(hoverSource, /setAttribute\('aria-selected', 'true'\)/);
  assert.doesNotMatch(hoverSource, /setSkillMenuActiveIndex/);
  assert.doesNotMatch(hoverSource, /startTransition/);
  assert.doesNotMatch(hoverSource, /skillMenuKeyboardNavigationRef/);
  assert.doesNotMatch(hoverSource, /skillMenuTrigger === 'slash'/);
  assert.match(pageSource, /const isHighlighted = skillMenuActiveIndex === index/);
  assert.match(pageSource, /id="skill-menu-listbox"\s*data-gsap-motion-exclude="true"/);
});

test('skill selection continues updating the active topic', () => {
  const topicUpdateSource = sourceBetween(
    pageSource,
    'const setActiveSkillForCurrentTopic =',
    'const createNewTopic ='
  );

  assert.match(topicUpdateSource, /topic\.id === session\.activeTopicId/);
  assert.match(topicUpdateSource, /activeSkill:\s*skill/);
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
