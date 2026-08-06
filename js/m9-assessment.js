import { validateMockPool } from './exam.js';
import { validateQuestion } from './validate.js';

const nonBlank = value => typeof value === 'string' && value.trim().length > 0;
const chineseLength = value => (String(value ?? '').match(/[\u3400-\u9fff]/gu) ?? []).length;

function translatedMapErrors(questionId, label, source, translated) {
  return Object.keys(source ?? {})
    .filter(key => !nonBlank(translated?.[key]))
    .map(key => `${questionId}: missing ${label}.${key}`);
}

function optionIsExplained(explanation, key) {
  const text = String(explanation ?? '');
  return [
    `${key}项`, `${key} 项`, `选项${key}`, `选项 ${key}`,
    `${key}：`, `${key}:`, `${key}.`, `${key}、`, `${key}正确`, `${key}错误`,
  ].some(marker => text.includes(marker))
    || new RegExp(`(?:^|[^A-Za-z0-9])${key}(?:$|[^A-Za-z0-9])`, 'u').test(text);
}

export function validateM9Assessment(assessment, pairIds = new Set()) {
  const errors = [];
  const manifest = assessment?.manifest ?? {};
  const questions = assessment?.questions ?? [];
  const translations = assessment?.translations ?? {};
  const explanations = assessment?.explanations ?? {};
  const ids = new Set();

  if (manifest.subjectId !== 'm9') errors.push('M9 assessment subjectId must be m9');
  if (
    manifest.exam?.questionCount !== 100
    || manifest.exam?.durationMinutes !== 120
    || manifest.exam?.passingRate !== 0.7
    || manifest.exam?.negativeMarking !== false
    || manifest.exam?.sourcePoolQuestionCount !== 200
    || manifest.exam?.sourcePoolCount !== 17
  ) {
    errors.push('M9 assessment exam rules are invalid');
  }

  for (const question of questions) {
    errors.push(...validateQuestion(question));
    if (question.subjectId !== 'm9') errors.push(`${question.id}: subjectId must be m9`);
    if (ids.has(question.id)) errors.push(`${question.id}: duplicate ID`);
    ids.add(question.id);
    const translation = translations[question.id];
    const explanation = explanations[question.id];
    if (!nonBlank(translation?.stemZh)) errors.push(`${question.id}: missing stemZh`);
    errors.push(...translatedMapErrors(question.id, 'optionsZh', question.optionsEn, translation?.optionsZh));
    errors.push(...translatedMapErrors(question.id, 'statementsZh', question.statementsEn, translation?.statementsZh));
    if (!nonBlank(explanation?.explanationZh)) {
      errors.push(`${question.id}: missing explanationZh`);
    } else {
      const minimum = question.questionType === 'single-choice' ? 80 : 60;
      if (chineseLength(explanation.explanationZh) < minimum) {
        errors.push(`${question.id}: explanation is too shallow`);
      }
      if (question.questionType === 'single-choice') {
        for (const key of Object.keys(question.optionsEn ?? {})) {
          if (!optionIsExplained(explanation.explanationZh, key)) {
            errors.push(`${question.id}: explanation does not analyse option ${key}`);
          }
        }
      }
    }
    if (!/^M9 Ch\.\d+\s·\s/u.test(explanation?.textbookRef ?? '')) {
      errors.push(`${question.id}: textbookRef must identify an M9 chapter and topic`);
    }
    if (!Array.isArray(explanation?.knowledgeLinks) || explanation.knowledgeLinks.length === 0) {
      errors.push(`${question.id}: knowledge link is missing`);
    } else {
      for (const link of explanation.knowledgeLinks) {
        if (
          link?.guideId !== 'm9'
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

  const checkpointQuestions = questions.filter(question => question.sourceRefs?.some(ref => ref.sourceType === 'checkpoint'));
  const mockQuestions = questions.filter(question => question.sourceRefs?.some(ref => ref.sourceType === 'mock'));
  if (questions.length !== 251) errors.push(`expected 251 M9 questions, found ${questions.length}`);
  if (checkpointQuestions.length !== 51) errors.push(`expected 51 M9 checkpoint questions, found ${checkpointQuestions.length}`);
  if (mockQuestions.length !== 200) errors.push(`expected 200 M9 mock questions, found ${mockQuestions.length}`);
  if (Object.keys(translations).length !== questions.length || Object.keys(translations).some(id => !ids.has(id))) {
    errors.push('M9 translation ID set must match question ID set');
  }
  if (Object.keys(explanations).length !== questions.length || Object.keys(explanations).some(id => !ids.has(id))) {
    errors.push('M9 explanation ID set must match question ID set');
  }
  errors.push(...validateMockPool(questions, manifest.exam ?? {}));
  return [...new Set(errors)];
}
