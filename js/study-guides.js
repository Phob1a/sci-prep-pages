import { validateM9Assessment } from './m9-assessment.js';

const present = value => typeof value === 'string' && value.trim().length > 0;
const DOCUMENT_PATH = /^chapters\/[A-Za-z0-9._-]+\.md$/u;
const M9_BILINGUAL_PAIR_COUNT = 104;

export function validateStudyGuide(guide, expectedId = '') {
  const errors = [];
  if (!present(guide?.manifest?.id)) errors.push('study guide: missing id');
  if (present(expectedId) && guide?.manifest?.id !== expectedId) {
    errors.push(`study guide: expected id ${expectedId}`);
  }
  if (!present(guide?.manifest?.title)) errors.push('study guide: missing title');
  if (!Array.isArray(guide?.chapters) || guide.chapters.length === 0) {
    errors.push('study guide: missing chapters');
    return errors;
  }
  const chapterIds = new Set();
  const chapterFiles = new Set();
  for (const chapter of guide.chapters) {
    if (!present(chapter?.id)) {
      errors.push('study guide: chapter missing id');
      continue;
    }
    if (chapterIds.has(chapter.id)) errors.push(`${chapter.id}: duplicate chapter`);
    chapterIds.add(chapter.id);
    if (!Number.isInteger(chapter.number) || chapter.number < 1) errors.push(`${chapter.id}: invalid chapter number`);
    if (!present(chapter.title)) errors.push(`${chapter.id}: missing title`);
    if (!present(chapter.file)) {
      errors.push(`${chapter.id}: missing file`);
      continue;
    }
    if (!DOCUMENT_PATH.test(chapter.file)) errors.push(`${chapter.id}: unsafe document path`);
    if (chapterFiles.has(chapter.file)) errors.push(`${chapter.id}: duplicate document file`);
    chapterFiles.add(chapter.file);
    if (!present(guide.documents?.[chapter.file])) errors.push(`${chapter.id}: missing document`);
  }
  for (const file of Object.keys(guide?.documents ?? {})) {
    if (!chapterFiles.has(file)) errors.push(`${file}: unlisted document`);
  }
  return errors;
}

export function validateM9Guide(guide) {
  const errors = validateCompleteBilingualGuide(guide, {
    id: 'm9', chapterCount: 17, bilingualPairCount: M9_BILINGUAL_PAIR_COUNT,
  });
  if (guide?.manifest?.questionFiles) {
    const pairIds = new Set((guide?.chapters ?? []).flatMap(chapter => (
      validateBilingualPairs(guide?.documents?.[chapter.file] ?? '', chapter.id).pairs.map(pair => pair.id)
    )));
    errors.push(...validateM9Assessment({
      manifest: guide.manifest,
      questions: guide.questions,
      translations: guide.translations,
      explanations: guide.explanations,
    }, pairIds));
  }
  return errors;
}

export function validateHiGuide(guide) {
  const declared = guide?.manifest?.bilingualPairCount;
  const errors = validateCompleteBilingualGuide(guide, {
    id: 'hi', chapterCount: 15, bilingualPairCount: declared,
  });
  if (!Number.isInteger(declared) || declared < 75) {
    errors.push('HI guide must declare at least 75 bilingual pairs');
  }
  return errors;
}

