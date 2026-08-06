const values = value => {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(values);
  if (typeof value === 'object') return Object.values(value).flatMap(values);
  return [String(value)];
};

export function sourceTypes(question) {
  return [...new Set((question.sourceRefs ?? []).map(reference => reference.sourceType).filter(Boolean))];
}

export function countReviewSources(questions) {
  const unique = [...new Map(questions.map(question => [question.id, question])).values()];
  return {
    total: unique.length,
    checkpoint: unique.filter(question => sourceTypes(question).includes('checkpoint')).length,
    mock: unique.filter(question => sourceTypes(question).includes('mock')).length,
  };
}

export function selectReviewQuestions(questions, translations, explanations, filters = {}) {
  const source = filters.source ?? 'all';
  const query = String(filters.query ?? '').trim().toLocaleLowerCase();
  return [...new Map(questions.map(question => [question.id, question])).values()].filter(question => {
    if (filters.chapterId && question.chapterId !== filters.chapterId) return false;
    if (source !== 'all' && !sourceTypes(question).includes(source)) return false;
    if (!query) return true;
    const haystack = values([question.stemEn, question.optionsEn, question.statementsEn,
      translations[question.id], explanations[question.id]]).join('\n').toLocaleLowerCase();
    return haystack.includes(query);
  });
}
