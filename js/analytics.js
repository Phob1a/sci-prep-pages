export function applyExamResult(state, result, timestamp = new Date().toISOString()) {
  const answerLog = structuredClone(state.answerLog ?? {});
  const wrongbook = new Set(state.wrongbook ?? []);
  for (const row of result.rows) {
    const current = answerLog[row.question.id] ?? { attempts: 0, correct: 0 };
    answerLog[row.question.id] = {
      ...current,
      attempts: current.attempts + 1,
      correct: current.correct + (row.isCorrect ? 1 : 0),
      ...(!row.isCorrect ? { lastWrongAnswer: structuredClone(row.chosen) } : {}),
    };
    if (!row.isCorrect) wrongbook.add(row.question.id);
  }
  return {
    ...state,
    answerLog,
    wrongbook: [...wrongbook],
    examHistory: [...(state.examHistory ?? []), { timestamp, correct: result.correct, total: result.total, rate: result.rate, pass: result.pass }],
  };
}

export const removeWrongQuestion = (state, questionId) => ({ ...state, wrongbook: (state.wrongbook ?? []).filter(id => id !== questionId) });
export const clearWrongbook = state => ({ ...state, wrongbook: [] });

export function weakAreas(questions, answerLog) {
  const totals = new Map();
  for (const question of questions) {
    const total = totals.get(question.chapterId) ?? { chapterId: question.chapterId, attempts: 0, correct: 0 };
    const log = answerLog[question.id] ?? { attempts: 0, correct: 0 };
    total.attempts += log.attempts;
    total.correct += log.correct;
    totals.set(question.chapterId, total);
  }
  return [...totals.values()].map(area => ({ ...area, accuracy: area.attempts ? area.correct / area.attempts : null })).sort((a, b) => {
    if (a.attempts === 0 && b.attempts !== 0) return 1;
    if (b.attempts === 0 && a.attempts !== 0) return -1;
    if (a.accuracy !== b.accuracy) return (a.accuracy ?? 1) - (b.accuracy ?? 1);
    return b.attempts - a.attempts || a.chapterId.localeCompare(b.chapterId);
  });
}
