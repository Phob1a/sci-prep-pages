import { parseReleaseContent } from '../js/release-content.js';
import { unlockWithPassword, unlockWithRememberedKey } from '../js/unlock.js';

function renderStartupError(root, reload) {
  root.innerHTML = `<main class="unlock-shell">
    <section class="unlock-card" role="alert" aria-labelledby="unlock-startup-error">
      <div class="brand-mark">SCI</div>
      <p class="eyebrow">STARTUP ERROR</p>
      <h1 id="unlock-startup-error">无法启动复习资料</h1>
      <p class="subtle">资料已解密，但内容无法载入。请重新载入后再试。</p>
      <button class="button" type="button" data-unlock-reload>重新载入</button>
    </section>
  </main>`;
  root.querySelector('[data-unlock-reload]').addEventListener('click', reload);
}

export async function startUnlockScreen({
  root,
  envelope,
  store,
  onUnlocked,
  parseContent = parseReleaseContent,
  unlockPassword = unlockWithPassword,
  unlockRemembered = unlockWithRememberedKey,
  reload = () => globalThis.location.reload(),
}) {
  const remembered = await unlockRemembered({ envelope, store }).catch(() => null);
  if (remembered) {
    await onUnlocked(parseContent(remembered));
    return;
  }

  root.innerHTML = `<main class="unlock-shell">
    <section class="unlock-card">
      <div class="brand-mark">SCI</div>
      <p class="eyebrow">PRIVATE STUDY WORKSPACE</p>
      <h1>打开 SCI Prep</h1>
      <p class="subtle">输入你们约定的复习密码。资料只会在这台设备中解密。</p>
      <form data-unlock-form>
        <label class="unlock-label">复习密码<input type="password" autocomplete="current-password" required data-unlock-password></label>
        <label class="remember-row"><input type="checkbox" checked data-unlock-remember> 记住这台设备</label>
        <p class="notice error" hidden data-unlock-error></p>
        <button class="button" type="submit" data-unlock-submit>进入复习</button>
      </form>
    </section>
  </main>`;

  const form = root.querySelector('[data-unlock-form]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = root.querySelector('[data-unlock-submit]');
    const errorNode = root.querySelector('[data-unlock-error]');
    button.disabled = true;
    errorNode.hidden = true;
    let result;
    try {
      result = await unlockPassword({
        envelope,
        password: root.querySelector('[data-unlock-password]').value,
        remember: root.querySelector('[data-unlock-remember]').checked,
        store,
      });
    } catch {
      errorNode.textContent = '密码不正确，请重新输入。';
      errorNode.hidden = false;
      button.disabled = false;
      return;
    }
    try {
      await onUnlocked(parseContent(result.payload), result);
    } catch {
      renderStartupError(root, reload);
    }
  });
}