function validateCompleteBilingualGuide(guide, spec) {
  const errors = validateStudyGuide(guide, spec.id);
  const chapters = Array.isArray(guide?.chapters) ? guide.chapters : [];
  const documents = guide?.documents ?? {};
  if (chapters.length !== spec.chapterCount) {
    errors.push(`expected ${spec.chapterCount} chapters, found ${chapters.length}`);
  }
  if (!Number.isInteger(spec.bilingualPairCount)
    || guide?.manifest?.bilingualPairCount !== spec.bilingualPairCount) {
    errors.push(`expected ${spec.bilingualPairCount} declared bilingual pairs`);
  }
  let actualPairCount = 0;
  let declaredPairCount = 0;
  chapters.forEach((chapter, index) => {
    const expectedId = `ch${String(index + 1).padStart(2, '0')}`;
    if (chapter.id !== expectedId || chapter.number !== index + 1) {
      errors.push(`${chapter.id}: expected ${expectedId} / chapter ${index + 1}`);
    }
    if (!Number.isInteger(chapter.sourcePageStart) || chapter.sourcePageStart < 1) {
      errors.push(`${chapter.id}: invalid source page`);
    }
    if (index > 0 && chapter.sourcePageStart <= chapters[index - 1].sourcePageStart) {
      errors.push(`${chapter.id}: source pages are not increasing`);
    }
    const document = documents[chapter.file] ?? '';
    if (document.length < 1_500) errors.push(`${chapter.id}: study notes are too short`);
    if (!/[\u3400-\u9fff]/u.test(document)) errors.push(`${chapter.id}: Chinese explanation is missing`);
    if (!/[A-Za-z]{3,}/u.test(document)) errors.push(`${chapter.id}: English terminology is missing`);
    if (!document.includes('章节定位')) errors.push(`${chapter.id}: chapter scope is missing`);
    if (!document.includes('高频易混点')) errors.push(`${chapter.id}: common traps are missing`);
    if (!document.includes('关键术语')) errors.push(`${chapter.id}: terminology section is missing`);
    const english = document.split('## English Explanation')[1] ?? '';
    if (english.length < 1_800) errors.push(`${chapter.id}: English explanation is too short`);
    if ((english.match(/[A-Za-z]+/gu) ?? []).length < 250) {
      errors.push(`${chapter.id}: English explanation is incomplete`);
    }
    const bilingual = validateBilingualPairs(document, chapter.id);
    errors.push(...bilingual.errors);
    actualPairCount += bilingual.pairs.length;
    if (!Number.isInteger(chapter.bilingualPairCount) || chapter.bilingualPairCount < 1) {
      errors.push(`${chapter.id}: invalid declared bilingual pair count`);
    } else {
      declaredPairCount += chapter.bilingualPairCount;
      if (bilingual.pairs.length !== chapter.bilingualPairCount) {
        errors.push(`${chapter.id}: expected ${chapter.bilingualPairCount} bilingual pairs, found ${bilingual.pairs.length}`);
      }
    }
    bilingual.pairs.forEach(pair => {
      if (pair.en.length < 80 || !/[A-Za-z]{3,}/u.test(pair.en)) {
        errors.push(`${pair.id}: English pair is incomplete`);
      }
      if (pair.zh.length < 30 || !/[\u3400-\u9fff]/u.test(pair.zh)) {
        errors.push(`${pair.id}: Chinese pair is incomplete`);
      }
    });
    if (!present(bilingual.chinese) || !/[\u3400-\u9fff]/u.test(bilingual.chinese)) {
      errors.push(`${chapter.id}: complete Chinese study notes are missing`);
    }
  });
  if (declaredPairCount !== spec.bilingualPairCount) {
    errors.push(`declared bilingual pair total must be ${spec.bilingualPairCount}, found ${declaredPairCount}`);
  }
  if (actualPairCount !== spec.bilingualPairCount) {
    errors.push(`actual bilingual pair total must be ${spec.bilingualPairCount}, found ${actualPairCount}`);
  }
  return errors;
}

export function selectStudyGuideChapters(guide, query = '') {
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return guide.chapters;
  return guide.chapters.filter(chapter => {
    const document = guide.documents?.[chapter.file] ?? '';
    const parsed = parseExplicitBilingualDocument(document);
    const visibleDocument = parsed.groups.length && !parsed.errors.length
      ? parsed.groups.flatMap(group => [
        group.heading,
        ...group.entries.map(entry => entry.content),
      ]).join(' ')
      : document;
    return `${chapter.number} ${chapter.title} ${visibleDocument}`.toLocaleLowerCase().includes(needle);
  });
}

