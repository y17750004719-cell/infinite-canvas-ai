import test from 'node:test';
import assert from 'node:assert/strict';

import { toGeminiSchema } from './gemini-schema.mjs';

test('converts nested JSON Schema into Gemini Schema', () => {
  assert.deepEqual(toGeminiSchema({
    type: 'object',
    description: 'root',
    required: ['name'],
    additionalProperties: false,
    minLength: 1,
    properties: {
      name: {
        type: ['string', 'null'],
        enum: ['alice', null],
        minLength: 1,
        maxLength: 20,
        additionalProperties: false,
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'integer', minimum: 1, maximum: 5 },
          },
          additionalProperties: false,
        },
      },
    },
  }), {
    type: 'OBJECT',
    description: 'root',
    required: ['name'],
    properties: {
      name: { type: 'STRING', enum: ['alice'], nullable: true },
      items: {
        type: 'ARRAY',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'OBJECT',
          required: ['value'],
          properties: { value: { type: 'INTEGER' } },
        },
      },
    },
  });
});

test('rejects unions Gemini cannot represent as one Schema type', () => {
  assert.throws(
    () => toGeminiSchema({ type: ['string', 'number'] }),
    /single non-null type/,
  );
});

test('drops non-string enum values unsupported by Gemini Schema', () => {
  assert.deepEqual(
    toGeminiSchema({ type: 'integer', enum: [1] }),
    { type: 'INTEGER' },
  );
});
