const nonBlank = value => typeof value === 'string' && value.trim().length > 0;
const chineseLength = value => (String(value ?? '').match(/[\u3400-\u9fff]/gu) ?? []).length;
const englishWordCount = value => (String(value ?? '').match(/[A-Za-z]+/gu) ?? []).length;

function optionIsExplained(explanation, key) {
  const text = String(explanation ?? '');
  return [`${key}项`, `${key} 项`, `选项${key}`, `选项 ${key}`, `${key}：`, `${key}:`, `${key}.`, `${key} `]
    .some(marker => text.includes(marker));
}

export function validateHiKnowledgeEnrichment(assessment, pairIds = new Set(), expectedQuestionCount = 192) {
  const errors = [];
  const questions = assessment?.questions ?? [];
  const explanations = assessment?.explanations ?? {};
  const ids = new Set();

  if (questions.length !== expectedQuestionCount) {
    errors.push(`expected ${expectedQuestionCount} HI questions, found ${questions.length}`);
  }

  for (const question of questions) {
    if (question.subjectId !== 'hi') errors.push(`${question.id}: subjectId must be hi`);
    if (ids.has(question.id)) errors.push(`${question.id}: duplicate ID`);
    ids.add(question.id);
    const explanation = explanations[question.id];
    if (englishWordCount(explanation?.explanationEn) < 45) {
      errors.push(`${question.id}: English explanation is too shallow`);
    }
    if (chineseLength(explanation?.explanationZh) < 60) {
      errors.push(`${question.id}: Chinese explanation is too shallow`);
    }
    if (question.questionType === 'single-choice') {
      for (const key of Object.keys(question.optionsEn ?? {})) {
        if (!optionIsExplained(explanation?.explanationZh, key)) {
          errors.push(`${question.id}: Chinese explanation does not analyse option ${key}`);
        }
        if (!optionIsExplained(explanation?.explanationEn, key)) {
          errors.push(`${question.id}: English explanation does not analyse option ${key}`);
        }
      }
    }
    if (!/^HI Ch\.\d+(?:\s|\.|\u00b7)/u.test(explanation?.textbookRef ?? '')) {
      errors.push(`${question.id}: textbookRef must identify an HI chapter and topic`);
    }
    if (!Array.isArray(explanation?.knowledgeLinks) || explanation.knowledgeLinks.length === 0) {
      errors.push(`${question.id}: knowledge link is missing`);
    } else {
      for (const link of explanation.knowledgeLinks) {
        if (
          link?.guideId !== 'hi'
          || link?.chapterId !== question.chapterId
          || !pairIds.has(link?.pairId)
          || !nonBlank(link?.titleZh)
        ) {
          errors.push(`${question.id}: knowledge link is invalid`);
        }
      }
    }
    if (
      !Array.isArray(explanation?.examAnglesZh)
      || explanation.examAnglesZh.length < 2
      || explanation.examAnglesZh.some(angle => chineseLength(angle) < 8)
    ) {
      errors.push(`${question.id}: at least two substantive exam angles are required`);
    }
  }

  if (Object.keys(explanations).length !== questions.length
    || Object.keys(explanations).some(id => !ids.has(id))) {
    errors.push('HI explanation ID set must match question ID set');
  }

  return [...new Set(errors)];
}
