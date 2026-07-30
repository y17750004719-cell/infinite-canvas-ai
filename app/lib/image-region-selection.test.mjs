import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentRegionSelectionSnapshot,
  buildRegionBox,
  buildRegionEvidenceCrop,
  buildRegionRecognitionPrompt,
  canvasPointToImageNormalized,
  imageNormalizedToItemLocal,
  normalizeLocateCandidates,
  parseLocateModelResponse,
} from './image-region-selection.mjs';

test('contain mapping rejects letterbox clicks and round-trips image points', () => {
  const input = {
    item: { x: 100, y: 50, width: 400, height: 400, rotation: 0 },
    content: { x: 0, y: 0, width: 400, height: 400 },
    naturalWidth: 400,
    naturalHeight: 200,
    fit: 'contain',
  };
  assert.equal(canvasPointToImageNormalized({ ...input, canvasPoint: { x: 300, y: 80 } }), null);
  const normalized = canvasPointToImageNormalized({ ...input, canvasPoint: { x: 300, y: 250 } });
  assert.deepEqual(normalized, { x: 0.5, y: 0.5 });
  assert.deepEqual(imageNormalizedToItemLocal({ ...input, point: normalized }), { x: 200, y: 200 });
});

test('mapping accounts for item rotation', () => {
  const normalized = canvasPointToImageNormalized({
    canvasPoint: { x: 250, y: 200 },
    item: { x: 100, y: 100, width: 200, height: 100, rotation: 90 },
    content: { x: 0, y: 0, width: 200, height: 100 },
    naturalWidth: 200,
    naturalHeight: 100,
    fit: 'contain',
  });
  assert.deepEqual(normalized, { x: 0.75, y: 0 });
});

test('region boxes normalize drag direction and bounds', () => {
  assert.deepEqual(buildRegionBox({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 }), {
    x: 0.2,
    y: 0.1,
    width: 0.6,
    height: 0.6,
  });
});

test('point evidence crops stay square in source pixels and clamp to image bounds', () => {
  const crop = buildRegionEvidenceCrop({
    point: { x: 0.02, y: 0.5 },
    naturalWidth: 1600,
    naturalHeight: 800,
  });
  assert.ok(crop);
  assert.equal(crop.x, 0);
  assert.equal(Math.round(crop.width * 1600), Math.round(crop.height * 800));
});

test('box evidence crops add twenty percent context and clamp edges', () => {
  assert.deepEqual(buildRegionEvidenceCrop({
    point: { x: 0.85, y: 0.85 },
    box: { x: 0.7, y: 0.7, width: 0.25, height: 0.25 },
    naturalWidth: 1000,
    naturalHeight: 1000,
  }), {
    x: 0.65,
    y: 0.65,
    width: 0.35,
    height: 0.35,
  });
});

test('candidate normalization deduplicates and caps results', () => {
  const candidates = normalizeLocateCandidates({ candidates: [
    { id: '1', label: 'Tiger', aliases: ['cat'], confidence: 'high' },
    { id: '2', label: 'tiger', aliases: [], confidence: 'medium' },
    ...Array.from({ length: 8 }, (_, index) => ({ id: String(index + 3), label: `Candidate ${index}`, confidence: 'unknown' })),
  ] });
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0].label, 'Tiger');
  assert.equal(candidates[1].confidence, 'low');
});

test('region recognition prompt fixes image roles, coordinates, and JSON candidate rules', () => {
  const prompt = buildRegionRecognitionPrompt({
    mode: 'box',
    point: { x: 0.4, y: 0.5 },
    box: { x: 0.2, y: 0.3, width: 0.4, height: 0.4 },
    hasMarkedImage: true,
    hasCropImage: true,
  });
  assert.match(prompt, /original-image/);
  assert.match(prompt, /marked-location/);
  assert.match(prompt, /clean-region-crop/);
  assert.match(prompt, /矩形框：\{"x":0\.2,"y":0\.3,"width":0\.4,"height":0\.4\}/);
  assert.match(prompt, /返回 2 到 5 个候选/);
  assert.match(prompt, /不得把“换成花”“改成蓝色”/);
});

