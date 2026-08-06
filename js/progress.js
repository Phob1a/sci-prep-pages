import { STATE_SCHEMA_VERSION, migrateSubjectState } from './state.js';

export function exportProgress(states, exportedAt = new Date().toISOString()) {
  return JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, exportedAt, subjects: states }, null, 2);
}

function parseProgress(json) {
  let wrapper;
  try {
    wrapper = typeof json === 'string' ? JSON.parse(json) : structuredClone(json);
  } catch {
    throw new Error('Invalid progress JSON');
  }
  if (wrapper?.schemaVersion !== STATE_SCHEMA_VERSION || !wrapper.subjects || Array.isArray(wrapper.subjects) || typeof wrapper.subjects !== 'object') {
    throw new Error('Unsupported progress schema');
  }
  const subjects = {};
  for (const [subjectId, state] of Object.entries(wrapper.subjects)) {
    subjects[subjectId] = migrateSubjectState(state, { subjectId });
  }
  return subjects;
}

export function importProgress(json, currentStates, { overwrite = false } = {}) {
  const incoming = parseProgress(json);
  const states = structuredClone(currentStates);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const [subjectId, state] of Object.entries(incoming)) {
    const current = states[subjectId];
    if (!current) {
      states[subjectId] = state;
      added += 1;
    } else if (JSON.stringify(current) === JSON.stringify(state)) {
      skipped += 1;
    } else if (overwrite) {
      states[subjectId] = state;
      updated += 1;
    } else {
      conflicts += 1;
    }
  }
  return { states, added, updated, skipped, conflicts };
}
