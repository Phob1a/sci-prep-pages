export const STATE_SCHEMA_VERSION = 1;
export const stateKey = subjectId => `sci-prep:v${STATE_SCHEMA_VERSION}:${subjectId}`;

export function defaultSubjectState(subjectId) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    subjectId,
    wrongbook: [],
    answerLog: {},
    examHistory: [],
    unresolvedQuestionIds: [],
  };
}

export function migrateSubjectState(state, { subjectId, idAliases = {}, knownQuestionIds } = {}) {
  if (!state || state.subjectId !== subjectId) throw new Error('subject mismatch in saved state');
  const mapId = id => idAliases[id] ?? id;
  const wrongbook = [...new Set((state.wrongbook ?? []).map(mapId))];
  const known = knownQuestionIds ? new Set(knownQuestionIds) : null;
  const unresolvedQuestionIds = [...new Set([
    ...(state.unresolvedQuestionIds ?? []).map(mapId),
    ...(known ? wrongbook.filter(id => !known.has(id)) : []),
  ])];
  const answerLog = Object.fromEntries(Object.entries(state.answerLog ?? {}).map(([id, value]) => [mapId(id), value]));
  return { ...defaultSubjectState(subjectId), ...state, schemaVersion: STATE_SCHEMA_VERSION, subjectId, wrongbook, answerLog, unresolvedQuestionIds };
}

export function loadSubjectState(storage, subjectId, idAliases = {}, knownQuestionIds) {
  const raw = storage.getItem(stateKey(subjectId));
  if (!raw) return defaultSubjectState(subjectId);
  try {
    return migrateSubjectState(JSON.parse(raw), { subjectId, idAliases, knownQuestionIds });
  } catch {
    return defaultSubjectState(subjectId);
  }
}

export function saveSubjectState(storage, state) {
  if (!state?.subjectId) throw new Error('state is missing subjectId');
  storage.setItem(stateKey(state.subjectId), JSON.stringify(state));
}
