import { applyExamResult, clearWrongbook, removeWrongQuestion, weakAreas } from '../js/analytics.js';
import { createExamSession, gradeSession, remainingSeconds, selectOriginalMock, validateMockPool } from '../js/exam.js';
import { exportProgress, importProgress } from '../js/progress.js';
import { countReviewSources, selectReviewQuestions, sourceTypes } from '../js/review.js';
import { loadSubjectState, saveSubjectState } from '../js/state.js';
import { renderBilingualStudyMarkdown, selectStudyGuideChapters } from '../js/study-guides.js';

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const percent = value => value == null ? '—' : `${Math.round(value * 100)}%`;
const asAnswer = value => Array.isArray(value)
  ? value.join('、') || '未作答'
  : typeof value === 'object' && value !== null
  ? Object.entries(value).map(([key, answer]) => `${key} → ${answer}`).join('；')
  : String(value || '未作答');

export function reviewRowsToRender(rows, expandedIndexes) {
  return rows.filter((_, index) => expandedIndexes.has(index));
}

function header(title, subtitle = '', actions = '', eyebrow = 'SCI · HEALTH INSURANCE') {
  return `<header class="topbar"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2>${subtitle ? `<p class="subtle">${escapeHtml(subtitle)}</p>` : ''}</div><div class="top-actions">${actions}</div></header>`;
}

function studySourceLabel(question) {
  return sourceTypes(question).map(type => type === 'mock' ? '模拟题' : '章节题').join(' · ');
}

function reviewStatus(explanation) {
  return explanation.reviewStatus === 'needs-review'
    ? `<span class="review-status">平台答案与教材存在冲突，已保留平台答案</span><p>${escapeHtml(explanation.reviewNote)}</p>`
    : '';
}

