import { enabledSubjects, parseSubjectRegistry } from './subjects.js';
import { validateHiKnowledgeEnrichment } from './hi-assessment.js';
import {
  validateBilingualPairs, validateHiGuide, validateM9Guide, validateStudyGuide,
} from './study-guides.js';
import { validateQuestion } from './validate.js';

export function parseReleaseContent(payload) {
  if (payload?.schemaVersion !== 1 || !payload.contentVersion) throw new Error('Unsupported release payload');
  const subjects = enabledSubjects(parseSubjectRegistry(payload.registry));
  if (subjects.length !== 1) throw new Error('Encrypted release must contain exactly one enabled subject');
  const subject = subjects[0];
  const bundle = payload.subjects?.[subject.id];
  if (!bundle || bundle.manifest?.contentVersion !== payload.contentVersion) throw new Error('Release content version mismatch');
  const errors = bundle.questions.flatMap(validateQuestion);
  if (errors.length) throw new Error(`Encrypted questions are invalid: ${errors.join('; ')}`);
  const ids = new Set(bundle.questions.map(question => question.id));
  if (ids.size !== bundle.questions.length) throw new Error('Encrypted release contains duplicate question IDs');
  for (const id of ids) {
    if (!bundle.translations[id] || !bundle.explanations[id]) throw new Error(`${id}: enrichment is missing`);
  }
  for (const guide of bundle.studyGuides ?? []) {
    const guideErrors = guide.manifest?.id === 'm9'
      ? validateM9Guide(guide)
      : guide.manifest?.id === 'hi'
        ? validateHiGuide(guide)
        : validateStudyGuide(guide);
    if (guideErrors.length) throw new Error(`Encrypted study guide is invalid: ${guideErrors.join('; ')}`);
  }
  const hiGuide = bundle.studyGuides?.find(guide => guide.manifest?.id === 'hi');
  if (hiGuide) {
    const pairIds = new Set(hiGuide.chapters.flatMap(chapter => (
      validateBilingualPairs(hiGuide.documents[chapter.file], chapter.id).pairs.map(pair => pair.id)
    )));
    const knowledgeErrors = validateHiKnowledgeEnrichment(bundle, pairIds);
    if (knowledgeErrors.length) {
      throw new Error(`Encrypted HI knowledge enrichment is invalid: ${knowledgeErrors.join('; ')}`);
    }
  }
  return { subjects, content: { subject, ...bundle, warnings: [] } };
}
