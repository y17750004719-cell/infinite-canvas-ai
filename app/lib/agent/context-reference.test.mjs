import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentContextEntities,
  compileExecutionBrief,
  ensureOptimizedPromptCoverage,
  extractLegacyProposal,
  isReferentialShorthand,
  parseAgentProposalBlock,
  resolveContextReference,
} from './context-reference.mjs';

const proposal = {
  version: 1,
  id: 'covers',
  title: '封面方向',
  intent: 'image',
  requiresSelection: true,
  options: [
    { id: 'one', entityId: 'covers:one', index: 1, label: '绅士双兔', aliases: ['The Rabbit Duo'], brief: '两只兔子穿时装拍摄 Vogue 封面。', mustPreserve: ['两只兔子'], referenceImageUrls: [], canvasItemIds: [] },
    { id: 'two', entityId: 'covers:two', index: 2, label: '优雅双猫', aliases: ['The Cat Duo'], brief: '两只猫穿高级时装拍摄 Vogue 封面。', mustPreserve: ['两只猫'], referenceImageUrls: [], canvasItemIds: [] },
    { id: 'three', entityId: 'covers:three', index: 3, label: '先锋双犬（The Dog Duo）', aliases: ['The Dog Duo', 'Vol.3'], brief: '两只德牧或杜宾穿解构主义宽肩西装，在冷酷棚拍环境中拍摄 Vogue 封面。', mustPreserve: ['两只德牧或杜宾', '解构主义宽肩西装'], referenceImageUrls: [], canvasItemIds: [] },
  ],
};

test('parses and removes structured executable proposal blocks', () => {
  const raw = `请选择方向。\n<<agent_proposal>>${JSON.stringify(proposal)}<</agent_proposal>>`;
  const result = parseAgentProposalBlock(raw);
  assert.equal(result.cleanContent, '请选择方向。');
  assert.equal(result.proposal?.options.length, 3);
  assert.equal(result.proposal?.options[2].entityId, 'covers:three');
});

test('resolves numbered label and alias references to one authoritative entity', () => {
  const entities = buildAgentContextEntities({ messages: [{ id: 'assistant-1', role: 'assistant', content: '请选择方向', agentProposal: proposal }] });
  for (const userMessage of ['按照3生成图片', 'Vol.3 出图', '先锋双犬生成', '用 The Dog Duo']) {
    const result = resolveContextReference({ userMessage, entities });
    assert.equal(result.status, 'resolved', userMessage);
    assert.equal(result.candidates[0].id, 'covers:three');
  }
});

test('keeps literal numbers and aspect ratios out of reference resolution', () => {
  const entities = buildAgentContextEntities({ messages: [{ id: 'assistant-1', role: 'assistant', content: '', agentProposal: proposal }] });
  assert.equal(resolveContextReference({ userMessage: '生成数字3海报', entities }).status, 'none');
  assert.equal(resolveContextReference({ userMessage: '生成一张3:4竖版封面', entities }).status, 'none');
  assert.equal(isReferentialShorthand('按照3生成图片'), true);
  assert.equal(isReferentialShorthand('生成数字3海报'), false);
});

test('does not treat a complete multi-issue brief as an old proposal selection', () => {
  const entities = buildAgentContextEntities({ messages: [{ id: 'assistant-1', role: 'assistant', content: '', agentProposal: proposal }] });
  const message = 'Vogue magazine cover with two rabbits. Please design a similar series for 5 copies. 《Vogue》杂志封面，主角是两只兔子，请设计一套类似的杂志，共5期。';
  assert.equal(resolveContextReference({ userMessage: message, entities }).status, 'none');
});

test('returns ambiguity when two proposal groups share the same ordinal', () => {
  const secondProposal = { ...proposal, id: 'posters', options: proposal.options.map((option) => ({ ...option, entityId: `posters:${option.id}` })) };
  const entities = buildAgentContextEntities({ messages: [
    { id: 'assistant-1', role: 'assistant', content: '', agentProposal: proposal },
    { id: 'assistant-2', role: 'assistant', content: '', agentProposal: secondProposal },
  ] });
  const result = resolveContextReference({ userMessage: '按照3生成图片', entities });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('extracts legacy markdown tables only when they are actionable proposals', () => {
  const legacy = extractLegacyProposal({
    id: 'legacy-message',
    content: '建议按以下方向生成，请确认：\n| Vol.1 | 绅士双兔 | 两只兔子穿西装 |\n| --- | --- | --- |\n| Vol.2 | 优雅双猫 | 两只猫穿礼服 |\n| Vol.3 | 先锋双犬 | 德牧或杜宾，解构主义宽肩西装 |',
  });
  assert.equal(legacy?.options.length, 3);
  assert.match(legacy?.options[2].brief || '', /德牧或杜宾/);
  assert.equal(extractLegacyProposal({ id: 'knowledge', content: '| 年份 | 销量 |\n| 2024 | 10 |\n| 2025 | 12 |' }), null);
});

test('compiles selected context into an authoritative brief and restores missing anchors', () => {
  const entities = buildAgentContextEntities({ messages: [{ id: 'assistant-1', role: 'assistant', content: '', agentProposal: proposal }] });
  const contextResolution = resolveContextReference({ userMessage: '按照3生成图片，背景改成红色', entities });
  const brief = compileExecutionBrief({ userMessage: '按照3生成图片，背景改成红色', contextResolution });
  assert.match(brief.plainText, /两只德牧或杜宾/);
  assert.match(brief.plainText, /背景改成红色/);
  const prompt = ensureOptimizedPromptCoverage('A fashion magazine cover on a red background.', brief);
  assert.match(prompt, /Authoritative requirements/);
  assert.match(prompt, /解构主义宽肩西装/);
});

test('resolves generated images and selected canvas objects without using image binaries as text', () => {
  const entities = buildAgentContextEntities({
    messages: [{ id: 'image-message', role: 'assistant', content: '', imageUrl: '/image-8.png', imageName: 'image 8' }],
    canvasItems: [{ id: 'canvas-image', type: 'image', src: '/canvas.png', x: 20, y: 0 }],
    selectedItemIds: ['canvas-image'],
  });
  assert.equal(resolveContextReference({ userMessage: '用 image 8 继续生成', entities }).candidates[0].assetUrl, '/image-8.png');
  assert.equal(resolveContextReference({ userMessage: '参考选中的图片生成', entities }).candidates[0].assetUrl, '/canvas.png');
});

test('recency pronouns prefer the most recently resolved entity over an unresolved proposal group', () => {
  const entities = buildAgentContextEntities({ messages: [
    { id: 'proposal-message', role: 'assistant', content: '', agentProposal: proposal },
    { id: 'resolved-message', role: 'assistant', content: '', resolvedContext: { entityIds: ['covers:three'], labels: ['先锋双犬'], kind: 'proposal_option', confidence: 'high' } },
  ] });
  const result = resolveContextReference({ userMessage: '继续用上一个方案生成', entities });
  assert.equal(result.status, 'resolved');
  assert.equal(result.candidates[0].id, 'covers:three');
});
