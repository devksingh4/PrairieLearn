import { describe, it, assert } from 'vitest';

import { TransformRegistry } from './transform-registry.js';
import type { TransformHandler } from './transform-registry.js';

interface FakeItem {
  value: string;
}

const fakeHandler: TransformHandler<FakeItem> = {
  questionType: 'fake-type',
  transform() {
    return { body: { type: 'text-only' } };
  },
};

describe('TransformRegistry', () => {
  it('registers and retrieves a handler', () => {
    const registry = new TransformRegistry<FakeItem>();
    registry.register(fakeHandler);
    assert.strictEqual(registry.get('fake-type'), fakeHandler);
  });

  it('returns undefined for an unregistered type', () => {
    const registry = new TransformRegistry<FakeItem>();
    assert.isUndefined(registry.get('not-registered'));
  });

  it('has() returns true for registered types', () => {
    const registry = new TransformRegistry<FakeItem>();
    registry.register(fakeHandler);
    assert.isTrue(registry.has('fake-type'));
  });

  it('has() returns false for unregistered types', () => {
    const registry = new TransformRegistry<FakeItem>();
    assert.isFalse(registry.has('fake-type'));
  });

  it('supportedTypes() lists all registered types', () => {
    const registry = new TransformRegistry<FakeItem>();
    const h2: TransformHandler<FakeItem> = { questionType: 'other-type', transform: () => ({ body: { type: 'text-only' } }) };
    registry.register(fakeHandler);
    registry.register(h2);
    const types = registry.supportedTypes();
    assert.include(types, 'fake-type');
    assert.include(types, 'other-type');
    assert.equal(types.length, 2);
  });
});
