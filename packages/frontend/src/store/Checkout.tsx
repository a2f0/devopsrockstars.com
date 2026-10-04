import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router';
import {cancelCheckout, createCheckout, loadStorefront} from './api';
import {useStoreCart} from './cart';
import CheckoutHeading from './CheckoutHeading';
import type {
  CreateCheckoutResponse,
  ShippingInput,
  StorefrontResponse,
} from '@devopsrockstars/shared-types';
import {formatMoney} from './format';
import {stateCode} from './stateCode';
import {
  ActionLink,
  Button,
  CheckoutGrid,
  Field,
  FormActions,
  FormGrid,
  FullField,
  Input,
  OrderSummary,
  Section,
  SectionTitle,
  ShippingSummary,
  Status,
  StoreShell,
  SummaryRow,
} from './StoreStyles';
import StripePayment from './StripePayment';
import {
  clearPendingCheckout,
  getCheckoutClientToken,
  type PendingCheckout,
  readPendingCheckout,
  storeOrderToken,
  storePendingCheckout,
} from './storage';

const EMPTY_SHIPPING: ShippingInput = {
  name: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
};

const SHIPPING_FIELDS = Object.keys(EMPTY_SHIPPING) as Array<
  keyof ShippingInput
>;

function sameShipping(first: ShippingInput, second: ShippingInput) {
  return SHIPPING_FIELDS.every(field => first[field] === second[field]);
}

