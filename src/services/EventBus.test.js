import { eventBus, VAULT_EVENT_CHANNEL, emitVaultEvent } from './EventBus.js';

// eventBus is a shared, module-level singleton by design - every test
// here must remove its own listeners afterward so they don't leak into
// (or double-count in) other test files that also touch the same
// singleton (VaultService.test.js, CommandManager.test.js).
afterEach(() => {
  eventBus.removeAllListeners(VAULT_EVENT_CHANNEL);
});

describe('emitVaultEvent', () => {
  test('delivers a { action, details, timestamp } envelope to listeners', () => {
    const received = [];
    eventBus.on(VAULT_EVENT_CHANNEL, (event) => received.push(event));

    emitVaultEvent('entry.created', { entryId: 'abc123', title: 'GitHub' });

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe('entry.created');
    expect(received[0].details).toEqual({ entryId: 'abc123', title: 'GitHub' });
    expect(typeof received[0].timestamp).toBe('string');
    expect(() => new Date(received[0].timestamp).toISOString()).not.toThrow();
  });

  test('defaults details to an empty object when omitted', () => {
    const received = [];
    eventBus.on(VAULT_EVENT_CHANNEL, (event) => received.push(event));

    emitVaultEvent('vault.locked');

    expect(received[0].details).toEqual({});
  });

  test('delivers events to every subscribed listener', () => {
    let countA = 0;
    let countB = 0;
    eventBus.on(VAULT_EVENT_CHANNEL, () => {
      countA += 1;
    });
    eventBus.on(VAULT_EVENT_CHANNEL, () => {
      countB += 1;
    });

    emitVaultEvent('settings.updated');

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  test('a listener that unsubscribes stops receiving further events', () => {
    const received = [];
    const listener = (event) => received.push(event);
    eventBus.on(VAULT_EVENT_CHANNEL, listener);

    emitVaultEvent('entry.created');
    eventBus.off(VAULT_EVENT_CHANNEL, listener);
    emitVaultEvent('entry.deleted');

    expect(received).toHaveLength(1);
    expect(received[0].action).toBe('entry.created');
  });

  test('events on unrelated channels are not delivered to vault-event listeners', () => {
    const received = [];
    eventBus.on(VAULT_EVENT_CHANNEL, (event) => received.push(event));

    eventBus.emit('some-other-channel', { action: 'entry.created' });

    expect(received).toHaveLength(0);
  });

  test('VAULT_EVENT_CHANNEL is the stable string consumers key off of', () => {
    expect(VAULT_EVENT_CHANNEL).toBe('vault-event');
  });
});
