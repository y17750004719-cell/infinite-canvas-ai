import test from 'node:test';
import assert from 'node:assert/strict';

import { assertGeminiSchemaCompatible, toGeminiSchema } from './gemini-schema.mjs';

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

test('keeps only string enum members when a schema mixes numeric and string values', () => {
  assert.deepEqual(
    toGeminiSchema({ type: 'string', enum: ['draft', 1, 'published', null] }),
    { type: 'STRING', enum: ['draft', 'published'], nullable: true },
  );
});

test('Gemini compatibility assertion rejects OpenAI-only schema fields recursively', () => {
  assert.throws(
    () => assertGeminiSchemaCompatible({ type: 'OBJECT', properties: { value: { type: 'STRING', additionalProperties: false } } }),
    /additionalProperties/,
  );
  assert.equal(assertGeminiSchemaCompatible(toGeminiSchema({ type: 'object', additionalProperties: false, properties: { value: { type: 'string', minLength: 1 } } })), true);
});
