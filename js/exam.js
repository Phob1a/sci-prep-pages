function mockRef(question) {
  return question.sourceRefs?.find(ref => ref.sourceKey === 'mock-paper');
}

function shuffledCopy(values, random) {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function validateMockPool(questions, exam) {
  const errors = [];
  const eligible = questions.filter(question => question.questionType === 'single-choice' && mockRef(question)?.sourcePool);
  if (eligible.length !== exam.sourcePoolQuestionCount) errors.push(`expected ${exam.sourcePoolQuestionCount} mock questions, found ${eligible.length}`);
  const pools = new Map();
  for (const question of eligible) {
    const ref = mockRef(question);
    const entry = pools.get(ref.sourcePool) ?? { quota: ref.mockDrawQuota, questions: [] };
    if (!Number.isInteger(ref.mockDrawQuota) || ref.mockDrawQuota < 1 || entry.quota !== ref.mockDrawQuota) errors.push(`invalid quota for pool ${ref.sourcePool}`);
    entry.questions.push(question);
    pools.set(ref.sourcePool, entry);
  }
  if (pools.size !== exam.sourcePoolCount) errors.push(`expected ${exam.sourcePoolCount} pools, found ${pools.size}`);
  let quotaTotal = 0;
  for (const [poolId, entry] of pools) {
    quotaTotal += entry.quota ?? 0;
    if (entry.questions.length < entry.quota) errors.push(`pool ${poolId} is smaller than its quota`);
  }
  if (quotaTotal !== exam.questionCount) errors.push(`pool quotas total ${quotaTotal}, expected ${exam.questionCount}`);
  return [...new Set(errors)];
}

export function selectOriginalMock(questions, random = Math.random) {
  const pools = new Map();
  for (const question of questions) {
    const ref = mockRef(question);
    if (question.questionType !== 'single-choice' || !ref?.sourcePool) continue;
    const entry = pools.get(ref.sourcePool) ?? { quota: ref.mockDrawQuota, questions: [] };
    if (entry.quota !== ref.mockDrawQuota) throw new Error('inconsistent mock draw quota');
    entry.questions.push(question);
    pools.set(ref.sourcePool, entry);
  }
  return shuffledCopy([...pools.values()].flatMap(({ quota, questions: source }) => {
    if (source.length < quota) throw new Error('mock source pool is smaller than its quota');
    return shuffledCopy(source, random).slice(0, quota);
  }), random);
}

export function createExamSession({ subject, questions, now = Date.now() }) {
  if (questions.length !== subject.exam.questionCount) throw new Error('question count does not match subject rules');
  return { subjectId: subject.id, questionIds: questions.map(question => question.id), questions, startedAt: now, durationSeconds: subject.exam.durationMinutes * 60, passingRate: subject.exam.passingRate, negativeMarking: subject.exam.negativeMarking === true };
}

export function remainingSeconds(session, now = Date.now()) {
  return Math.max(0, session.durationSeconds - Math.floor((now - session.startedAt) / 1000));
}

function answerMatches(question, chosen) {
  if (question.questionType === 'fill-blank') return String(chosen ?? '').trim().toLocaleLowerCase() === String(question.answer ?? '').trim().toLocaleLowerCase();
  if (question.questionType === 'matching') {
    const keys = Object.keys(question.answer ?? {});
    return keys.length > 0 && keys.every(key => chosen?.[key] === question.answer[key]);
  }
  return chosen === question.answer;
}

export function gradeSession(session, answers) {
  const rows = session.questions.map(question => {
    const chosen = answers[question.id] ?? (question.questionType === 'matching' ? {} : '');
    return { question, chosen, correct: question.answer, isCorrect: answerMatches(question, chosen) };
  });
  const correct = rows.filter(row => row.isCorrect).length;
  const unanswered = rows.filter(row => typeof row.chosen === 'string' ? !row.chosen.trim() : Object.keys(row.chosen ?? {}).length === 0).length;
  const total = rows.length;
  const rate = total ? correct / total : 0;
  const score = Math.max(0, correct);
  return { correct, unanswered, total, score, rate, pass: rate >= session.passingRate, rows };
}
