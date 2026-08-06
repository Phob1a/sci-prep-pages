function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateQuestion(question) {
  const errors = [];
  const id = question?.id || '<unknown>';
  if (!present(question?.id)) errors.push('missing id');
  if (!present(question?.subjectId)) errors.push(`${id}: missing subjectId`);
  if (!present(question?.chapterId)) errors.push(`${id}: missing chapterId`);
  if (!present(question?.stemEn)) errors.push(`${id}: missing stemEn`);
  if (!Array.isArray(question?.sourceRefs) || question.sourceRefs.length === 0) errors.push(`${id}: missing sourceRefs`);

  if (question?.questionType === 'single-choice' || question?.questionType === 'multiple-response') {
    const entries = Object.entries(question.optionsEn ?? {});
    const keys = entries.map(([key]) => key);
    if (entries.length < 2 || entries.some(([key, value]) => !present(key) || !present(value))) errors.push(`${id}: insufficient options`);
    if (new Set(entries.map(([, value]) => value.trim())).size !== entries.length) errors.push(`${id}: duplicate options`);
    if (question.questionType === 'single-choice' && !keys.includes(question.answer)) {
      errors.push(`${id}: answer not in options`);
    }
    if (
      question.questionType === 'multiple-response' &&
      (!Array.isArray(question.answer) || question.answer.length < 2 || question.answer.some((answer) => !keys.includes(answer)))
    ) {
      errors.push(`${id}: multiple-response answer is invalid`);
    }
  } else if (question?.questionType === 'fill-blank') {
    if (!present(String(question.answer ?? ''))) errors.push(`${id}: missing fill-blank answer`);
  } else if (question?.questionType === 'matching') {
    const statements = Object.keys(question.statementsEn ?? {});
    const optionKeys = new Set(Object.keys(question.optionsEn ?? {}));
    if (statements.length === 0 || optionKeys.size === 0) errors.push(`${id}: incomplete matching data`);
    for (const statement of statements) {
      if (!optionKeys.has(question.answer?.[statement])) errors.push(`${id}: matching answer invalid for ${statement}`);
    }
  } else {
    errors.push(`${id}: unsupported questionType`);
  }
  return errors;
}
