import { decryptPayload } from './content-envelope.js';

export async function unlockWithPassword({ envelope, password, remember, store }) {
  const { payload, key } = await decryptPayload(envelope, password);
  let remembered = false;
  let rememberUnsupported = false;
  if (remember) {
    try {
      await store.put({ contentVersion: envelope.contentVersion, key });
      remembered = true;
    } catch {
      rememberUnsupported = true;
    }
  }
  return { payload, remembered, rememberUnsupported };
}

export async function unlockWithRememberedKey({ envelope, store }) {
  const entry = await store.get().catch(() => null);
  if (!entry) return null;
  if (entry.contentVersion !== envelope.contentVersion) {
    await store.delete().catch(() => undefined);
    return null;
  }
  try {
    return (await decryptPayload(envelope, entry.key)).payload;
  } catch {
    await store.delete().catch(() => undefined);
    return null;
  }
}

export async function forgetRememberedKey(store) {
  await store.delete();
}