function inlineMarkdown(value, escapeHtml) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function listMarker(line) {
  const match = /^([ \t]*)([-*]|\d+\.)\s+(.+)$/u.exec(line);
  if (!match) return null;
  return {
    indent: match[1].replaceAll('\t', '  ').length,
    type: /^\d/u.test(match[2]) ? 'ol' : 'ul',
    value: match[3],
  };
}

function renderList(lines, start, indent, type, escapeHtml) {
  const items = [];
  let index = start;
  while (index < lines.length) {
    const marker = listMarker(lines[index]);
    if (!marker || marker.indent < indent || (marker.indent === indent && marker.type !== type)) break;
    if (marker.indent > indent) {
      if (items.length === 0) break;
      const child = renderList(lines, index, marker.indent, marker.type, escapeHtml);
      items[items.length - 1] += child.html;
      index = child.index;
      continue;
    }
    items.push(inlineMarkdown(marker.value, escapeHtml));
    index += 1;
  }
  return {
    html: `<${type}>${items.map(item => `<li>${item}</li>`).join('')}</${type}>`,
    index,
  };
}

function renderSingleStudyMarkdown(markdown, escapeHtml) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5);
      const englishHeading = heading[2] === 'English Explanation'
        ? ' class="guide-english-heading" lang="en"'
        : '';
      html.push(`<h${level}${englishHeading}>${inlineMarkdown(heading[2], escapeHtml)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(`<div class="guide-table-wrap"><table class="guide-table"><thead><tr>${headers.map(cell => `<th>${inlineMarkdown(cell, escapeHtml)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] ?? '', escapeHtml)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const marker = listMarker(lines[index]);
    if (marker) {
      const list = renderList(lines, index, marker.indent, marker.type, escapeHtml);
      html.push(list.html);
      index = list.index;
      continue;
    }

    if (line.startsWith('> ')) {
      html.push(`<blockquote>${inlineMarkdown(line.slice(2), escapeHtml)}</blockquote>`);
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,4})\s+/.test(next) || listMarker(lines[index]) || next.startsWith('> ')) break;
      if (next.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(next);
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(' '), escapeHtml)}</p>`);
  }
  return html.join('');
}

function parseExplicitBilingualDocument(markdown) {
  const source = String(markdown ?? '').replace(/\r\n?/gu, '\n');
  const marker = '\n## English Explanation\n';
  const parts = source.split(marker);
  const errors = [];
  if (parts.length !== 2) {
    errors.push(`expected exactly one English Explanation marker, found ${parts.length - 1}`);
  }
  const chinese = parts[0]?.trim() ?? '';
  const english = parts.length === 2 ? parts[1] : '';
  const groups = [];
  let group = null;
  let entry = null;

  const flushEntry = () => {
    if (!entry) return;
    entry.content = entry.lines.join('\n').trim();
    delete entry.lines;
    group.entries.push(entry);
    entry = null;
  };
  const flushGroup = () => {
    if (!group) return;
    flushEntry();
    groups.push(group);
    group = null;
  };

  english.split('\n').forEach((line, lineIndex) => {
    const topicMatch = /^###\s+(.+?)\s*$/u.exec(line);
    if (topicMatch) {
      flushGroup();
      group = { heading: topicMatch[1], entries: [] };
      return;
    }
    if (/^####\s+/u.test(line)) {
      if (!group) {
        errors.push(`line ${lineIndex + 1}: bilingual pair appears before a topic`);
        return;
      }
      flushEntry();
      const pairMatch = /^####\s+(ch\d{2}-p\d{2})\s+·\s+(EN|ZH)\s*$/u.exec(line);
      if (!pairMatch) {
        errors.push(`line ${lineIndex + 1}: malformed bilingual pair heading`);
        return;
      }
      entry = { id: pairMatch[1], language: pairMatch[2], lines: [] };
      return;
    }
    if (!line.trim()) {
      if (entry) entry.lines.push(line);
      return;
    }
    if (!group) {
      errors.push(`line ${lineIndex + 1}: content appears outside a bilingual topic`);
      return;
    }
    if (!entry) {
      errors.push(`line ${lineIndex + 1}: content appears outside a bilingual pair`);
      return;
    }
    entry.lines.push(line);
  });
  flushGroup();
  return { chinese, groups, errors };
}

