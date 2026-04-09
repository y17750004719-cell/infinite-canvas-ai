import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiNoImageErrorMessage,
  classifyGeminiImagePayload,
  extractGeminiImageOutputs,
  summarizeGeminiImagePayload,
} from './gemini-image-response.mjs';

const IMAGE_PART = {
  inlineData: {
    mimeType: 'image/png',
    data: 'ZmFrZS1pbWFnZQ==',
  },
};

test('extractGeminiImageOutputs returns data urls from inlineData parts', () => {
  assert.deepEqual(
    extractGeminiImageOutputs({
      candidates: [
        {
          content: {
            parts: [IMAGE_PART],
          },
        },
      ],
    }),
    [
      {
        url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
      },
    ]
  );
});

test('classifyGeminiImagePayload returns prompt_blocked when promptFeedback has a block reason', () => {
  const summary = summarizeGeminiImagePayload({
    promptFeedback: {
      blockReason: 'PROHIBITED_CONTENT',
    },
  });

  assert.equal(summary.promptBlockReason, 'PROHIBITED_CONTENT');
  assert.equal(classifyGeminiImagePayload(summary), 'prompt_blocked');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image blocked by prompt feedback'
  );
});

test('classifyGeminiImagePayload returns finish_reason_no_image for NO_IMAGE candidates', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        finishReason: 'NO_IMAGE',
        content: {
          parts: [],
        },
      },
    ],
  });

  assert.deepEqual(summary.finishReasons, ['NO_IMAGE']);
  assert.equal(classifyGeminiImagePayload(summary), 'finish_reason_no_image');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image finished without image output'
  );
});

test('classifyGeminiImagePayload returns image_safety_blocked for image safety finish reasons', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        finishReason: 'IMAGE_SAFETY',
        content: {
          parts: [],
        },
      },
    ],
  });

  assert.equal(classifyGeminiImagePayload(summary), 'image_safety_blocked');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image blocked by image safety policy'
  );
});

test('classifyGeminiImagePayload returns candidate_text_only when only text parts are present', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        content: {
          parts: [{ text: 'Image generation skipped for policy reasons.' }],
        },
      },
    ],
  });

  assert.equal(summary.hasText, true);
  assert.equal(summary.textPreview, 'Image generation skipped for policy reasons.');
  assert.equal(classifyGeminiImagePayload(summary), 'candidate_text_only');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned text instead of image'
  );
});

test('classifyGeminiImagePayload returns empty_candidates when no candidates exist', () => {
  const summary = summarizeGeminiImagePayload({});

  assert.equal(summary.candidateCount, 0);
  assert.equal(classifyGeminiImagePayload(summary), 'empty_candidates');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned empty candidates'
  );
});

test('classifyGeminiImagePayload returns unsupported_payload_shape for 200 OK payloads without image or text parts', () => {
  const summary = summarizeGeminiImagePayload({
    candidates: [
      {
        content: {
          parts: [{ functionCall: { name: 'noop' } }],
        },
      },
    ],
  });

  assert.deepEqual(summary.partTypes, ['functionCall']);
  assert.equal(classifyGeminiImagePayload(summary), 'unsupported_payload_shape');
  assert.equal(
    buildGeminiNoImageErrorMessage(classifyGeminiImagePayload(summary)),
    'Gemini official image returned an unsupported payload shape'
  );
});
