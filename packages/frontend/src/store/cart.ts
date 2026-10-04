import {useCallback, useState} from 'react';
import type {CartItemInput} from '@devopsrockstars/shared-types';

const CART_KEY = 'devopsrockstars.store.cart';

function isCartItem(value: unknown): value is CartItemInput {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<CartItemInput>;
  return (
    typeof item.variantId === 'string' &&
    Number.isSafeInteger(item.quantity) &&
    (item.quantity ?? 0) > 0
  );
}

function readCart(): CartItemInput[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(CART_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isCartItem) : [];
  } catch {
    return [];
  }
}

function writeCart(items: readonly CartItemInput[]) {
  try {
    sessionStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // The in-memory cart remains usable when browser storage is unavailable.
  }
}

export function addCartItem(
  current: readonly CartItemInput[],
  variantId: string
) {
  if (current.reduce((sum, item) => sum + item.quantity, 0) >= 2) {
    return current;
  }
  const existing = current.find(item => item.variantId === variantId);
  return existing
    ? current.map(item =>
        item.variantId === variantId
          ? {...item, quantity: Math.min(item.quantity + 1, 2)}
          : item
      )
    : [...current, {variantId, quantity: 1}];
}

export function useStoreCart() {
  const [items, setItems] = useState<readonly CartItemInput[]>(readCart);

  const add = useCallback((variantId: string) => {
    setItems(current => {
      const next = addCartItem(current, variantId);
      writeCart(next);
      return next;
    });
  }, []);

  const remove = useCallback((variantId: string) => {
    setItems(current => {
      const next = current.filter(item => item.variantId !== variantId);
      writeCart(next);
      return next;
    });
  }, []);

  const replace = useCallback((next: readonly CartItemInput[]) => {
    writeCart(next);
    setItems(next);
  }, []);

  const clear = useCallback(() => {
    writeCart([]);
    setItems([]);
  }, []);

  return {items, add, remove, replace, clear};
}