const Checkout = React.memo(() => {
  const cart = useStoreCart();
  const navigate = useNavigate();
  // The active checkout and the address it reserved the cart with.
  const [reservation, setReservation] = useState<PendingCheckout | null>(
    readPendingCheckout
  );
  const [storefront, setStorefront] = useState<StorefrontResponse | null>(null);
  const [shipping, setShipping] = useState<ShippingInput>(
    reservation?.shipping ?? EMPTY_SHIPPING
  );
  const [editing, setEditing] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const checkout = reservation?.checkout ?? null;
  // Editing hides the reservation until its address is saved or kept.
  const reserved = editing ? null : reservation;

  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!checkout) return;
    const delay = Date.parse(checkout.expiresAt) - Date.now();
    if (delay <= 0) {
      setClock(Date.now());
      return;
    }
    const timeout = setTimeout(() => setClock(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [checkout]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStorefront(controller.signal)
      .then(setStorefront)
      .catch(loadError => {
        if (!controller.signal.aborted) {
          console.error('Failed to load checkout inventory:', loadError);
          setError('The store is temporarily unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  const variants = useMemo(
    () =>
      new Map(
        storefront?.products.flatMap(product =>
          product.variants.map(variant => [variant.id, {product, variant}])
        ) ?? []
      ),
    [storefront]
  );
  const visibleItems = cart.items.flatMap(item => {
    const entry = variants.get(item.variantId);
    return entry ? [{...item, ...entry}] : [];
  });
  const catalogLines = visibleItems.map(item => ({
    currency: item.variant.currency,
    productName: item.product.name,
    quantity: item.quantity,
    unitAmount: item.variant.unitAmount,
    variantId: item.variantId,
    variantLabel: item.variant.label,
  }));
  const orderLines = checkout?.lines ?? catalogLines;
  const total =
    checkout?.totalAmount ??
    orderLines.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
  const currency = checkout?.currency ?? orderLines[0]?.currency ?? 'usd';
  // A new address reserves the same items again, even if the cart changed
  // after the first reservation.
  const checkoutItems = (reservation?.checkout.lines ?? visibleItems).map(
    item => ({variantId: item.variantId, quantity: item.quantity})
  );

  const update = (field: keyof ShippingInput, value: string) => {
    setShipping(current => ({...current, [field]: value}));
  };

  // Cancels the reservation, or opens the receipt for an order that can no
  // longer be canceled.
  const releaseReservation = async (active: CreateCheckoutResponse) => {
    const order = await cancelCheckout(active.orderId, active.orderToken);
    clearPendingCheckout();
    if (order.status !== 'canceled') {
      navigate(`/store/receipt?order=${active.orderId}`);
      return false;
    }
    setReservation(null);
    setEditing(false);
    return true;
  };

  const startPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (reservation && sameShipping(shipping, reservation.shipping)) {
      setEditing(false);
      return;
    }
    if (!storefront?.stripePublishableKey) {
      setError('Checkout is not configured yet.');
      return;
    }
    if (checkoutItems.length === 0) {
      setError('The items in your cart are no longer available.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A reservation keeps the address it was made with, so a new address
      // releases it and reserves the cart again.
      if (reservation && !(await releaseReservation(reservation.checkout))) {
        return;
      }
      const result = await createCheckout(
        {items: checkoutItems, shipping},
        getCheckoutClientToken()
      );
      storeOrderToken(result.orderId, result.orderToken);
      const pending = {checkout: result, shipping};
      storePendingCheckout(pending);
      setReservation(pending);
    } catch (checkoutError) {
      console.error('Failed to start checkout:', checkoutError);
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : 'Checkout could not be started.'
      );
    } finally {
      setBusy(false);
    }
  };

  const abandonPayment = async () => {
    if (checkout) await releaseReservation(checkout);
  };

  const keepReservedAddress = () => {
    if (reservation) setShipping(reservation.shipping);
    setEditing(false);
  };

  const cancelWithoutPaymentForm = async () => {
    if (canceling) return;
    setCanceling(true);
    setError(null);
    try {
      await abandonPayment();
    } catch (cancelError) {
      console.error('Failed to cancel checkout:', cancelError);
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'Checkout could not be canceled.'
      );
    } finally {
      setCanceling(false);
    }
  };

  const paymentExpired = checkout
    ? Date.parse(checkout.expiresAt) <= clock
    : false;

  if (!checkout && cart.items.length === 0) {
    return (
      <StoreShell>
        <CheckoutHeading />
        <Status>Your cart is empty.</Status>
        <FormActions>
          <ActionLink to="/store">Back to store</ActionLink>
        </FormActions>
      </StoreShell>
    );
  }

  return (
    <StoreShell>
      <CheckoutHeading />
      <CheckoutGrid>
        <Section>
          <SectionTitle>Shipping</SectionTitle>
          {reserved ? (
            <>
              <ShippingSummary data-shipping-address>
                <span>{reserved.shipping.name}</span>
                <span>{reserved.shipping.email}</span>
                <span>
                  {[
                    reserved.shipping.addressLine1,
                    reserved.shipping.addressLine2,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
                <span>
                  {reserved.shipping.city}, {reserved.shipping.state}{' '}
                  {reserved.shipping.postalCode}
                </span>
              </ShippingSummary>
              <FormActions>
                <Button
                  type="button"
                  disabled={paymentBusy || canceling}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              </FormActions>
            </>
          ) : (
            <form onSubmit={startPayment}>
              <FormGrid>
                <FullField>
                  Name
                  <Input
                    required
                    name="name"
                    ref={nameInput}
                    autoComplete="shipping name"
                    maxLength={100}
                    value={shipping.name}
                    onChange={event =>
                      update('name', event.currentTarget.value)
                    }
                  />
                </FullField>
                <FullField>
                  Email
                  <Input
                    required
                    name="email"
                    autoComplete="shipping email"
                    maxLength={254}
                    type="email"
                    value={shipping.email}
                    onChange={event =>
                      update('email', event.currentTarget.value)
                    }
                  />
                </FullField>
                <FullField>
                  Address 1
                  <Input
                    required
                    name="address-line1"
                    autoComplete="shipping address-line1"
                    maxLength={100}
                    value={shipping.addressLine1}
                    onChange={event =>
                      update('addressLine1', event.currentTarget.value)
                    }
                  />
                </FullField>
                <FullField>
                  Address 2
                  <Input
                    name="address-line2"
                    autoComplete="shipping address-line2"
                    maxLength={100}
                    value={shipping.addressLine2}
                    onChange={event =>
                      update('addressLine2', event.currentTarget.value)
                    }
                  />
                </FullField>
                <Field>
                  City
                  <Input
                    required
                    name="city"
                    autoComplete="shipping address-level2"
                    maxLength={100}
                    value={shipping.city}
                    onChange={event =>
                      update('city', event.currentTarget.value)
                    }
                  />
                </Field>
                <Field>
                  State
                  <Input
                    required
                    name="state"
                    autoComplete="shipping address-level1"
                    // Room for a full state name, which autofill can enter.
                    maxLength={32}
                    pattern="[A-Za-z]{2}"
                    value={shipping.state}
                    onChange={event =>
                      update('state', stateCode(event.currentTarget.value))
                    }
                  />
                </Field>
                <Field>
                  ZIP code
                  <Input
                    required
                    name="postal-code"
                    autoComplete="shipping postal-code"
                    maxLength={10}
                    pattern="[0-9]{5}(-[0-9]{4})?"
                    value={shipping.postalCode}
                    onChange={event =>
                      update('postalCode', event.currentTarget.value)
                    }
                  />
                </Field>
                <Field>
                  Country
                  <Input disabled value="United States" />
                </Field>
              </FormGrid>
              <FormActions>
                {reservation ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={keepReservedAddress}
                  >
                    Cancel
                  </Button>
                ) : (
                  <ActionLink to="/store">Back</ActionLink>
                )}
                <Button
                  type="submit"
                  disabled={busy || !storefront || checkoutItems.length === 0}
                >
                  {busy ? 'Reserving…' : 'Continue to payment'}
                </Button>
              </FormActions>
            </form>
          )}
        </Section>

        <Section>
          <SectionTitle>Your order</SectionTitle>
          <OrderSummary>
            {orderLines.map(item => (
              <SummaryRow key={item.variantId}>
                <span>
                  {item.productName} — {item.variantLabel} × {item.quantity}
                </span>
                <span>
                  {formatMoney(item.unitAmount * item.quantity, item.currency)}
                </span>
              </SummaryRow>
            ))}
            <SummaryRow>
              <span>Shipping</span>
              <i>free</i>
            </SummaryRow>
            <SummaryRow>
              <span>Total</span>
              <span>{formatMoney(total, currency)}</span>
            </SummaryRow>
          </OrderSummary>
          {reserved ? (
            <>
              <SectionTitle>Payment</SectionTitle>
              {storefront?.stripePublishableKey ? (
                <StripePayment
                  checkout={reserved.checkout}
                  onBusyChange={setPaymentBusy}
                  onCancel={abandonPayment}
                  paymentExpired={paymentExpired}
                  publishableKey={storefront.stripePublishableKey}
                  shipping={reserved.shipping}
                  onConfirmed={() => {
                    clearPendingCheckout();
                    navigate(
                      `/store/receipt?order=${reserved.checkout.orderId}`
                    );
                  }}
                />
              ) : (
                <>
                  <Status $error>
                    The payment form is unavailable. You can cancel this
                    reservation and try again.
                  </Status>
                  <FormActions>
                    <Button
                      type="button"
                      disabled={canceling}
                      onClick={() => void cancelWithoutPaymentForm()}
                    >
                      {canceling ? 'Canceling…' : 'Cancel checkout'}
                    </Button>
                  </FormActions>
                </>
              )}
              {paymentExpired ? (
                <Status $error>
                  This reservation expired. Cancel it to return to the store.
                </Status>
              ) : (
                <Status>
                  Reserved until{' '}
                  {new Date(reserved.checkout.expiresAt).toLocaleTimeString()}.
                </Status>
              )}
            </>
          ) : null}
          {error ? <Status $error>{error}</Status> : null}
        </Section>
      </CheckoutGrid>
    </StoreShell>
  );
});

export default Checkout;
