// The schema of part.json is the one description of the format: the loader checks
// every part against it (the file is embedded in the DLL), the editor shows the
// same rules, so the two cannot drift apart.
//
// The file lives in the docs folder of the repository; the server of the editor
// hands it out under /docs/part.schema.json.

export const SCHEMA_URL = '/docs/part.schema.json';

let cached = null;

// Reads the schema once and keeps it.
export async function loadSchema() {
  if (cached) return cached;
  const response = await fetch(SCHEMA_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('the schema of part.json was not found (' + response.status + ')');
  }
  cached = await response.json();
  return cached;
}

// Checks a part against the schema. The messages name the field and say what is
// wrong with it, the same way the loader writes them.
export function validateAgainstSchema(instance, schema) {
  const errors = [];
  const warnings = [];
  if (!schema || !instance) return { errors, warnings };
  validate(instance, schema, '', schema, errors, warnings);
  return { errors, warnings };
}

function validate(instance, schema, path, root, errors, warnings) {
  if (!schema) return;

  if (schema.$ref) {
    const target = resolve(schema.$ref, root);
    if (target) validate(instance, target, path, root, errors, warnings);
    return;
  }

  if (Array.isArray(schema.oneOf)) {
    // Every form is tried on its own; the first one that fits wins.
    let ok = false;
    let firstError = null;
    for (const form of schema.oneOf) {
      const sub = [];
      validate(instance, form, path, root, sub, []);
      if (!sub.length) {
        ok = true;
        break;
      }
      if (firstError === null) firstError = sub[0];
    }
    if (!ok) errors.push(firstError || `${describe(path)} has not an allowed form`);
    return;
  }

  if (schema.type && !matchesType(instance, schema.type)) {
    errors.push(`${describe(path)} must be ${schema.type}`);
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((value) => same(value, instance))) {
    errors.push(`${describe(path)} must be one of ${schema.enum.join(', ')}`);
  }

  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) {
      errors.push(`${describe(path)} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && instance > schema.maximum) {
      errors.push(`${describe(path)} must be at most ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && instance <= schema.exclusiveMinimum) {
      errors.push(`${describe(path)} must be more than ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && instance >= schema.exclusiveMaximum) {
      errors.push(`${describe(path)} must be less than ${schema.exclusiveMaximum}`);
    }
  }

  if (typeof instance === 'string') {
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${describe(path)} must have at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) {
      errors.push(`${describe(path)} must have at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(instance)) {
      errors.push(`${describe(path)} does not match ${schema.pattern}`);
    }
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${describe(path)} must have at least ${schema.minItems} ${schema.minItems === 1 ? 'entry' : 'entries'}`);
    }
    if (schema.items) {
      instance.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, root, errors, warnings));
    }
  }

  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) return;

  for (const name of schema.required || []) {
    if (instance[name] === undefined || instance[name] === null) {
      errors.push(`${describe(join(path, name))} is required`);
    }
  }

  const noExtras = schema.additionalProperties === false;
  for (const [name, value] of Object.entries(instance)) {
    if (schema.properties && schema.properties[name]) {
      validate(value, schema.properties[name], join(path, name), root, errors, warnings);
    } else if (noExtras) {
      warnings.push(`${describe(join(path, name))} is not a known field (it is ignored)`);
    }
  }
}

function matchesType(instance, type) {
  switch (type) {
    case 'object':
      return instance !== null && typeof instance === 'object' && !Array.isArray(instance);
    case 'array':
      return Array.isArray(instance);
    case 'string':
      return typeof instance === 'string';
    case 'number':
      return typeof instance === 'number';
    case 'integer':
      return Number.isInteger(instance);
    case 'boolean':
      return typeof instance === 'boolean';
    case 'null':
      return instance === null;
    default:
      return true;
  }
}

function same(value, instance) {
  if (typeof value !== typeof instance) return false;
  if (value && typeof value === 'object') return JSON.stringify(value) === JSON.stringify(instance);
  return value === instance;
}

function resolve(reference, root) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null;
  let current = root;
  for (const part of reference.slice(2).split('/')) {
    if (current === null || current === undefined) return null;
    current = current[part];
  }
  return current && typeof current === 'object' ? current : null;
}

function join(path, name) {
  return path ? `${path}.${name}` : name;
}

function describe(path) {
  return path ? `'${path}'` : 'the part';
}