export function validateBilingualPairs(markdown, chapterId) {
  const parsed = parseExplicitBilingualDocument(markdown);
  const errors = [...parsed.errors];
  const entries = parsed.groups.flatMap(group => group.entries);
  const idCounts = new Map();
  for (const entry of entries) {
    const counts = idCounts.get(entry.id) ?? { EN: 0, ZH: 0 };
    counts[entry.language] += 1;
    idCounts.set(entry.id, counts);
    if (!entry.id.startsWith(`${chapterId}-`)) {
      errors.push(`${entry.id}: expected chapter prefix ${chapterId}`);
    }
    if (!present(entry.content)) errors.push(`${entry.id} · ${entry.language}: pair content is missing`);
  }
  for (const [id, counts] of idCounts) {
    if (counts.EN !== 1 || counts.ZH !== 1) {
      errors.push(`${id}: expected exactly one EN and one ZH entry`);
    }
  }

  const pairs = [];
  let pairIndex = 0;
  for (const group of parsed.groups) {
    if (!present(group.heading) || group.entries.length === 0) {
      errors.push(`${chapterId}: bilingual topic is incomplete`);
      continue;
    }
    for (let index = 0; index < group.entries.length; index += 2) {
      const en = group.entries[index];
      const zh = group.entries[index + 1];
      const expectedId = `${chapterId}-p${String(pairIndex + 1).padStart(2, '0')}`;
      if (en?.language !== 'EN') errors.push(`${expectedId}: expected EN entry first`);
      if (!zh) {
        errors.push(`${en?.id || expectedId}: missing ZH entry`);
      } else if (zh.language !== 'ZH') {
        errors.push(`${en?.id || expectedId}: expected corresponding ZH entry second`);
      }
      if (en?.id !== expectedId) errors.push(`${chapterId}: expected bilingual pair ${expectedId}`);
      if (en && zh && en.id !== zh.id) {
        errors.push(`${en.id}: corresponding ZH entry has id ${zh.id}`);
      }
      if (en?.language === 'EN' && zh?.language === 'ZH' && en.id === zh.id) {
        pairs.push({ id: en.id, en: en.content, zh: zh.content });
      }
      pairIndex += 1;
    }
  }
  return { chinese: parsed.chinese, groups: parsed.groups, pairs, errors };
}

export function renderStudyMarkdown(markdown, escapeHtml) {
  return renderSingleStudyMarkdown(markdown, escapeHtml);
}

export function renderBilingualStudyMarkdown(markdown, chapterId, escapeHtml) {
  const bilingual = validateBilingualPairs(markdown, chapterId);
  if (!bilingual.groups.length || bilingual.errors.length) {
    return renderSingleStudyMarkdown(markdown, escapeHtml);
  }

  const topics = bilingual.groups.map(group => {
    const renderedPairs = [];
    for (let index = 0; index < group.entries.length; index += 2) {
      const en = group.entries[index];
      const zh = group.entries[index + 1];
      const pair = { id: en.id, en: en.content, zh: zh.content };
      renderedPairs.push(
        `<div class="guide-bilingual-pair" data-pair-id="${escapeHtml(pair.id)}" tabindex="-1"><div class="guide-english" lang="en"><p class="guide-language-label">ENGLISH</p>${renderSingleStudyMarkdown(pair.en, escapeHtml)}</div><div class="guide-chinese" lang="zh-CN"><p class="guide-language-label">中文对应</p>${renderSingleStudyMarkdown(pair.zh, escapeHtml)}</div></div>`,
      );
    }
    return `<section class="guide-bilingual-topic"><h3>${inlineMarkdown(group.heading, escapeHtml)}</h3>${renderedPairs.join('')}</section>`;
  }).join('');
  return `<div class="guide-bilingual"><div class="guide-bilingual-status" role="note"><strong>完整双语考点</strong><span>每个知识点均按 English → 中文成对展示</span></div>${topics}</div>`;
}
