import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';
import {
  clearPendingCheckout,
  clearShippingDraft,
  getCheckoutClientToken,
  readOrderToken,
  readPendingCheckout,
  readShippingDraft,
  storeOrderToken,
  storePendingCheckout,
  storeShippingDraft,
} from './storage';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
});

function pendingCheckout(expiresAt: string) {
  return {
    checkout: {
      clientSecret: 'pi_store_secret_test',
      currency: 'usd',
      expiresAt,
      lines: [
        {
          currency: 'usd',
          productName: 'DevOps Rockstars 59FIFTY',
          quantity: 2,
          unitAmount: 2000,
          variantId: 'hat-5950-7-1-4',
          variantLabel: '7 1/4',
        },
      ],
      orderId: '12345678-1234-4234-8234-123456789abc',
      orderToken: 'order-token',
      totalAmount: 4000,
    },
    shipping: {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      addressLine1: '1 Navy Way',
      addressLine2: '',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US' as const,
    },
  };
}

test('persists and resumes an unexpired checkout', () => {
  const pending = pendingCheckout(new Date(Date.now() + 60_000).toISOString());
  storePendingCheckout(pending);
  assert.deepEqual(readPendingCheckout(), pending);
  clearPendingCheckout();
  assert.equal(readPendingCheckout(), null);
});

test('discards expired or malformed pending checkouts', () => {
  storePendingCheckout(
    pendingCheckout(new Date(Date.now() - 3 * 60_000).toISOString())
  );
  assert.equal(readPendingCheckout(), null);
  sessionStorage.setItem(
    'devopsrockstars.store.pending-checkout',
    JSON.stringify({checkout: {clientSecret: 'untrusted'}})
  );
  assert.equal(readPendingCheckout(), null);
});

test('keeps a recently expired checkout available for cancellation', () => {
  const pending = pendingCheckout(new Date(Date.now() - 60_000).toISOString());
  storePendingCheckout(pending);
  assert.deepEqual(readPendingCheckout(), pending);
});

test('keeps a shipping draft until it is cleared', () => {
  const {shipping} = pendingCheckout(new Date().toISOString());
  storeShippingDraft(shipping);
  assert.deepEqual(readShippingDraft(), shipping);
  clearShippingDraft();
  assert.equal(readShippingDraft(), null);
});

test('discards a malformed shipping draft', () => {
  for (const draft of ['{', JSON.stringify({name: 'Grace Hopper'})]) {
    sessionStorage.setItem('devopsrockstars.store.shipping-draft', draft);
    assert.equal(readShippingDraft(), null);
    assert.equal(
      sessionStorage.getItem('devopsrockstars.store.shipping-draft'),
      null
    );
  }
});

test('keeps a random checkout client token stable for the page session', () => {
  const token = getCheckoutClientToken();
  assert.match(token, /^[0-9a-f-]{36}$/u);
  assert.equal(getCheckoutClientToken(), token);
});

test('order token storage fails safely when session storage is blocked', () => {
  storeOrderToken('order-id', 'order-token');
  assert.equal(readOrderToken('order-id'), 'order-token');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    },
  });
  assert.doesNotThrow(() => storeOrderToken('order-id', 'order-token'));
  assert.equal(readOrderToken('order-id'), null);
});
