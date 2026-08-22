const GEMINI_TYPES = new Map([
  ['string', 'STRING'],
  ['number', 'NUMBER'],
  ['integer', 'INTEGER'],
  ['boolean', 'BOOLEAN'],
  ['array', 'ARRAY'],
  ['object', 'OBJECT'],
]);

const GEMINI_SCHEMA_FIELDS = [
  'format',
  'title',
  'description',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'propertyOrdering',
  'minProperties',
  'maxProperties',
];

function normalizeType(type, path) {
  if (typeof type === 'string') {
    const normalized = GEMINI_TYPES.get(type.toLowerCase());
    if (!normalized) throw new Error(`Unsupported Gemini schema type at ${path}: ${type}`);
    return { type: normalized, nullable: false };
  }

  if (!Array.isArray(type)) return { type: undefined, nullable: false };

  const nullable = type.includes('null');
  const nonNullTypes = type.filter((entry) => entry !== 'null');
  if (nonNullTypes.length > 1) {
    throw new Error(`Gemini schema only supports a single non-null type at ${path}`);
  }
  if (nonNullTypes.length === 0) return { type: undefined, nullable };
  const normalized = GEMINI_TYPES.get(String(nonNullTypes[0]).toLowerCase());
  if (!normalized) throw new Error(`Unsupported Gemini schema type at ${path}: ${nonNullTypes[0]}`);
  return { type: normalized, nullable };
}

function copyEnum(schema) {
  if (!Array.isArray(schema.enum)) return undefined;
  const values = schema.enum.filter((value) => typeof value === 'string');
  return values.length > 0 ? values : undefined;
}

export function toGeminiSchema(schema, path = 'schema') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};

  const { type, nullable: typeNullable } = normalizeType(schema.type, path);
  const result = {};
  if (type) result.type = type;

  for (const field of GEMINI_SCHEMA_FIELDS) {
    if (schema[field] !== undefined) result[field] = schema[field];
  }

  const enumValues = copyEnum(schema);
  if (enumValues) result.enum = enumValues;
  else delete result.enum;

  if (typeNullable || schema.nullable === true || (Array.isArray(schema.enum) && schema.enum.includes(null))) {
    result.nullable = true;
  }

  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, toGeminiSchema(child, `${path}.properties.${key}`)]),
    );
  }

  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    result.items = toGeminiSchema(schema.items, `${path}.items`);
  }

  if (Array.isArray(schema.required) && schema.required.length > 0) {
    result.required = [...schema.required];
  } else {
    delete result.required;
  }

  return result;
}
