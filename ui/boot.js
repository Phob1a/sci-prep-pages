import { loadSubjectContent } from '../js/content.js';
import { forgetRememberedKey } from '../js/unlock.js';
import { createIndexedDbUnlockStore } from '../js/unlock-store.js';
import { enabledSubjects, parseSubjectRegistry } from '../js/subjects.js';
import { StudyApp } from './app.js';
import { startUnlockScreen } from './unlock.js';

export async function bootStudy({
  root,
  fetchFn = globalThis.fetch,
  indexedDBImpl = globalThis.indexedDB,
  reload = () => globalThis.location.reload(),
  loadContent = loadSubjectContent,
  createStore = createIndexedDbUnlockStore,
  startUnlock = startUnlockScreen,
  createApp = (...args) => new StudyApp(...args),
  envelopeUrl = new URL('../content.envelope.json', import.meta.url),
}) {
  const envelopeResponse = await fetchFn(envelopeUrl, { cache: 'no-store' });
  if (envelopeResponse.status === 404) {
    const response = await fetchFn('content/subjects.json');
    if (!response.ok) throw new Error(`科目清单载入失败（HTTP ${response.status}）`);
    const subjects = enabledSubjects(parseSubjectRegistry(await response.json()));
    if (subjects.length === 0) throw new Error('当前没有已通过内容门禁的科目。');
    const content = await loadContent(subjects[0], fetchFn);
    createApp(root, subjects, content).start();
    return;
  }

  if (!envelopeResponse.ok) throw new Error(`加密题库载入失败（HTTP ${envelopeResponse.status}）`);
  const store = createStore(indexedDBImpl);
  await startUnlock({
    root,
    envelope: await envelopeResponse.json(),
    store,
    onUnlocked: ({ subjects, content }, unlockResult = {}) => createApp(root, subjects, content, {
      rememberUnsupported: unlockResult.rememberUnsupported === true,
      onForgetDevice: async () => {
        await forgetRememberedKey(store);
        reload();
      },
    }).start(),
  });
}

function renderFatal(root, error, reload) {
  root.innerHTML = `<div class="fatal-card"><p class="eyebrow">LOAD ERROR</p><h1>无法启动备考工具</h1><p class="subtle"></p><button class="button" type="button">重新载入</button></div>`;
  root.querySelector('.subtle').textContent = error.message;
  root.querySelector('button').addEventListener('click', reload);
}

async function bootBrowser() {
  const root = document.querySelector('#root');
  const reload = () => location.reload();
  try {
    await bootStudy({ root, reload });
  } catch (error) {
    renderFatal(root, error, reload);
  }
}

if (typeof document !== 'undefined') await bootBrowser();
