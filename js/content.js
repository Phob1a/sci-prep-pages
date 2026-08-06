import { validateQuestion } from './validate.js';
import { validateStudyGuide } from './study-guides.js';

function directoryOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function resolveRelative(base, path) {
  if (/^(?:[a-z]+:)?\//i.test(path)) return path;
  return `${base}${path}`;
}

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
  return response.json();
}

async function fetchText(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
  return response.text();
}

async function loadStudyGuide(entry, base, fetchFn) {
  const manifestUrl = resolveRelative(base, entry.manifest);
  const manifest = await fetchJson(fetchFn, manifestUrl);
  if (entry.id && manifest.id !== entry.id) throw new Error(`expected study guide id ${entry.id}`);
  const guideBase = directoryOf(manifestUrl);
  const chapters = await fetchJson(fetchFn, resolveRelative(guideBase, manifest.chapters));
  if (!Array.isArray(chapters)) throw new Error('study guide chapters must be an array');
  for (const chapter of chapters) {
    if (!/^chapters\/[A-Za-z0-9._-]+\.md$/u.test(chapter?.file ?? '')) {
      throw new Error(`${chapter?.id ?? 'chapter'}: unsafe document path`);
    }
  }
  const documents = Object.fromEntries(await Promise.all(chapters.map(async chapter => [
    chapter.file,
    await fetchText(fetchFn, resolveRelative(guideBase, chapter.file)),
  ])));
  const questionFiles = await Promise.all((manifest.questionFiles ?? []).map(async file => (
    fetchJson(fetchFn, resolveRelative(`${guideBase}questions/`, file))
  )));
  const guide = {
    manifest,
    chapters,
    documents,
    ...(manifest.questionFiles ? {
      questions: questionFiles.flat(),
      translations: await fetchJson(fetchFn, resolveRelative(guideBase, manifest.translations)),
      explanations: await fetchJson(fetchFn, resolveRelative(guideBase, manifest.explanations)),
    } : {}),
  };
  const errors = validateStudyGuide(guide, entry.id);
  if (errors.length) throw new Error(errors.join('; '));
  return guide;
}

export async function loadSubjectContent(subject, fetchFn = fetch) {
  const manifest = await fetchJson(fetchFn, subject.manifest);
  if (manifest.subjectId && manifest.subjectId !== subject.id) throw new Error('manifest subject mismatch');
  const base = directoryOf(subject.manifest);
  const [chapters, translations, explanations] = await Promise.all([
    fetchJson(fetchFn, resolveRelative(base, manifest.chapters)),
    fetchJson(fetchFn, resolveRelative(base, manifest.translations)),
    fetchJson(fetchFn, resolveRelative(base, manifest.explanations)),
  ]);
  const warnings = [];
  const studyGuides = [];
  for (const entry of manifest.studyGuides ?? []) {
    try {
      studyGuides.push(await loadStudyGuide(entry, base, fetchFn));
    } catch (error) {
      warnings.push({ file: entry.manifest, errors: [error.message] });
    }
  }
  const questions = [];
  const ids = new Set();
  for (const questionFile of manifest.questionFiles ?? []) {
    try {
      const rows = await fetchJson(fetchFn, resolveRelative(`${base}questions/`, questionFile));
      if (!Array.isArray(rows)) throw new Error('question file must contain an array');
      const errors = [];
      for (const question of rows) {
        const recordErrors = validateQuestion(question);
        if (question.subjectId !== subject.id) recordErrors.push(`${question.id}: subject mismatch`);
        if (ids.has(question.id)) recordErrors.push(`${question.id}: duplicate ID`);
        if (recordErrors.length) {
          errors.push(...recordErrors);
        } else {
          ids.add(question.id);
          questions.push(question);
        }
      }
      if (errors.length) warnings.push({ file: questionFile, errors });
    } catch (error) {
      warnings.push({ file: questionFile, errors: [error.message] });
    }
  }
  return { subject, manifest, chapters, questions, translations, explanations, studyGuides, warnings };
}