function knowledgeExtension(explanation, questionId = '') {
  const links = Array.isArray(explanation?.knowledgeLinks) ? explanation.knowledgeLinks : [];
  const examAngles = Array.isArray(explanation?.examAnglesZh) ? explanation.examAnglesZh : [];
  if (!links.length && !examAngles.length) return '';
  return `<div class="review-block knowledge-extension">
    <h4>关联知识点与变形考法</h4>
    ${links.length ? `<div class="knowledge-links">${links.map(link => `<button class="knowledge-link" type="button" data-knowledge-guide="${escapeHtml(link.guideId ?? 'm9')}" data-knowledge-chapter="${escapeHtml(link.chapterId)}" data-knowledge-pair="${escapeHtml(link.pairId)}" data-knowledge-question="${escapeHtml(questionId)}">跳到知识点：${escapeHtml(link.titleZh)}</button>`).join('')}</div>` : ''}
    ${examAngles.length ? `<div class="exam-angles"><p class="review-ref">可能的变形考点（复习推演，非官方原题）</p><ul>${examAngles.map(angle => `<li>${escapeHtml(angle)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function studyLines(title, rows) {
  if (!rows?.length) return '';
  return `<div class="study-language"><h3>${escapeHtml(title)}</h3>${rows.map(row => `<p class="study-option">${escapeHtml(row)}</p>`).join('')}</div>`;
}

function renderEnglishStudyContent(question) {
  const statements = Object.entries(question.statementsEn ?? {}).map(([key, value]) => `${key}. ${value}`);
  const options = Object.entries(question.optionsEn ?? {}).map(([key, value]) => `${key}. ${value}`);
  return `<div class="question-stem">${escapeHtml(question.stemEn)}</div>${studyLines('English statements', statements)}${studyLines('English options', options)}`;
}

function renderChineseStudyContent(question, translation) {
  const statements = Object.entries(translation.statementsZh ?? {}).map(([key, value]) => `${key}. ${value}`);
  const options = Object.entries(translation.optionsZh ?? {}).map(([key, value]) => `${key}. ${value}`);
  return `<div class="review-block"><h4>中文题目</h4><p>${escapeHtml(translation.stemZh)}</p></div>${studyLines('中文陈述', statements)}${studyLines('中文选项', options)}`;
}

function bilingualExplanationBlocks(explanation) {
  const english = explanation.explanationEn
    ? `<div class="review-block" lang="en"><h4>English explanation</h4><p>${escapeHtml(explanation.explanationEn)}</p></div>`
    : '';
  const chineseHeading = english ? '中文解析' : '中文题解';
  return `${english}<div class="review-block"><h4>${chineseHeading}</h4><p>${escapeHtml(explanation.explanationZh ?? '—')}</p><p class="review-ref">教材依据：${escapeHtml(explanation.textbookRef ?? '—')}</p>${reviewStatus(explanation)}</div>`;
}

function reviewedChoiceOptions(question, translation, chosen) {
  if (!['single-choice', 'multiple-response'].includes(question.questionType)) return '';
  const correct = new Set(Array.isArray(question.answer) ? question.answer : [question.answer]);
  const selected = new Set(Array.isArray(chosen) ? chosen : chosen ? [chosen] : []);
  return `<div class="review-block"><h4>选项判定 · English / 中文</h4><div class="options">${Object.entries(question.optionsEn ?? {}).map(([key, text]) => {
    const classes = ['option'];
    if (correct.has(key)) classes.push('correct');
    else if (selected.has(key)) classes.push('wrong');
    const marker = correct.has(key) ? '正确答案' : selected.has(key) ? '你的误选' : '';
    return `<div class="${classes.join(' ')}"><span class="option-key">${escapeHtml(key)}</span><span><b>${escapeHtml(text)}</b><br><span class="subtle">${escapeHtml(translation.optionsZh?.[key] ?? '—')}</span>${marker ? `<br><span class="answer-marker">${marker}</span>` : ''}</span></div>`;
  }).join('')}</div></div>`;
}

function studyCard(question, translations, explanations, number) {
  const translation = translations[question.id];
  const explanation = explanations[question.id];
  return `<article class="card study-card" data-review-card="${escapeHtml(question.id)}" tabindex="-1">
    <div class="question-meta"><span>${escapeHtml(question.chapterId.toUpperCase())} · ${escapeHtml(studySourceLabel(question))} · ${escapeHtml(question.questionType)}</span><span>第 ${number} 题</span></div>
    ${renderEnglishStudyContent(question)}
    ${renderChineseStudyContent(question, translation)}
    <div class="review-block study-answer"><h4>正确答案</h4><p><b>${escapeHtml(asAnswer(question.answer))}</b></p></div>
    ${bilingualExplanationBlocks(explanation)}
    ${knowledgeExtension(explanation, question.id)}
  </article>`;
}

function reviewPresetLabel(subject, source, counts) {
  if (source === 'checkpoint') return `${subject} 章节题 · ${counts.checkpoint} 道`;
  if (source === 'mock') return `${subject} Mock 题库 · ${counts.mock} 道`;
  return `${subject} 完整授权题目 · ${counts.total} 道`;
}

function reviewBlocks(question, translations, explanations, chosen, isCorrect) {
  const translation = translations[question.id] ?? {};
  const explanation = explanations[question.id] ?? {};
  return `<div class="review">
    <div class="review-block ${isCorrect === true ? 'good' : isCorrect === false ? 'bad' : ''}">
      <h4>平台评分依据</h4>
      ${chosen !== undefined ? `<p>你的答案：<b>${escapeHtml(asAnswer(chosen))}</b></p>` : ''}
      <p>平台答案：<b>${escapeHtml(asAnswer(question.answer))}</b></p>
    </div>
    ${reviewedChoiceOptions(question, translation, chosen)}
    <div class="review-block"><h4>English question and options</h4>${renderEnglishStudyContent(question)}</div>
    ${renderChineseStudyContent(question, translation)}
    ${bilingualExplanationBlocks(explanation)}
    ${knowledgeExtension(explanation, question.id)}
    <div class="review-block"><h4>易错提示</h4><p>先锁定题干中的限定词，再按英文原题和平台答案评分；中文内容只用于理解与复盘。</p></div>
  </div>`;
}

function answerControl(question, answer, locked = false) {
  if (question.questionType === 'single-choice') {
    return `<div class="options">${Object.entries(question.optionsEn).map(([key, text]) => {
      const classes = ['option'];
      if (answer === key) classes.push('selected');
      if (locked && key === question.answer) classes.push('correct');
      if (locked && answer === key && answer !== question.answer) classes.push('wrong');
      return `<button class="${classes.join(' ')}" type="button" data-answer="${escapeHtml(key)}" ${locked ? 'disabled' : ''}><span class="option-key">${escapeHtml(key)}</span><span>${escapeHtml(text)}</span></button>`;
    }).join('')}</div>`;
  }
  if (question.questionType === 'fill-blank') {
    return `<label><span class="eyebrow">YOUR ANSWER</span><input class="text-answer" data-fill-answer value="${escapeHtml(answer ?? '')}" placeholder="输入英文答案" ${locked ? 'disabled' : ''}></label>`;
  }
  if (question.questionType === 'matching') {
    return `<div>${Object.entries(question.statementsEn).map(([statementId, statement]) => `<label class="matching-row"><span><b>${escapeHtml(statementId)}.</b> ${escapeHtml(statement)}</span><select class="match-select" data-match="${escapeHtml(statementId)}" ${locked ? 'disabled' : ''}><option value="">请选择定义</option>${Object.entries(question.optionsEn).map(([key, value]) => `<option value="${escapeHtml(key)}" ${answer?.[statementId] === key ? 'selected' : ''}>${escapeHtml(key)} · ${escapeHtml(value)}</option>`).join('')}</select></label>`).join('')}</div>`;
  }
  return '<p class="notice error">暂不支持此题型。</p>';
}

export class StudyApp {
  constructor(root, subjects, content, options = {}) {
    this.root = root;
    this.subjects = subjects;
    this.content = content;
    this.onForgetDevice = options.onForgetDevice ?? null;
    this.rememberUnsupported = options.rememberUnsupported === true;
    this.subject = { ...subjects.find(item => item.id === content.manifest.subjectId), ...content.manifest };
    this.state = loadSubjectState(localStorage, this.subject.id, {}, content.questions.map(question => question.id));
    const m9Assessment = this.m9Assessment();
    this.m9State = m9Assessment
      ? loadSubjectState(localStorage, 'm9', {}, m9Assessment.questions.map(question => question.id))
      : null;
    this.moduleStates = {};
    this.moduleReviews = {};
    this.moduleGuides = {};
    this.moduleExams = {};
    this.moduleReviewOpen = {};
    for (const guide of content.studyGuides ?? []) {
      const id = guide.manifest.id;
      if (id !== 'm9') this.moduleGuides[id] = { chapterId: null, query: '', all: false };
      if (id === 'm9' || !guide.questions?.length) continue;
      this.moduleStates[id] = loadSubjectState(localStorage, id, {}, guide.questions.map(question => question.id));
      this.moduleReviews[id] = { chapterId: null, source: 'all', query: '' };
      this.moduleExams[id] = null;
      this.moduleReviewOpen[id] = new Set();
    }
    this.route = 'home';
    this.review = { chapterId: null, source: 'all', query: '' };
    this.m9Review = { chapterId: null, source: 'all', query: '' };
    this.guide = { chapterId: null, query: '', all: false };
    this.exam = null;
    this.m9Exam = null;
    this.reviewOpen = new Set();
    this.m9ReviewOpen = new Set();
    this.wrongOpen = new Set();
    this.knowledgeReturn = null;
    this.flash = '';
    this.timer = null;
  }

  start() {
    this.render();
  }

  persist() {
    saveSubjectState(localStorage, this.state);
  }

  setRoute(route) {
    if (route !== 'exam' && this.exam?.result == null && this.exam?.session) {
      if (!confirm('模拟考试仍在进行，离开会丢失本次未提交答案。确定离开？')) return;
      this.stopTimer();
      this.exam = null;
    }
    if (route !== 'm9-exam' && this.m9Exam?.result == null && this.m9Exam?.session) {
      if (!confirm('M9 模拟考试仍在进行，离开会丢失本次未提交答案。确定离开？')) return;
      this.stopTimer();
      this.m9Exam = null;
    }
    for (const [id, exam] of Object.entries(this.moduleExams)) {
      if (route !== `${id}-exam` && exam?.result == null && exam?.session) {
        if (!confirm(`${id.toUpperCase()} 模拟考试仍在进行，离开会丢失本次未提交答案。确定离开？`)) return;
        this.stopTimer();
        this.moduleExams[id] = null;
      }
    }
    this.knowledgeReturn = null;
    this.route = route;
    this.flash = '';
    this.render();
  }

  nav() {
    const m9Assessment = this.m9Assessment();
    const items = [
      ['home', '⌂', '总览'], ['practice', 'HI', 'HI 真题与知识点'],
      ...(this.studyGuide('hi') ? [['hi-guide', '◎', 'HI 完整双语考点']] : []),
      ...(m9Assessment ? [['m9-review', 'M9', 'M9 真题与知识点']] : []),
      ...(this.m9Guide() ? [['m9', '◎', 'M9 完整考点']] : []),
      ['exam', '◷', 'HI 模拟考试'],
      ...(m9Assessment ? [['m9-exam', '◷', 'M9 模拟考试']] : []),
      ...(m9Assessment ? [['m9-wrongbook', '!', 'M9 错题本']] : []),
      ...this.supplementalModules().flatMap(({ id, label }) => [
        [`${id}-review`, '◈', `${label} 题库与知识点`],
        [`${id}-guide`, '◎', `${label} 完整考点`],
        [`${id}-exam`, '◷', `${label} 模拟考试`],
        [`${id}-wrongbook`, '!', `${label} 错题本`],
      ]),
      ['wrongbook', '!', 'HI 错题本'], ['weak', '▥', 'HI 薄弱项'], ['settings', '↥', '进度管理'],
    ];
    return `<aside class="sidebar">
      <div class="brand-lockup"><div class="brand-mark">SCI</div><div><h1>SCI Prep</h1><p>Private study workspace</p></div></div>
      <nav class="nav" aria-label="主导航">${items.map(([id, icon, label]) => `<button type="button" class="${this.route === id ? 'active' : ''}" data-route="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}</nav>
      <div class="side-note">HI 8th Edition V1.2${this.m9Guide() ? '<br>M9 7th Edition V1.1' : ''}${this.supplementalModules().map(module => `<br>${module.label} ${escapeHtml(module.guide.manifest.edition ?? '')}`).join('')}<br>英文教材与平台答案为准<br>本地存储 · 不上传进度</div>
    </aside>`;
  }

  render() {
    let view;
    if (this.route === 'practice') view = this.renderPractice();
    else if (this.route === 'm9-review') view = this.renderM9Review();
    else if (this.route === 'm9') view = this.renderM9();
    else if (this.route === 'm9-exam') view = this.renderM9Exam();
    else if (this.route === 'm9-wrongbook') view = this.renderM9Wrongbook();
    else if (this.route === 'exam') view = this.renderExam();
    else if (this.route === 'wrongbook') view = this.renderWrongbook();
    else if (this.route === 'weak') view = this.renderWeak();
    else if (this.route === 'settings') view = this.renderSettings();
    else if (/^(m8a|m9a)-review$/u.test(this.route)) view = this.renderModuleReview(this.route.split('-')[0]);
    else if (/^(hi|m8a|m9a)-guide$/u.test(this.route)) view = this.renderModuleGuide(this.route.split('-')[0]);
    else if (/^(m8a|m9a)-exam$/u.test(this.route)) view = this.renderModuleExam(this.route.split('-')[0]);
    else if (/^(m8a|m9a)-wrongbook$/u.test(this.route)) view = this.renderModuleWrongbook(this.route.split('-')[0]);
    else view = this.renderHome();
    const sessionOnlyNotice = this.rememberUnsupported
      ? '<div class="notice warning" role="status" aria-live="polite" data-session-only-unlock>这台浏览器无法记住此设备；本次可继续学习，下次访问需要重新输入密码。</div>'
      : '';
    this.root.innerHTML = `<div class="shell">${this.nav()}<main class="main">${sessionOnlyNotice}${this.flash ? `<div class="notice success">${escapeHtml(this.flash)}</div>` : ''}${view}</main></div>`;
    this.bind();
  }

  renderHome() {
    const { checkpoint: checkpointCount, mock: mockCount } = countReviewSources(this.content.questions);
    const m9 = this.m9Guide();
    const m9Assessment = this.m9Assessment();
    const lastExam = this.state.examHistory.at(-1);
    const warnings = this.content.warnings.length ? `<div class="notice warning">有 ${this.content.warnings.length} 个内容文件包含警告；其余章节仍可使用。</div>` : '';
    return `${header('SCI Prep', m9 ? 'HI 题库与 M9 完整考点复习工作台' : 'HI 8th Edition · 双语备考工作台')}
      ${warnings}
      <section class="hero"><p class="eyebrow" style="color:#d9af5c">PRIVATE · LOCAL FIRST</p><h2>全部 ${this.content.questions.length} 道授权题目，<br>都可直接阅读。</h2><p>${checkpointCount} 道章节题与 ${mockCount} 道模拟题，打开即看中文翻译、答案、题解与教材依据。模拟考试保持独立的闭卷模式，按 SCI 原始 15 个题池配额随机抽取 50 题；考试中不显示翻译、答案或题解。</p><div class="hero-tags"><span class="hero-tag">${checkpointCount} 道章节题</span><span class="hero-tag">${mockCount} 道模拟题</span><span class="hero-tag">75 分钟</span><span class="hero-tag">70% 及格</span></div></section>
      <section class="grid stats">
        <button class="card stat stat-action" type="button" data-review-preset="all"><b>${this.content.questions.length}</b><span>完整授权题目 · 点击查看</span></button>
        <button class="card stat stat-action" type="button" data-review-preset="checkpoint"><b>${checkpointCount}</b><span>章节题 · 点击查看</span></button>
        ${m9Assessment
          ? `<button class="card stat stat-action" type="button" data-route="m9-review"><b>${m9Assessment.questions.length}</b><span>M9 完整授权题目 · 点击查看</span></button>`
          : `<div class="card stat"><b>${m9?.chapters.length ?? this.state.wrongbook.length}</b><span>${m9 ? 'M9 完整章节' : '待复盘错题'}</span></div>`}
        <div class="card stat"><b>${lastExam ? percent(lastExam.rate) : '—'}</b><span>最近模拟成绩</span></div>
      </section>
      <section class="grid actions">
        <button class="action-card" data-route="practice"><span class="action-index">01</span><h3>HI 真题与知识点</h3><p>按 15 章浏览全部 192 道真题，中英文、正确答案、题解和教材依据全部展开。</p></button>
        ${this.studyGuide('hi') ? '<button class="action-card" data-route="hi-guide"><span class="action-index">◎</span><h3>HI 完整双语考点</h3><p>15 章教材考点全部按 English → 中文逐段成对展示，不再出现仅中文的补充区。</p></button>' : ''}
        ${m9Assessment ? '<button class="action-card" data-route="m9-review"><span class="action-index">02</span><h3>M9 真题与知识点</h3><p>251 道授权题目，含 51 道章节题和 200 道 Mock 题；每题链接教材知识点与变形考法。</p></button>' : ''}
        ${m9 ? `<button class="action-card" data-route="m9"><span class="action-index">${m9Assessment ? '03' : '02'}</span><h3>M9 完整考点</h3><p>17 章教材考点按主题直接展开，中英文逐段对应。</p></button>` : ''}
        <button class="action-card" data-route="exam"><span class="action-index">${m9Assessment ? '04' : m9 ? '03' : '02'}</span><h3>HI Mock Paper</h3><p>从 150 题池按 SCI 配额抽 50 题，完整计时评分。</p></button>
        ${m9Assessment ? '<button class="action-card" data-route="m9-exam"><span class="action-index">05</span><h3>M9 Mock Paper</h3><p>从 200 题池按 17 章原始配额抽 100 题，120 分钟完整计时。</p></button>' : ''}
        ${this.supplementalModules().map(({ id, label, guide }) => {
          const counts = countReviewSources(guide.questions);
          return `<button class="action-card" data-route="${id}-review"><span class="action-index">${label}</span><h3>${label} 题库与知识点</h3><p>${guide.questions.length} 道唯一题，覆盖 ${counts.checkpoint} 个章节题位与 ${counts.mock} 个 Mock 题位；含双语题解和教材跳转。</p></button><button class="action-card" data-route="${id}-exam"><span class="action-index">◷</span><h3>${label} Mock Paper</h3><p>50 题、60 分钟、70% 及格，考试中隐藏翻译和答案。</p></button>`;
        }).join('')}
      </section>`;
  }

  supplementalModules() {
    return ['m8a', 'm9a'].map(id => {
      const guide = this.content.studyGuides?.find(item => item.manifest.id === id);
      return guide?.questions?.length ? { id, label: id.toUpperCase(), guide } : null;
    }).filter(Boolean);
  }

  moduleAssessment(id) {
    const guide = this.studyGuide(id);
    if (!guide?.questions?.length) return null;
    return {
      manifest: guide.manifest,
      chapters: guide.chapters,
      documents: guide.documents,
      questions: guide.questions,
      translations: guide.translations,
      explanations: guide.explanations,
    };
  }

  studyGuide(id) {
    return this.content.studyGuides?.find(item => item.manifest.id === id) ?? null;
  }

  m9Guide() {
    return this.content.studyGuides?.find(guide => guide.manifest.id === 'm9') ?? null;
  }

  m9Assessment() {
    const guide = this.m9Guide();
    if (!guide?.questions?.length) return null;
    return {
      manifest: guide.manifest,
      chapters: guide.chapters,
      questions: guide.questions,
      translations: guide.translations,
      explanations: guide.explanations,
    };
  }

  renderM9() {
    const guide = this.m9Guide();
    if (!guide) return `${header('M9 完整考点', '内容尚未通过发布门禁。', '', 'SCI · MODULE 9')}<div class="card empty">M9 资料暂不可用。</div>`;
    const edition = guide.manifest.edition ?? '';
    const hiShortcut = '<button class="button ghost" data-route="practice">HI 真题与知识点</button>';
    if (this.guide.all) {
      return `${header('M9 连续复习', `${guide.chapters.length} 章完整考点 · ${edition}`, `${hiShortcut}<button class="button ghost" data-action="choose-guide-chapter">返回章节目录</button>`, 'SCI · MODULE 9')}
        <section class="guide-document guide-all">${guide.chapters.map(chapter => `<article class="card guide-chapter" id="m9-${escapeHtml(chapter.id)}"><p class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</p><h2>${escapeHtml(chapter.title)}</h2>${renderBilingualStudyMarkdown(guide.documents[chapter.file], chapter.id, escapeHtml)}</article>`).join('')}</section>`;
    }
    if (!this.guide.chapterId) {
      const visibleChapters = selectStudyGuideChapters(guide, this.guide.query);
      return `${header('M9 完整考点', `${edition} · 中英文双语讲解`, `${hiShortcut}<button class="button" data-guide-all>连续阅读全部 ${guide.chapters.length} 章</button>`, 'SCI · MODULE 9')}
        <section class="hero m9-hero"><p class="eyebrow" style="color:#d9af5c">COMPLETE BILINGUAL NOTES</p><h2>从教材结构出发，<br>直接掌握全部考点。</h2><p>不是模拟卷，也不要求先答题。每段英文讲解后面紧跟对应的中文解释，逐段对照阅读，不需要自己来回查找。</p><div class="hero-tags"><span class="hero-tag">${guide.chapters.length} 章</span><span class="hero-tag">${escapeHtml(guide.manifest.bilingualPairCount)} 组逐段对应</span><span class="hero-tag">English → 中文</span><span class="hero-tag">教材页码</span></div></section>
        <section class="card guide-search"><label class="review-control"><span>搜索全部考点</span><input type="search" data-guide-query value="${escapeHtml(this.guide.query)}" placeholder="例如：insurable interest、ILP、nomination"></label><p class="review-count">匹配 ${visibleChapters.length} / ${guide.chapters.length} 章</p></section>
        <section class="grid chapter-grid">${visibleChapters.length ? visibleChapters.map(chapter => `<button class="chapter-card" type="button" data-guide-chapter="${escapeHtml(chapter.id)}"><span class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</span><h3>${escapeHtml(chapter.title)}</h3><span>教材第 ${escapeHtml(chapter.sourcePageStart)} 页起 · 查看完整考点</span></button>`).join('') : '<div class="card empty">没有匹配章节，请更换关键词。</div>'}</section>`;
    }
    const chapterIndex = guide.chapters.findIndex(chapter => chapter.id === this.guide.chapterId);
    const chapter = guide.chapters[chapterIndex];
    if (!chapter) {
      this.guide = { chapterId: null, query: '', all: false };
      return this.renderM9();
    }
    const returnShortcut = this.knowledgeReturn
      ? '<button class="button" data-action="return-knowledge-question">返回刚才题目</button>'
      : '';
    const actions = `${returnShortcut}${hiShortcut}<button class="button ghost" data-action="choose-guide-chapter">章节目录</button><button class="button ghost" data-guide-prev ${chapterIndex === 0 ? 'disabled' : ''}>上一章</button><button class="button" data-guide-next ${chapterIndex === guide.chapters.length - 1 ? 'disabled' : ''}>下一章</button>`;
    return `${header(`Chapter ${chapter.number}`, chapter.title, actions, 'SCI · MODULE 9')}
      <article class="card guide-chapter"><p class="guide-source">教材第 ${escapeHtml(chapter.sourcePageStart)} 页起 · ${escapeHtml(edition)}</p>${renderBilingualStudyMarkdown(guide.documents[chapter.file], chapter.id, escapeHtml)}</article>`;
  }

  renderModuleGuide(id) {
    const guide = this.studyGuide(id);
    const state = this.moduleGuides[id];
    const label = id.toUpperCase();
    const guideTitle = id === 'hi' ? `${label} 完整双语考点` : `${label} 完整考点`;
    if (!guide || !state) return `${header(guideTitle, '内容尚未通过发布门禁。')}<div class="card empty">${label} 资料暂不可用。</div>`;
    const edition = guide.manifest.edition ?? '';
    if (state.all) {
      return `${header(`${label} 连续复习`, `${guide.chapters.length} 章完整考点 · ${edition}`, `<button class="button ghost" data-module-guide-home="${id}">返回章节目录</button>`, `SCI · ${label}`)}
        <section class="guide-document guide-all">${guide.chapters.map(chapter => `<article class="card guide-chapter"><p class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</p><h2>${escapeHtml(chapter.title)}</h2>${renderBilingualStudyMarkdown(guide.documents[chapter.file], chapter.id, escapeHtml)}</article>`).join('')}</section>`;
    }
    if (!state.chapterId) {
      const visible = selectStudyGuideChapters(guide, state.query);
      return `${header(guideTitle, `${edition} · 中英文逐段成对讲解`, `<button class="button" data-module-guide-all="${id}">连续阅读全部 ${guide.chapters.length} 章</button>`, `SCI · ${label}`)}
        <section class="hero m9-hero"><p class="eyebrow" style="color:#d9af5c">COMPLETE BILINGUAL NOTES</p><h2>${guide.chapters.length} 章教材考点，逐段双语对应。</h2><p>按教材结构复习定义、产品机制、风险、治理、适合性和案例判断，并可从每道题直接跳到对应知识点。</p><div class="hero-tags"><span class="hero-tag">${guide.chapters.length} 章</span><span class="hero-tag">${guide.manifest.bilingualPairCount} 组知识点</span><span class="hero-tag">English → 中文</span></div></section>
        <section class="card guide-search"><label class="review-control"><span>搜索全部考点</span><input type="search" data-module-guide-query="${id}" value="${escapeHtml(state.query)}" placeholder="搜索产品、风险或衍生工具"></label><p class="review-count">匹配 ${visible.length} / ${guide.chapters.length} 章</p></section>
        <section class="grid chapter-grid">${visible.map(chapter => `<button class="chapter-card" type="button" data-module-guide-chapter="${id}:${chapter.id}"><span class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</span><h3>${escapeHtml(chapter.title)}</h3><span>教材第 ${chapter.sourcePageStart} 页起</span></button>`).join('')}</section>`;
    }
    const index = guide.chapters.findIndex(chapter => chapter.id === state.chapterId);
    const chapter = guide.chapters[index];
    if (!chapter) {
      this.moduleGuides[id] = { chapterId: null, query: '', all: false };
      return this.renderModuleGuide(id);
    }
    const returnButton = this.knowledgeReturn ? '<button class="button" data-action="return-knowledge-question">返回刚才题目</button>' : '';
    return `${header(`${label} Chapter ${chapter.number}`, chapter.title, `${returnButton}<button class="button ghost" data-module-guide-home="${id}">章节目录</button><button class="button ghost" data-module-guide-step="${id}:-1" ${index === 0 ? 'disabled' : ''}>上一章</button><button class="button" data-module-guide-step="${id}:1" ${index === guide.chapters.length - 1 ? 'disabled' : ''}>下一章</button>`, `SCI · ${label}`)}
      <article class="card guide-chapter"><p class="guide-source">教材第 ${chapter.sourcePageStart} 页起 · ${escapeHtml(edition)}</p>${renderBilingualStudyMarkdown(guide.documents[chapter.file], chapter.id, escapeHtml)}</article>`;
  }

  renderModuleReview(id) {
    const content = this.moduleAssessment(id);
    const label = id.toUpperCase();
    const review = this.moduleReviews[id];
    if (!content || !review) return `${header(`${label} 题库与知识点`, '题库尚未通过发布门禁。')}<div class="card empty">${label} 题库暂不可用。</div>`;
    if (!review.chapterId) {
      const counts = countReviewSources(content.questions);
      return `${header(`${label} 题库与知识点`, '英文原题、中文翻译、平台答案、教材依据、知识点和变形考法全部展开。', `<button class="button ghost" data-route="${id}-guide">${label} 完整考点</button>`, `SCI · ${label}`)}
        <section class="grid review-presets"><button class="card review-preset" data-module-review-preset="${id}:all"><b>${counts.total}</b><span>唯一题目</span><small>覆盖全部原始题位</small></button><button class="card review-preset" data-module-review-preset="${id}:checkpoint"><b>${counts.checkpoint}</b><span>章节题</span><small>6 章，每章 3 题</small></button><button class="card review-preset" data-module-review-preset="${id}:mock"><b>${counts.mock}</b><span>Mock 唯一题</span><small>完整授权题池</small></button></section>
        <section class="grid chapter-grid">${content.chapters.map(chapter => { const count = selectReviewQuestions(content.questions, content.translations, content.explanations, { chapterId: chapter.id }).length; return `<button class="chapter-card" data-module-review-chapter="${id}:${chapter.id}"><span class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</span><h3>${escapeHtml(chapter.title)}</h3><span>${count} 道唯一题目</span></button>`; }).join('')}</section>`;
    }
    const all = review.chapterId === 'all';
    const scoped = selectReviewQuestions(content.questions, content.translations, content.explanations, all ? {} : { chapterId: review.chapterId });
    const visible = selectReviewQuestions(scoped, content.translations, content.explanations, { source: review.source, query: review.query });
    const counts = countReviewSources(scoped);
    const chapter = content.chapters.find(item => item.id === review.chapterId);
    const title = all ? reviewPresetLabel(label, review.source, counts) : `${label} Chapter ${chapter?.number}`;
    return `${header(title, all ? '全部内容直接展开；可按来源和关键词筛选。' : chapter?.title ?? '', `<button class="button ghost" data-route="${id}-guide">查看对应考点</button><button class="button ghost" data-module-review-home="${id}">返回题库入口</button>`, `SCI · ${label}`)}
      <section class="card review-toolbar"><label class="review-control"><span>题目来源</span><select data-module-review-source="${id}"><option value="all" ${review.source === 'all' ? 'selected' : ''}>全部 ${counts.total}</option><option value="checkpoint" ${review.source === 'checkpoint' ? 'selected' : ''}>章节题 ${counts.checkpoint}</option><option value="mock" ${review.source === 'mock' ? 'selected' : ''}>模拟题 ${counts.mock}</option></select></label><label class="review-control"><span>搜索题目</span><input type="search" data-module-review-query="${id}" value="${escapeHtml(review.query)}"></label><p class="review-count">当前 ${visible.length} / ${scoped.length}</p></section>
      <section class="study-list">${visible.length ? visible.map((question, index) => studyCard(question, content.translations, content.explanations, index + 1)).join('') : '<div class="card empty">没有匹配题目。</div>'}</section>`;
  }

  renderModuleExam(id) {
    const content = this.moduleAssessment(id);
    const label = id.toUpperCase();
    const exam = this.moduleExams[id];
    if (!content) return `${header(`${label} Mock Paper`, '题库尚未通过发布门禁。')}<div class="card empty">暂不可用。</div>`;
    const gateErrors = validateMockPool(content.questions, content.manifest.exam);
    if (!exam) {
      const rules = content.manifest.exam;
      return `${header(`${label} Mock Paper`, `按章节题池配额抽题，开始后计时 ${rules.durationMinutes} 分钟。`, `<button class="button ghost" data-route="${id}-review">${label} 题库与知识点</button>`, `SCI · ${label}`)}
        <section class="hero m9-hero"><p class="eyebrow" style="color:#d9af5c">OFFICIAL-FORMAT EXAM MODE</p><h2>${rules.questionCount} 道题，${rules.durationMinutes} 分钟。</h2><p>按授权 Mock 题池的章节分布抽题；考试中不显示翻译、答案、题解或知识点。</p><div class="hero-tags"><span class="hero-tag">${rules.questionCount} 题</span><span class="hero-tag">${rules.durationMinutes} 分钟</span><span class="hero-tag">${Math.ceil(rules.questionCount * rules.passingRate)} 题及格</span><span class="hero-tag">不倒扣</span></div></section>
        ${gateErrors.length ? `<div class="notice error">内容门禁未通过：${gateErrors.map(escapeHtml).join('；')}</div>` : `<div class="notice success">题池门禁通过：${rules.sourcePoolQuestionCount} 道唯一 Mock 题 · ${rules.sourcePoolCount} 个章节池。</div>`}<div style="margin-top:18px"><button class="button" data-module-exam-start="${id}" ${gateErrors.length ? 'disabled' : ''}>开始 ${label} 模拟考试</button></div>`;
    }
    if (exam.result) {
      const result = exam.result;
      const opened = this.moduleReviewOpen[id];
      return `${header(`${label} 考试结果`, `${result.correct}/${result.total} · ${result.pass ? '通过' : '未通过'}`, `<button class="button" data-module-exam-reset="${id}">再考一次</button>`, `SCI · ${label}`)}<section class="card score-card"><div class="score-ring ${result.pass ? 'pass' : 'fail'}">${percent(result.rate)}</div><div><h2>${result.correct} / ${result.total}</h2><p class="subtle">未作答 ${result.unanswered} 题；展开题目查看完整复盘。</p></div></section><section class="review-list">${result.rows.map((row, index) => `<article class="card review-item" data-review-card="${escapeHtml(row.question.id)}"><button class="review-summary" data-module-result-row="${id}:${index}" aria-expanded="${opened.has(index)}"><span class="result-badge ${row.isCorrect ? 'good' : 'bad'}">${row.isCorrect ? '正确' : '复盘'}</span><span><b>第 ${index + 1} 题</b><br><span class="subtle">${escapeHtml(row.question.stemEn)}</span></span><span class="review-chevron">${opened.has(index) ? '−' : '+'}</span></button>${opened.has(index) ? reviewBlocks(row.question, content.translations, content.explanations, row.chosen, row.isCorrect) : ''}</article>`).join('')}</section>`;
    }
    const question = exam.session.questions[exam.index];
    return `${header(`${label} 模拟考试进行中`, '答案与题解将在交卷后显示。', `<span class="timer" id="module-exam-timer">${this.formatTime(remainingSeconds(exam.session))}</span>`, `SCI · ${label}`)}<div class="question-layout"><article class="card question-card"><div class="question-meta"><span>${label} Mock Paper · 单选题</span><span>${exam.index + 1} / ${exam.session.questions.length}</span></div><div class="question-stem">${escapeHtml(question.stemEn)}</div>${answerControl(question, exam.answers[question.id], false)}<div class="question-actions"><div class="action-group"><button class="button ghost" data-module-exam-step="${id}:-1" ${exam.index === 0 ? 'disabled' : ''}>上一题</button><button class="button ghost" data-module-exam-step="${id}:1" ${exam.index === exam.session.questions.length - 1 ? 'disabled' : ''}>下一题</button></div><button class="button danger" data-module-exam-submit="${id}">交卷</button></div></article>${this.renderQuestionNav(exam.session.questions, exam.index, exam.answers)}</div>`;
  }

  renderModuleWrongbook(id) {
    const content = this.moduleAssessment(id);
    const state = this.moduleStates[id];
    const label = id.toUpperCase();
    if (!content || !state) return `${header(`${label} 错题本`, '题库尚未通过发布门禁。')}<div class="card empty">暂不可用。</div>`;
    const questions = state.wrongbook.map(questionId => content.questions.find(question => question.id === questionId)).filter(Boolean);
    return `${header(`${label} 错题本`, `${questions.length} 道待复盘题目`, questions.length ? `<button class="button danger" data-module-wrong-clear="${id}">清空 ${label} 错题</button>` : '', `SCI · ${label}`)}
      ${questions.length ? `<section class="review-list">${questions.map((question, index) => `<article class="card review-item"><button class="review-summary" type="button" data-wrong-review="${escapeHtml(question.id)}" aria-expanded="${this.wrongOpen.has(question.id)}"><span class="result-badge bad">${index + 1}</span><span><b>${escapeHtml(question.chapterId.toUpperCase())}</b><br><span class="subtle">${escapeHtml(question.stemEn)}</span></span><span class="review-chevron">${this.wrongOpen.has(question.id) ? '−' : '+'}</span></button>${this.wrongOpen.has(question.id) ? `${reviewBlocks(question, content.translations, content.explanations, state.answerLog[question.id]?.lastWrongAnswer, false)}<div class="question-actions"><span></span><button class="button secondary" data-module-remove-wrong="${id}:${escapeHtml(question.id)}">已掌握，移出错题本</button></div>` : ''}</article>`).join('')}</section>` : `<div class="card empty"><p>提交 ${label} 模拟考试后，答错题目会自动加入这里。</p><button class="button" data-route="${id}-exam">开始模拟考试</button></div>`}`;
  }

  renderPractice() {
    if (!this.review.chapterId) {
      const counts = countReviewSources(this.content.questions);
      return `${header('HI 真题与知识点', '选择一个章节，直接查看全部英文原题、中文辅助翻译、正确答案、题解与教材依据。', '', 'SCI · HEALTH INSURANCE')}
        <section class="grid review-presets" aria-label="HI 题库快捷入口">
          <button class="card review-preset" type="button" data-review-preset="all"><b>${counts.total}</b><span>完整授权题目</span><small>全部章节题与 Mock 题</small></button>
          <button class="card review-preset" type="button" data-review-preset="checkpoint"><b>${counts.checkpoint}</b><span>章节 Learning Checkpoint</span><small>只看 42 道章节题</small></button>
          <button class="card review-preset" type="button" data-review-preset="mock"><b>${counts.mock}</b><span>Mock 完整题池</span><small>查看全部 150 道 Mock 题</small></button>
        </section>
        <section class="grid chapter-grid">${this.content.chapters.map(chapter => {
          const counts = countReviewSources(selectReviewQuestions(
            this.content.questions,
            this.content.translations,
            this.content.explanations,
            { chapterId: chapter.id },
          ));
          return `<button class="chapter-card" type="button" data-chapter="${escapeHtml(chapter.id)}" ${counts.total ? '' : 'disabled'}><span class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</span><h3>${escapeHtml(chapter.title)}</h3><span>${counts.total ? `${counts.total} 道完整题目` : '暂无题目'}</span></button>`;
        }).join('')}</section>`;
    }
    const allChapters = this.review.chapterId === 'all';
    const chapterQuestions = allChapters
      ? selectReviewQuestions(this.content.questions, this.content.translations, this.content.explanations)
      : selectReviewQuestions(
        this.content.questions,
        this.content.translations,
        this.content.explanations,
        { chapterId: this.review.chapterId },
      );
    const visibleQuestions = selectReviewQuestions(
      chapterQuestions,
      this.content.translations,
      this.content.explanations,
      { source: this.review.source, query: this.review.query },
    );
    const chapterNumbers = new Map(chapterQuestions.map((question, index) => [question.id, index + 1]));
    const counts = countReviewSources(chapterQuestions);
    const chapter = this.content.chapters.find(item => item.id === this.review.chapterId);
    const title = allChapters
      ? reviewPresetLabel('HI', this.review.source, counts)
      : `Chapter ${chapter?.number ?? Number(this.review.chapterId.slice(2))}`;
    const subtitle = allChapters
      ? '全部英文原题、中文辅助翻译、正确答案、题解与教材依据直接展开。'
      : chapter?.title ?? '';
    const scopeLabel = allChapters ? '全部题库' : '本章';
    return `${header(title, subtitle, '<button class="button ghost" data-action="choose-chapter">返回题库入口</button>')}
      <section class="card review-toolbar">
        <label class="review-control"><span>题目来源</span><select data-review-source><option value="all" ${this.review.source === 'all' ? 'selected' : ''}>全部 ${counts.total}</option><option value="checkpoint" ${this.review.source === 'checkpoint' ? 'selected' : ''}>章节题 ${counts.checkpoint}</option><option value="mock" ${this.review.source === 'mock' ? 'selected' : ''}>模拟题 ${counts.mock}</option></select></label>
        <label class="review-control"><span>搜索题目</span><input type="search" data-review-query value="${escapeHtml(this.review.query)}" placeholder="搜索中英文题目或题解"></label>
        <p class="review-count">当前 ${visibleQuestions.length} / ${scopeLabel} ${chapterQuestions.length}</p>
      </section>
      <section class="study-list">${visibleQuestions.length
        ? visibleQuestions.map(question => studyCard(question, this.content.translations, this.content.explanations, chapterNumbers.get(question.id))).join('')
        : '<div class="card empty">没有匹配题目，请调整筛选条件。</div>'}
      </section>`;
  }

  renderM9Review() {
    const content = this.m9Assessment();
    if (!content) {
      return `${header('M9 真题与知识点', '题库尚未通过发布门禁。', '<button class="button ghost" data-route="m9">查看完整考点</button>', 'SCI · MODULE 9')}<div class="card empty">M9 题库暂不可用。</div>`;
    }
    if (!this.m9Review.chapterId) {
      const counts = countReviewSources(content.questions);
      return `${header('M9 真题与知识点', '英文原题、中文翻译、平台答案、深度题解、教材知识点和变形考法全部直接展开。', '<button class="button ghost" data-route="m9">M9 完整考点</button>', 'SCI · MODULE 9')}
        <section class="grid review-presets" aria-label="M9 题库快捷入口">
          <button class="card review-preset" type="button" data-m9-review-preset="all"><b>${counts.total}</b><span>完整授权题目</span><small>51 道章节题与 200 道 Mock 题</small></button>
          <button class="card review-preset" type="button" data-m9-review-preset="checkpoint"><b>${counts.checkpoint}</b><span>章节 Learning Checkpoint</span><small>17 章，每章 3 道</small></button>
          <button class="card review-preset" type="button" data-m9-review-preset="mock"><b>${counts.mock}</b><span>Mock 完整题池</span><small>17 个章节池，共 200 道</small></button>
        </section>
        <section class="grid chapter-grid">${content.chapters.map(chapter => {
          const counts = countReviewSources(selectReviewQuestions(
            content.questions,
            content.translations,
            content.explanations,
            { chapterId: chapter.id },
          ));
          return `<button class="chapter-card" type="button" data-m9-chapter="${escapeHtml(chapter.id)}"><span class="chapter-number">CHAPTER ${String(chapter.number).padStart(2, '0')}</span><h3>${escapeHtml(chapter.title)}</h3><span>${counts.total} 道完整题目</span></button>`;
        }).join('')}</section>`;
    }
    const allChapters = this.m9Review.chapterId === 'all';
    const chapterQuestions = allChapters
      ? selectReviewQuestions(content.questions, content.translations, content.explanations)
      : selectReviewQuestions(
        content.questions,
        content.translations,
        content.explanations,
        { chapterId: this.m9Review.chapterId },
      );
    const visibleQuestions = selectReviewQuestions(
      chapterQuestions,
      content.translations,
      content.explanations,
      { source: this.m9Review.source, query: this.m9Review.query },
    );
    const chapterNumbers = new Map(chapterQuestions.map((question, index) => [question.id, index + 1]));
    const counts = countReviewSources(chapterQuestions);
    const chapter = content.chapters.find(item => item.id === this.m9Review.chapterId);
    const title = allChapters
      ? reviewPresetLabel('M9', this.m9Review.source, counts)
      : `M9 Chapter ${chapter?.number ?? Number(this.m9Review.chapterId.slice(2))}`;
    const subtitle = allChapters
      ? '所有内容直接展开；题解不是题干翻译，而是规则、推理、干扰项分析和变形考法。'
      : chapter?.title ?? '';
    const scopeLabel = allChapters ? '全部题库' : '本章';
    return `${header(title, subtitle, '<button class="button ghost" data-route="m9">查看对应考点</button><button class="button ghost" data-action="choose-m9-chapter">返回题库入口</button>', 'SCI · MODULE 9')}
      <section class="card review-toolbar">
        <label class="review-control"><span>题目来源</span><select data-m9-review-source><option value="all" ${this.m9Review.source === 'all' ? 'selected' : ''}>全部 ${counts.total}</option><option value="checkpoint" ${this.m9Review.source === 'checkpoint' ? 'selected' : ''}>章节题 ${counts.checkpoint}</option><option value="mock" ${this.m9Review.source === 'mock' ? 'selected' : ''}>模拟题 ${counts.mock}</option></select></label>
        <label class="review-control"><span>搜索题目</span><input type="search" data-m9-review-query value="${escapeHtml(this.m9Review.query)}" placeholder="搜索中英文题目、知识点或题解"></label>
        <p class="review-count">当前 ${visibleQuestions.length} / ${scopeLabel} ${chapterQuestions.length}</p>
      </section>
      <section class="study-list">${visibleQuestions.length
        ? visibleQuestions.map(question => studyCard(question, content.translations, content.explanations, chapterNumbers.get(question.id))).join('')
        : '<div class="card empty">没有匹配题目，请调整筛选条件。</div>'}
      </section>`;
  }

  renderM9Exam() {
    const content = this.m9Assessment();
    if (!content) {
      return `${header('M9 Mock Paper', '题库尚未通过发布门禁。', '', 'SCI · MODULE 9')}<div class="card empty">M9 模拟考试暂不可用。</div>`;
    }
    const gateErrors = validateMockPool(content.questions, content.manifest.exam);
    if (!this.m9Exam) {
      return `${header('M9 Mock Paper', '按 SCI 原始 17 个章节题池配额抽题，开始后计时 120 分钟。', '<button class="button ghost" data-route="m9-review">M9 真题与知识点</button>', 'SCI · MODULE 9')}
        <section class="hero m9-hero"><p class="eyebrow" style="color:#d9af5c">OFFICIAL-FORMAT EXAM MODE</p><h2>100 道题，120 分钟。</h2><p>系统从 200 道 M9 Mock Paper 授权题池中，按 17 个章节的原始配额抽取 100 道。考试中不显示翻译、答案、题解或知识点。</p><div class="hero-tags"><span class="hero-tag">100 题</span><span class="hero-tag">120 分钟</span><span class="hero-tag">70 题及格</span><span class="hero-tag">不倒扣</span></div></section>
        ${gateErrors.length ? `<div class="notice error">内容门禁未通过：${gateErrors.map(escapeHtml).join('；')}</div>` : '<div class="notice success">题池门禁通过：200 题 · 17 题池 · 配额合计 100。</div>'}
        <div style="margin-top:18px"><button class="button" data-action="m9-exam-start" ${gateErrors.length ? 'disabled' : ''}>开始 M9 模拟考试</button></div>`;
    }
    if (this.m9Exam.result) {
      const result = this.m9Exam.result;
      const renderedRows = new Set(reviewRowsToRender(result.rows, this.m9ReviewOpen));
      return `${header('M9 考试结果', `${result.correct}/${result.total} · ${result.pass ? '通过' : '未通过'}`, '<button class="button" data-action="m9-exam-reset">再考一次</button>', 'SCI · MODULE 9')}
        <section class="card score-card"><div class="score-ring ${result.pass ? 'pass' : 'fail'}">${percent(result.rate)}</div><div><p class="eyebrow">${result.pass ? 'PASS' : 'KEEP GOING'}</p><h2>${result.correct} / ${result.total}</h2><p class="subtle">未作答 ${result.unanswered} 题；答错或留空均不倒扣。展开题目可查看完整中文解析、教材知识点和变形考法。</p></div></section>
        <section class="review-list">${result.rows.map((row, index) => `<article class="card review-item" data-review-card="${escapeHtml(row.question.id)}" tabindex="-1"><button class="review-summary" type="button" data-m9-review-index="${index}" aria-expanded="${this.m9ReviewOpen.has(index)}"><span class="result-badge ${row.isCorrect ? 'good' : 'bad'}">${row.isCorrect ? '正确' : '复盘'}</span><span><b>第 ${index + 1} 题</b><br><span class="subtle">${escapeHtml(row.question.stemEn)}</span></span><span class="review-chevron">${this.m9ReviewOpen.has(index) ? '−' : '+'}</span></button>${renderedRows.has(row) ? reviewBlocks(row.question, content.translations, content.explanations, row.chosen, row.isCorrect) : ''}</article>`).join('')}</section>`;
    }
    const { session, index, answers } = this.m9Exam;
    const question = session.questions[index];
    return `${header('M9 模拟考试进行中', '答案与题解将在交卷后显示。', `<span class="timer" id="m9-exam-timer">${this.formatTime(remainingSeconds(session))}</span>`, 'SCI · MODULE 9')}
      <div class="question-layout">
        <article class="card question-card">
          <div class="question-meta"><span>M9 Mock Paper · 单选题</span><span>${index + 1} / ${session.questions.length}</span></div>
          <div class="question-stem">${escapeHtml(question.stemEn)}</div>
          ${answerControl(question, answers[question.id], false)}
          <div class="question-actions"><div class="action-group"><button class="button ghost" data-action="m9-exam-prev" ${index === 0 ? 'disabled' : ''}>上一题</button><button class="button ghost" data-action="m9-exam-next" ${index === session.questions.length - 1 ? 'disabled' : ''}>下一题</button></div><button class="button danger" data-action="m9-exam-submit">交卷</button></div>
        </article>
        ${this.renderQuestionNav(session.questions, index, answers)}
      </div>`;
  }

  renderM9Wrongbook() {
    const content = this.m9Assessment();
    if (!content || !this.m9State) return `${header('M9 错题本', '题库尚未通过发布门禁。', '', 'SCI · MODULE 9')}<div class="card empty">暂不可用。</div>`;
    const questions = this.m9State.wrongbook.map(id => content.questions.find(question => question.id === id)).filter(Boolean);
    return `${header('M9 错题本', `${questions.length} 道待复盘题目`, questions.length ? '<button class="button danger" data-action="m9-wrong-clear">清空 M9 错题</button>' : '', 'SCI · MODULE 9')}
      ${questions.length ? `<section class="review-list">${questions.map((question, index) => `<article class="card review-item"><button class="review-summary" type="button" data-wrong-review="${escapeHtml(question.id)}" aria-expanded="${this.wrongOpen.has(question.id)}"><span class="result-badge bad">${index + 1}</span><span><b>${escapeHtml(question.chapterId.toUpperCase())}</b><br><span class="subtle">${escapeHtml(question.stemEn)}</span></span><span class="review-chevron">${this.wrongOpen.has(question.id) ? '−' : '+'}</span></button>${this.wrongOpen.has(question.id) ? `${reviewBlocks(question, content.translations, content.explanations, this.m9State.answerLog[question.id]?.lastWrongAnswer, false)}<div class="question-actions"><span></span><button class="button secondary" data-m9-remove-wrong="${escapeHtml(question.id)}">已掌握，移出错题本</button></div>` : ''}</article>`).join('')}</section>` : '<div class="card empty"><p>提交 M9 模拟考试后，答错题目会自动加入这里。</p><button class="button" data-route="m9-exam">开始 M9 模拟考试</button></div>'}`;
  }

  renderQuestionNav(questions, index, answers, submitted = new Set()) {
    const answered = Object.values(answers).filter(value => typeof value === 'string' ? value.trim() : Object.keys(value ?? {}).length).length;
    return `<aside class="card question-nav"><h3>答题进度</h3><div class="progress-line"><span style="width:${questions.length ? (answered / questions.length) * 100 : 0}%"></span></div><p class="subtle">已答 ${answered} · 未答 ${questions.length - answered}</p><div class="nav-dots">${questions.map((question, i) => `<button class="nav-dot ${answers[question.id] ? 'answered' : ''} ${i === index ? 'current' : ''}" data-question-index="${i}" type="button">${i + 1}${submitted.has(question.id) ? '✓' : ''}</button>`).join('')}</div></aside>`;
  }

  renderExam() {
    const gateErrors = validateMockPool(this.content.questions, this.subject.exam);
    if (!this.exam) {
      return `${header('HI Mock Paper', '按 SCI 原始题池结构抽题，开始后计时 75 分钟。')}
        <section class="hero"><p class="eyebrow" style="color:#d9af5c">EXAM MODE</p><h2>一次完整、安静的 75 分钟。</h2><p>系统会从 150 道 Mock Paper 题池中，按 15 个来源题池的原始配额抽取 50 题。考试中不显示翻译、答案或题解。</p><div class="hero-tags"><span class="hero-tag">50 题</span><span class="hero-tag">75 分钟</span><span class="hero-tag">35 题及格</span><span class="hero-tag">留空不倒扣</span></div></section>
        ${gateErrors.length ? `<div class="notice error">内容门禁未通过：${gateErrors.map(escapeHtml).join('；')}</div>` : '<div class="notice success">题池门禁通过：150 题 · 15 题池 · 配额合计 50。</div>'}
        <div style="margin-top:18px"><button class="button" data-action="exam-start" ${gateErrors.length ? 'disabled' : ''}>开始模拟考试</button></div>`;
    }
    if (this.exam.result) return this.renderExamResult();
    const { session, index, answers } = this.exam;
    const question = session.questions[index];
    return `${header('模拟考试进行中', '答案与题解将在交卷后显示。', `<span class="timer" id="exam-timer">${this.formatTime(remainingSeconds(session))}</span>`)}
      <div class="question-layout">
        <article class="card question-card">
          <div class="question-meta"><span>HI Mock Paper · 单选题</span><span>${index + 1} / ${session.questions.length}</span></div>
          <div class="question-stem">${escapeHtml(question.stemEn)}</div>
          ${answerControl(question, answers[question.id], false)}
          <div class="question-actions"><div class="action-group"><button class="button ghost" data-action="exam-prev" ${index === 0 ? 'disabled' : ''}>上一题</button><button class="button ghost" data-action="exam-next" ${index === session.questions.length - 1 ? 'disabled' : ''}>下一题</button></div><button class="button danger" data-action="exam-submit">交卷</button></div>
        </article>
        ${this.renderQuestionNav(session.questions, index, answers)}
      </div>`;
  }

  renderExamResult() {
    const result = this.exam.result;
    const renderedRows = new Set(reviewRowsToRender(result.rows, this.reviewOpen));
    return `${header('考试结果', `${result.correct}/${result.total} · ${result.pass ? '通过' : '未通过'}`, '<button class="button" data-action="exam-reset">再考一次</button>')}
      <section class="card score-card"><div class="score-ring ${result.pass ? 'pass' : 'fail'}">${percent(result.rate)}</div><div><p class="eyebrow">${result.pass ? 'PASS' : 'KEEP GOING'}</p><h2>${result.correct} / ${result.total}</h2><p class="subtle">未作答 ${result.unanswered} 题；答错或留空均不倒扣。以下展开每题可查看中文辅助翻译、题解和教材依据。</p></div></section>
      <section class="review-list">${result.rows.map((row, index) => `<article class="card review-item"><button class="review-summary" type="button" data-review-index="${index}" aria-expanded="${this.reviewOpen.has(index)}"><span class="result-badge ${row.isCorrect ? 'good' : 'bad'}">${row.isCorrect ? '正确' : '复盘'}</span><span><b>第 ${index + 1} 题</b><br><span class="subtle">${escapeHtml(row.question.stemEn)}</span></span><span class="review-chevron">${this.reviewOpen.has(index) ? '−' : '+'}</span></button>${renderedRows.has(row) ? reviewBlocks(row.question, this.content.translations, this.content.explanations, row.chosen, row.isCorrect) : ''}</article>`).join('')}</section>`;
  }

  renderWrongbook() {
    const questions = this.state.wrongbook.map(id => this.content.questions.find(question => question.id === id)).filter(Boolean);
    return `${header('错题本', `${questions.length} 道待复盘题目`, questions.length ? '<button class="button danger" data-action="wrong-clear">清空当前科目错题</button>' : '')}
      ${questions.length ? `<section class="review-list">${questions.map((question, index) => `<article class="card review-item"><button class="review-summary" type="button" data-wrong-review="${escapeHtml(question.id)}" aria-expanded="${this.wrongOpen.has(question.id)}"><span class="result-badge bad">${index + 1}</span><span><b>${escapeHtml(question.chapterId.toUpperCase())}</b><br><span class="subtle">${escapeHtml(question.stemEn)}</span></span><span class="review-chevron">${this.wrongOpen.has(question.id) ? '−' : '+'}</span></button>${this.wrongOpen.has(question.id) ? `${reviewBlocks(question, this.content.translations, this.content.explanations, this.state.answerLog[question.id]?.lastWrongAnswer, false)}<div class="question-actions"><span></span><button class="button secondary" data-remove-wrong="${escapeHtml(question.id)}">已掌握，移出错题本</button></div>` : ''}</article>`).join('')}</section>` : '<div class="card empty"><p>提交模拟考试后，答错题目会自动加入这里。</p><button class="button" data-route="exam">开始模拟考试</button></div>'}`;
  }

  renderWeak() {
    const areas = weakAreas(this.content.questions, this.state.answerLog);
    const chapterMap = new Map(this.content.chapters.map(chapter => [chapter.id, chapter]));
    return `${header('薄弱项', '根据已提交的模拟考试按正确率由低到高排列；尚无作答记录的章节排在最后。')}
      <div class="card" style="overflow:auto"><table class="weak-table"><thead><tr><th>章节</th><th>尝试</th><th>正确</th><th>正确率</th><th>进度</th></tr></thead><tbody>${areas.map(area => `<tr><td><b>${escapeHtml(area.chapterId.toUpperCase())}</b><br><span class="subtle">${escapeHtml(chapterMap.get(area.chapterId)?.title ?? '')}</span></td><td>${area.attempts}</td><td>${area.correct}</td><td>${percent(area.accuracy)}</td><td><div class="bar"><span style="width:${area.accuracy == null ? 0 : area.accuracy * 100}%"></span></div></td></tr>`).join('')}</tbody></table></div>`;
  }

  renderSettings() {
    return `${header('进度管理', '进度只保存在当前浏览器；可导出 JSON 备份或迁移。')}
      <section class="card settings-card">
        <div class="settings-row"><div><h3>导出本地进度</h3><p>包含 HI、M9、M8A 与 M9A 的错题、答题统计及模拟考试历史，不包含题库正文。</p></div><button class="button" data-action="progress-export">导出 JSON</button></div>
        <div class="settings-row"><div><h3>导入进度</h3><p>先完整校验再写入；遇到冲突会要求你确认是否覆盖。</p></div><label class="button secondary">选择 JSON<input class="hidden-input" type="file" accept="application/json,.json" data-progress-import></label></div>
        ${this.onForgetDevice ? '<div class="settings-row"><div><h3>忘记这台设备</h3><p>移除题库解锁密钥，不会删除答题进度。</p><p class="notice error" id="forget-device-error" role="alert" hidden data-forget-error></p></div><button class="button secondary" data-action="forget-device" aria-describedby="forget-device-error">退出题库</button></div>' : ''}
        <div class="settings-row"><div><h3>隐私边界</h3><p>本工具为个人备考用途，不是 SCI 官方产品；明文仓库保持私有，公开托管仅包含加密发布产物。每份科目资料均须通过独立内容门禁后才会显示。</p></div></div>
      </section>`;
  }

  bind() {
    this.root.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => this.setRoute(button.dataset.route)));
    this.root.querySelectorAll('[data-review-preset]').forEach(button => button.addEventListener('click', () => {
      this.review = { chapterId: 'all', source: button.dataset.reviewPreset, query: '' };
      this.route = 'practice';
      this.render();
    }));
    this.root.querySelectorAll('[data-m9-review-preset]').forEach(button => button.addEventListener('click', () => {
      this.m9Review = { chapterId: 'all', source: button.dataset.m9ReviewPreset, query: '' };
      this.route = 'm9-review';
      this.render();
    }));
    this.root.querySelectorAll('[data-guide-chapter]').forEach(button => button.addEventListener('click', () => {
      this.guide = { chapterId: button.dataset.guideChapter, query: '', all: false };
      this.render();
    }));
    this.root.querySelectorAll('[data-knowledge-chapter]').forEach(button => button.addEventListener('click', () => {
      const guideId = button.dataset.knowledgeGuide;
      const guide = this.content.studyGuides?.find(item => item.manifest.id === guideId);
      if (!guide?.chapters.some(chapter => chapter.id === button.dataset.knowledgeChapter)) return;
      this.knowledgeReturn = {
        route: this.route,
        questionId: button.dataset.knowledgeQuestion
          || button.closest?.('[data-review-card]')?.dataset.reviewCard
          || '',
        m9Review: { ...this.m9Review },
        moduleReviews: structuredClone(this.moduleReviews),
      };
      this.route = guideId === 'm9' ? 'm9' : `${guideId}-guide`;
      if (guideId === 'm9') this.guide = { chapterId: button.dataset.knowledgeChapter, query: '', all: false };
      else this.moduleGuides[guideId] = { chapterId: button.dataset.knowledgeChapter, query: '', all: false };
      this.render();
      const target = [...this.root.querySelectorAll('[data-pair-id]')]
        .find(node => node.dataset.pairId === button.dataset.knowledgePair);
      target?.classList.add('knowledge-target');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    }));
    this.root.querySelector('[data-action="return-knowledge-question"]')?.addEventListener('click', () => {
      const context = this.knowledgeReturn;
      if (!context) return;
      this.knowledgeReturn = null;
      this.route = context.route;
      this.m9Review = { ...context.m9Review };
      this.moduleReviews = structuredClone(context.moduleReviews ?? this.moduleReviews);
      this.render();
      const target = [...this.root.querySelectorAll('[data-review-card]')]
        .find(node => node.dataset.reviewCard === context.questionId);
      target?.classList.add('knowledge-target');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
    this.root.querySelector('[data-guide-all]')?.addEventListener('click', () => {
      this.guide = { chapterId: null, query: '', all: true };
      this.render();
    });
    this.root.querySelector('[data-action="choose-guide-chapter"]')?.addEventListener('click', () => {
      this.guide = { chapterId: null, query: '', all: false };
      this.render();
    });
    this.root.querySelector('[data-guide-prev]')?.addEventListener('click', () => {
      const guide = this.m9Guide();
      const index = guide.chapters.findIndex(chapter => chapter.id === this.guide.chapterId);
      if (index > 0) this.guide.chapterId = guide.chapters[index - 1].id;
      this.render();
    });
    this.root.querySelector('[data-guide-next]')?.addEventListener('click', () => {
      const guide = this.m9Guide();
      const index = guide.chapters.findIndex(chapter => chapter.id === this.guide.chapterId);
      if (index >= 0 && index < guide.chapters.length - 1) this.guide.chapterId = guide.chapters[index + 1].id;
      this.render();
    });
    const guideQuery = this.root.querySelector('[data-guide-query]');
    guideQuery?.addEventListener('input', event => {
      if (event.isComposing) return;
      const selectionStart = event.target.selectionStart;
      const selectionEnd = event.target.selectionEnd;
      this.guide.query = event.target.value;
      this.render();
      const replacement = this.root.querySelector('[data-guide-query]');
      replacement?.focus();
      replacement?.setSelectionRange(selectionStart, selectionEnd);
    });
    this.root.querySelectorAll('[data-chapter]').forEach(button => button.addEventListener('click', () => {
      this.review = { chapterId: button.dataset.chapter, source: 'all', query: '' };
      this.render();
    }));
    this.root.querySelectorAll('[data-m9-chapter]').forEach(button => button.addEventListener('click', () => {
      this.m9Review = { chapterId: button.dataset.m9Chapter, source: 'all', query: '' };
      this.render();
    }));
    this.root.querySelectorAll('[data-question-index]').forEach(button => button.addEventListener('click', () => {
      const exam = this.activeExam();
      exam.index = Number(button.dataset.questionIndex);
      this.render();
    }));
    this.root.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => {
      const exam = this.activeExam();
      const question = exam.session.questions[exam.index];
      exam.answers[question.id] = button.dataset.answer;
      this.render();
    }));
    this.root.querySelector('[data-action="choose-chapter"]')?.addEventListener('click', () => {
      this.review = { chapterId: null, source: 'all', query: '' };
      this.render();
    });
    this.root.querySelector('[data-review-source]')?.addEventListener('change', event => {
      this.review.source = event.target.value;
      this.render();
    });
    const updateReviewQuery = event => {
      const selectionStart = event.target.selectionStart;
      const selectionEnd = event.target.selectionEnd;
      this.review.query = event.target.value;
      this.render();
      const replacement = this.root.querySelector('[data-review-query]');
      replacement?.focus();
      replacement?.setSelectionRange(selectionStart, selectionEnd);
    };
    const reviewQuery = this.root.querySelector('[data-review-query]');
    reviewQuery?.addEventListener('input', event => {
      if (event.isComposing) return;
      updateReviewQuery(event);
    });
    reviewQuery?.addEventListener('compositionend', updateReviewQuery);
    this.root.querySelector('[data-action="choose-m9-chapter"]')?.addEventListener('click', () => {
      this.m9Review = { chapterId: null, source: 'all', query: '' };
      this.render();
    });
    this.root.querySelector('[data-m9-review-source]')?.addEventListener('change', event => {
      this.m9Review.source = event.target.value;
      this.render();
    });
    const updateM9ReviewQuery = event => {
      const selectionStart = event.target.selectionStart;
      const selectionEnd = event.target.selectionEnd;
      this.m9Review.query = event.target.value;
      this.render();
      const replacement = this.root.querySelector('[data-m9-review-query]');
      replacement?.focus();
      replacement?.setSelectionRange(selectionStart, selectionEnd);
    };
    const m9ReviewQuery = this.root.querySelector('[data-m9-review-query]');
    m9ReviewQuery?.addEventListener('input', event => {
      if (event.isComposing) return;
      updateM9ReviewQuery(event);
    });
    m9ReviewQuery?.addEventListener('compositionend', updateM9ReviewQuery);
    this.root.querySelectorAll('[data-module-review-preset]').forEach(button => button.addEventListener('click', () => {
      const [id, source] = button.dataset.moduleReviewPreset.split(':');
      this.moduleReviews[id] = { chapterId: 'all', source, query: '' };
      this.route = `${id}-review`;
      this.render();
    }));
    this.root.querySelectorAll('[data-module-review-chapter]').forEach(button => button.addEventListener('click', () => {
      const [id, chapterId] = button.dataset.moduleReviewChapter.split(':');
      this.moduleReviews[id] = { chapterId, source: 'all', query: '' };
      this.render();
    }));
    this.root.querySelectorAll('[data-module-review-home]').forEach(button => button.addEventListener('click', () => {
      this.moduleReviews[button.dataset.moduleReviewHome] = { chapterId: null, source: 'all', query: '' };
      this.render();
    }));
    this.root.querySelectorAll('[data-module-review-source]').forEach(select => select.addEventListener('change', event => {
      this.moduleReviews[select.dataset.moduleReviewSource].source = event.target.value;
      this.render();
    }));
    this.root.querySelectorAll('[data-module-review-query]').forEach(input => input.addEventListener('input', event => {
      if (event.isComposing) return;
      const id = input.dataset.moduleReviewQuery;
      this.moduleReviews[id].query = event.target.value;
      this.render();
      const replacement = this.root.querySelector(`[data-module-review-query="${id}"]`);
      replacement?.focus();
      replacement?.setSelectionRange(event.target.selectionStart, event.target.selectionEnd);
    }));
    this.root.querySelectorAll('[data-module-guide-chapter]').forEach(button => button.addEventListener('click', () => {
      const [id, chapterId] = button.dataset.moduleGuideChapter.split(':');
      this.moduleGuides[id] = { chapterId, query: '', all: false };
      this.render();
    }));
    this.root.querySelectorAll('[data-module-guide-home]').forEach(button => button.addEventListener('click', () => {
      this.moduleGuides[button.dataset.moduleGuideHome] = { chapterId: null, query: '', all: false };
      this.render();
    }));
    this.root.querySelectorAll('[data-module-guide-all]').forEach(button => button.addEventListener('click', () => {
      this.moduleGuides[button.dataset.moduleGuideAll] = { chapterId: null, query: '', all: true };
      this.render();
    }));
    this.root.querySelectorAll('[data-module-guide-step]').forEach(button => button.addEventListener('click', () => {
      const [id, delta] = button.dataset.moduleGuideStep.split(':');
      const guide = this.moduleAssessment(id);
      const index = guide.chapters.findIndex(chapter => chapter.id === this.moduleGuides[id].chapterId);
      this.moduleGuides[id].chapterId = guide.chapters[index + Number(delta)].id;
      this.render();
    }));
    this.root.querySelectorAll('[data-module-guide-query]').forEach(input => input.addEventListener('input', event => {
      if (event.isComposing) return;
      this.moduleGuides[input.dataset.moduleGuideQuery].query = event.target.value;
      this.render();
      const replacement = this.root.querySelector(`[data-module-guide-query="${input.dataset.moduleGuideQuery}"]`);
      replacement?.focus();
    }));
    this.root.querySelectorAll('[data-module-exam-start]').forEach(button => button.addEventListener('click', () => this.startModuleExam(button.dataset.moduleExamStart)));
    this.root.querySelectorAll('[data-module-exam-step]').forEach(button => button.addEventListener('click', () => {
      const [id, delta] = button.dataset.moduleExamStep.split(':');
      this.moduleExams[id].index += Number(delta);
      this.render();
    }));
    this.root.querySelectorAll('[data-module-exam-submit]').forEach(button => button.addEventListener('click', () => this.submitModuleExam(button.dataset.moduleExamSubmit, false)));
    this.root.querySelectorAll('[data-module-exam-reset]').forEach(button => button.addEventListener('click', () => { this.moduleExams[button.dataset.moduleExamReset] = null; this.render(); }));
    this.root.querySelectorAll('[data-module-result-row]').forEach(button => button.addEventListener('click', () => {
      const [id, rawIndex] = button.dataset.moduleResultRow.split(':');
      const index = Number(rawIndex);
      const opened = this.moduleReviewOpen[id];
      if (opened.has(index)) opened.delete(index); else opened.add(index);
      this.render();
    }));
    this.root.querySelector('[data-action="exam-start"]')?.addEventListener('click', () => this.startExam());
    this.root.querySelector('[data-action="exam-prev"]')?.addEventListener('click', () => { this.exam.index -= 1; this.render(); });
    this.root.querySelector('[data-action="exam-next"]')?.addEventListener('click', () => { this.exam.index += 1; this.render(); });
    this.root.querySelector('[data-action="exam-submit"]')?.addEventListener('click', () => this.submitExam(false));
    this.root.querySelector('[data-action="exam-reset"]')?.addEventListener('click', () => { this.exam = null; this.render(); });
    this.root.querySelector('[data-action="m9-exam-start"]')?.addEventListener('click', () => this.startM9Exam());
    this.root.querySelector('[data-action="m9-exam-prev"]')?.addEventListener('click', () => { this.m9Exam.index -= 1; this.render(); });
    this.root.querySelector('[data-action="m9-exam-next"]')?.addEventListener('click', () => { this.m9Exam.index += 1; this.render(); });
    this.root.querySelector('[data-action="m9-exam-submit"]')?.addEventListener('click', () => this.submitM9Exam(false));
    this.root.querySelector('[data-action="m9-exam-reset"]')?.addEventListener('click', () => { this.m9Exam = null; this.render(); });
    this.root.querySelectorAll('[data-review-index]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.reviewIndex);
      if (this.reviewOpen.has(index)) this.reviewOpen.delete(index); else this.reviewOpen.add(index);
      this.render();
    }));
    this.root.querySelectorAll('[data-m9-review-index]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.m9ReviewIndex);
      if (this.m9ReviewOpen.has(index)) this.m9ReviewOpen.delete(index); else this.m9ReviewOpen.add(index);
      this.render();
    }));
    this.root.querySelectorAll('[data-wrong-review]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.wrongReview;
      if (this.wrongOpen.has(id)) this.wrongOpen.delete(id); else this.wrongOpen.add(id);
      this.render();
    }));
    this.root.querySelector('[data-action="wrong-clear"]')?.addEventListener('click', () => {
      if (confirm('只清空 HI 当前科目的错题本，确定继续？')) { this.state = clearWrongbook(this.state); this.persist(); this.render(); }
    });
    this.root.querySelectorAll('[data-remove-wrong]').forEach(button => button.addEventListener('click', () => {
      this.state = removeWrongQuestion(this.state, button.dataset.removeWrong); this.persist(); this.render();
    }));
    this.root.querySelector('[data-action="m9-wrong-clear"]')?.addEventListener('click', () => {
      if (!confirm('只清空 M9 当前科目的错题本，确定继续？')) return;
      this.m9State = clearWrongbook(this.m9State);
      saveSubjectState(localStorage, this.m9State);
      this.render();
    });
    this.root.querySelectorAll('[data-m9-remove-wrong]').forEach(button => button.addEventListener('click', () => {
      this.m9State = removeWrongQuestion(this.m9State, button.dataset.m9RemoveWrong);
      saveSubjectState(localStorage, this.m9State);
      this.render();
    }));
    this.root.querySelectorAll('[data-module-wrong-clear]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.moduleWrongClear;
      if (!confirm(`只清空 ${id.toUpperCase()} 当前科目的错题本，确定继续？`)) return;
      this.moduleStates[id] = clearWrongbook(this.moduleStates[id]);
      saveSubjectState(localStorage, this.moduleStates[id]);
      this.render();
    }));
    this.root.querySelectorAll('[data-module-remove-wrong]').forEach(button => button.addEventListener('click', () => {
      const separator = button.dataset.moduleRemoveWrong.indexOf(':');
      const id = button.dataset.moduleRemoveWrong.slice(0, separator);
      const questionId = button.dataset.moduleRemoveWrong.slice(separator + 1);
      this.moduleStates[id] = removeWrongQuestion(this.moduleStates[id], questionId);
      saveSubjectState(localStorage, this.moduleStates[id]);
      this.render();
    }));
    this.root.querySelector('[data-action="progress-export"]')?.addEventListener('click', () => this.exportProgressFile());
    this.root.querySelector('[data-progress-import]')?.addEventListener('change', event => this.importProgressFile(event.target.files?.[0]));
    const forgetButton = this.root.querySelector('[data-action="forget-device"]');
    if (forgetButton && this.onForgetDevice) {
      forgetButton.addEventListener('click', async () => {
        const errorNode = this.root.querySelector('[data-forget-error]');
        forgetButton.disabled = true;
        errorNode.hidden = true;
        try {
          await this.onForgetDevice();
        } catch {
          errorNode.textContent = '无法忘记这台设备，请重试。';
          errorNode.hidden = false;
          forgetButton.disabled = false;
        }
      });
    }
  }

  currentQuestion() {
    return this.exam.session.questions[this.exam.index];
  }

  activeExam() {
    if (this.route === 'm9-exam') return this.m9Exam;
    const moduleId = /^(m8a|m9a)-exam$/u.exec(this.route)?.[1];
    return moduleId ? this.moduleExams[moduleId] : this.exam;
  }

  captureInputs() {
    const question = this.currentQuestion();
    const target = this.exam.answers;
    const fill = this.root.querySelector('[data-fill-answer]');
    if (fill) target[question.id] = fill.value;
    const matches = [...this.root.querySelectorAll('[data-match]')];
    if (matches.length) target[question.id] = Object.fromEntries(matches.filter(select => select.value).map(select => [select.dataset.match, select.value]));
  }

  startExam() {
    const questions = selectOriginalMock(this.content.questions);
    this.exam = { session: createExamSession({ subject: this.subject, questions }), index: 0, answers: {}, result: null, persisted: false };
    this.reviewOpen = new Set();
    this.render();
    this.startTimer();
  }

  startM9Exam() {
    const content = this.m9Assessment();
    const questions = selectOriginalMock(content.questions);
    const subject = { id: 'm9', exam: content.manifest.exam };
    this.m9Exam = { session: createExamSession({ subject, questions }), index: 0, answers: {}, result: null, persisted: false };
    this.m9ReviewOpen = new Set();
    this.render();
    this.startM9Timer();
  }

  startModuleExam(id) {
    const content = this.moduleAssessment(id);
    const questions = selectOriginalMock(content.questions);
    const subject = { id, exam: content.manifest.exam };
    this.moduleExams[id] = { session: createExamSession({ subject, questions }), index: 0, answers: {}, result: null, persisted: false };
    this.moduleReviewOpen[id] = new Set();
    this.render();
    this.startModuleTimer(id);
  }

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      const left = remainingSeconds(this.exam.session);
      const node = document.querySelector('#exam-timer');
      if (node) node.textContent = this.formatTime(left);
      if (left === 0) this.submitExam(true);
    }, 1000);
  }

  startM9Timer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      const left = remainingSeconds(this.m9Exam.session);
      const node = document.querySelector('#m9-exam-timer');
      if (node) node.textContent = this.formatTime(left);
      if (left === 0) this.submitM9Exam(true);
    }, 1000);
  }

  startModuleTimer(id) {
    this.stopTimer();
    this.timer = setInterval(() => {
      const exam = this.moduleExams[id];
      if (!exam) return;
      const left = remainingSeconds(exam.session);
      const node = document.querySelector('#module-exam-timer');
      if (node) node.textContent = this.formatTime(left);
      if (left === 0) this.submitModuleExam(id, true);
    }, 1000);
  }

  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  submitExam(forced) {
    if (!forced) {
      const unanswered = this.exam.session.questions.filter(question => !this.exam.answers[question.id]).length;
      if (!confirm(`还有 ${unanswered} 题未作答。确定交卷？`)) return;
    }
    this.stopTimer();
    this.exam.result = gradeSession(this.exam.session, this.exam.answers);
    if (!this.exam.persisted) {
      this.state = applyExamResult(this.state, this.exam.result);
      this.persist();
      this.exam.persisted = true;
    }
    this.render();
  }

  submitM9Exam(forced) {
    if (!forced) {
      const unanswered = this.m9Exam.session.questions.filter(question => !this.m9Exam.answers[question.id]).length;
      if (!confirm(`还有 ${unanswered} 题未作答。确定交卷？`)) return;
    }
    this.stopTimer();
    this.m9Exam.result = gradeSession(this.m9Exam.session, this.m9Exam.answers);
    if (!this.m9Exam.persisted) {
      this.m9State = applyExamResult(this.m9State, this.m9Exam.result);
      saveSubjectState(localStorage, this.m9State);
      this.m9Exam.persisted = true;
    }
    this.render();
  }

  submitModuleExam(id, forced) {
    const exam = this.moduleExams[id];
    if (!forced) {
      const unanswered = exam.session.questions.filter(question => !exam.answers[question.id]).length;
      if (!confirm(`还有 ${unanswered} 题未作答。确定交卷？`)) return;
    }
    this.stopTimer();
    exam.result = gradeSession(exam.session, exam.answers);
    if (!exam.persisted) {
      this.moduleStates[id] = applyExamResult(this.moduleStates[id], exam.result);
      saveSubjectState(localStorage, this.moduleStates[id]);
      exam.persisted = true;
    }
    this.render();
  }

  exportProgressFile() {
    const states = {
      [this.subject.id]: this.state,
      ...(this.m9State ? { m9: this.m9State } : {}),
      ...this.moduleStates,
    };
    const blob = new Blob([exportProgress(states)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sci-prep-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.flash = '进度 JSON 已导出。';
    this.render();
  }

  async importProgressFile(file) {
    if (!file) return;
    try {
      const json = await file.text();
      const current = {
        [this.subject.id]: this.state,
        ...(this.m9State ? { m9: this.m9State } : {}),
        ...this.moduleStates,
      };
      let result = importProgress(json, current);
      if (result.conflicts && confirm(`检测到 ${result.conflicts} 个冲突。是否用导入文件覆盖本地进度？`)) result = importProgress(json, current, { overwrite: true });
      if (result.states[this.subject.id]) {
        this.state = result.states[this.subject.id];
        this.persist();
      }
      if (result.states.m9 && this.m9State) {
        this.m9State = result.states.m9;
        saveSubjectState(localStorage, this.m9State);
      }
      for (const id of Object.keys(this.moduleStates)) {
        if (!result.states[id]) continue;
        this.moduleStates[id] = result.states[id];
        saveSubjectState(localStorage, this.moduleStates[id]);
      }
      this.flash = `导入完成：新增 ${result.added}、更新 ${result.updated}、跳过 ${result.skipped}、冲突 ${result.conflicts}。`;
    } catch (error) {
      alert(`导入失败：${error.message}`);
    }
    this.render();
  }
}