test('region recognition parses standard generate chat JSON and markdown JSON', () => {
  const result = {
    candidates: [
      { id: 'specific', label: '红色胶带', aliases: ['胶带'], confidence: 'high', description: '画面右侧的红色胶带' },
      { id: 'generic', label: '文具', aliases: [], confidence: 'medium', description: '红色卷状物' },
    ],
    selectedCandidateId: 'specific',
    lowConfidence: false,
  };
  const direct = parseLocateModelResponse({ result: { type: 'chat', content: JSON.stringify(result) } });
  const fenced = parseLocateModelResponse({ result: { type: 'chat', content: `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`` } });
  assert.deepEqual(direct, fenced);
  assert.equal(direct.selectedCandidateId, 'specific');
});

test('region recognition rejects invalid JSON and fewer than two candidates', () => {
  assert.throws(() => parseLocateModelResponse({ result: { type: 'chat', content: 'not json' } }));
  assert.throws(() => parseLocateModelResponse({
    result: {
      type: 'chat',
      content: JSON.stringify({
        candidates: [{ id: 'only', label: '对象', aliases: [], confidence: 'high', description: '唯一候选' }],
        selectedCandidateId: 'only',
        lowConfidence: false,
      }),
    },
  }), /至少两个/);
});

test('agent region snapshots preserve live selections before composer cleanup', () => {
  const result = buildAgentRegionSelectionSnapshot({
    references: [
      {
        id: 'region-reference:region-a',
        role: 'region_target',
        regionId: 'region-a',
        canvasItemId: 'image-a',
        label: '老虎',
        targetPoint: { x: 0.3, y: 0.4 },
      },
    ],
    regions: [
      {
        id: 'region-a',
        imageItemId: 'image-a',
        imageSrc: '/image.png',
        mode: 'box',
        point: { x: 0.32, y: 0.45 },
        box: { x: 0.2, y: 0.25, width: 0.3, height: 0.4 },
        candidates: [{ id: 'tiger', label: '戴墨镜的老虎', aliases: [], confidence: 'high' }],
        selectedCandidateId: 'tiger',
        confirmationStatus: 'confirmed',
        status: 'ready',
      },
    ],
  });
  assert.deepEqual(result, {
    regionSelections: [{
      regionId: 'region-a',
      imageItemId: 'image-a',
      point: { x: 0.32, y: 0.45 },
      box: { x: 0.2, y: 0.25, width: 0.3, height: 0.4 },
      label: '戴墨镜的老虎',
      candidateId: 'tiger',
      confidence: 'high',
    }],
    missingRegionIds: [],
  });
});

test('agent region snapshots rebuild historical regions from persisted target tokens', () => {
  const result = buildAgentRegionSelectionSnapshot({
    references: [
      {
        id: 'region-reference:region-a',
        role: 'region_target',
        regionId: 'region-a',
        canvasItemId: 'image-a',
        label: '左侧老虎',
        candidateId: 'candidate-a',
        confirmationStatus: 'confirmed',
        aliases: ['左虎'],
        description: '画面左侧戴墨镜的老虎',
        confidence: 'medium',
        targetPoint: { x: 0.2, y: 0.5 },
        targetBox: { x: 0.1, y: 0.2, width: 0.25, height: 0.5 },
      },
      {
        id: 'region-reference:region-b',
        role: 'region_target',
        regionId: 'region-b',
        canvasItemId: 'image-a',
        label: '右侧老虎',
        confirmationStatus: 'confirmed',
        targetPoint: { x: 0.75, y: 0.5 },
      },
    ],
    regions: [],
  });
  assert.equal(result.regionSelections.length, 2);
  assert.equal(result.regionSelections[0].candidateId, 'candidate-a');
  assert.deepEqual(result.regionSelections[0].aliases, ['左虎']);
  assert.equal(result.regionSelections[0].description, '画面左侧戴墨镜的老虎');
  assert.equal(result.regionSelections[0].confidence, 'medium');
  assert.equal(result.regionSelections[1].regionId, 'region-b');
  assert.deepEqual(result.missingRegionIds, []);
});

test('agent region snapshots recover from incomplete live state using persisted token geometry', () => {
  const result = buildAgentRegionSelectionSnapshot({
    references: [{
      id: 'region-reference:region-a',
      role: 'region_target',
      regionId: 'region-a',
      canvasItemId: 'image-a',
      label: '左侧老虎',
      confirmationStatus: 'confirmed',
      targetPoint: { x: 0.25, y: 0.5 },
      targetBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.5 },
    }],
    regions: [{
      id: 'region-a',
      imageItemId: 'image-a',
      imageSrc: '/image.png',
      mode: 'point',
      point: null,
      candidates: [],
      status: 'failed',
    }],
  });
  assert.deepEqual(result.regionSelections[0], {
    regionId: 'region-a',
    imageItemId: 'image-a',
    point: { x: 0.25, y: 0.5 },
    box: { x: 0.1, y: 0.2, width: 0.3, height: 0.5 },
    label: '左侧老虎',
  });
  assert.deepEqual(result.missingRegionIds, []);
});

test('agent region snapshots exclude pending and legacy unconfirmed selections', () => {
  const result = buildAgentRegionSelectionSnapshot({
    references: [
      { id: 'pending', role: 'region_target', regionId: 'region-a', canvasItemId: 'image-a', label: '老虎', targetPoint: { x: 0.2, y: 0.3 }, confirmationStatus: 'pending' },
      { id: 'legacy', role: 'region_target', regionId: 'region-b', canvasItemId: 'image-a', label: '狮子', targetPoint: { x: 0.7, y: 0.3 } },
    ],
  });
  assert.deepEqual(result, { regionSelections: [], missingRegionIds: [] });
});

test('agent region snapshots report unrecoverable target tokens', () => {
  const result = buildAgentRegionSelectionSnapshot({
    references: [
      { id: 'broken-region', role: 'region_target', regionId: 'region-a', label: '老虎', confirmationStatus: 'confirmed' },
      { id: 'missing-id', role: 'region_target', label: '狮子' },
    ],
  });
  assert.deepEqual(result.regionSelections, []);
  assert.deepEqual(result.missingRegionIds, ['region-a', 'missing-id']);
});
