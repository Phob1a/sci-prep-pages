export function parseSubjectRegistry(raw) {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.subjects)) {
    throw new Error('invalid subject registry');
  }
  const ids = new Set();
  return raw.subjects.map(subject => {
    if (!/^[a-z0-9-]+$/.test(subject?.id ?? '')) {
      throw new Error(`invalid subject ID: ${subject?.id}`);
    }
    if (ids.has(subject.id)) throw new Error(`duplicate subject ID: ${subject.id}`);
    if (typeof subject.name !== 'string' || !subject.name.trim() || typeof subject.manifest !== 'string' || !subject.manifest.trim()) {
      throw new Error(`incomplete subject: ${subject.id}`);
    }
    ids.add(subject.id);
    return { ...subject, enabled: subject.enabled === true };
  });
}

export const enabledSubjects = subjects => subjects.filter(subject => subject.enabled);

export const getSubject = (subjects, subjectId) => subjects.find(subject => subject.id === subjectId) ?? null;
