import type {
  Stripe,
  StripeElements,
  StripePaymentElement,
} from '@stripe/stripe-js';
import {loadStripe} from '@stripe/stripe-js/pure';
import React, {useEffect, useRef, useState} from 'react';
import type {
  CreateCheckoutResponse,
  ShippingInput,
} from '@devopsrockstars/shared-types';
import {PAYMENT_ELEMENT_OPTIONS} from './paymentElementOptions';
import {Button, FormActions, PaymentHost, Status} from './StoreStyles';

let stripeKey: string | null = null;
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(publishableKey: string) {
  if (stripeKey !== publishableKey || !stripePromise) {
    stripeKey = publishableKey;
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

interface MountedPayment {
  readonly elements: StripeElements;
  readonly payment: StripePaymentElement;
  readonly stripe: Stripe;
}

interface Props {
  readonly checkout: CreateCheckoutResponse;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCancel: () => Promise<void>;
  readonly paymentExpired: boolean;
  readonly publishableKey: string;
  readonly shipping: ShippingInput;
  readonly onConfirmed: () => void;
}

const StripePayment = React.memo(
  ({
    checkout,
    onBusyChange,
    onCancel,
    paymentExpired,
    publishableKey,
    shipping,
    onConfirmed,
  }: Props) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const mountedRef = useRef<MountedPayment | null>(null);
    const [ready, setReady] = useState(false);
    const [busyAction, setBusyAction] = useState<'canceling' | 'paying' | null>(
      null
    );
    const [error, setError] = useState<string | null>(null);

    // Checkout keeps the shipping address locked while a payment or a
    // cancellation is in flight.
    useEffect(() => {
      onBusyChange(busyAction !== null);
      return () => onBusyChange(false);
    }, [busyAction, onBusyChange]);

    useEffect(() => {
      let active = true;
      let payment: StripePaymentElement | null = null;
      void getStripe(publishableKey)
        .then(stripe => {
          if (!active || !stripe || !hostRef.current) {
            if (active) setError('The payment form could not be loaded.');
            return;
          }
          const elements = stripe.elements({
            clientSecret: checkout.clientSecret,
            appearance: {
              theme: 'night',
              variables: {
                colorBackground: '#080808',
                colorText: '#ffffff',
                colorTextSecondary: '#bbbbbb',
                colorDanger: '#ff8a8a',
                colorPrimary: '#ffffff',
                colorIcon: '#ffffff',
                fontFamily: 'Open-Sans, Helvetica, Sans-Serif',
                fontSizeBase: '15px',
                borderRadius: '0px',
              },
              rules: {
                '.Input': {
                  border: '1px solid #666666',
                  boxShadow: 'none',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                },
                '.Input:focus': {
                  border: '1px solid #ffffff',
                  boxShadow: 'none',
                },
              },
            },
          });
          payment = elements.create('payment', PAYMENT_ELEMENT_OPTIONS);
          payment.on('ready', () => active && setReady(true));
          payment.mount(hostRef.current);
          mountedRef.current = {stripe, elements, payment};
        })
        .catch(loadError => {
          console.error('Failed to load Stripe:', loadError);
          if (active) setError('The payment form could not be loaded.');
        });

      return () => {
        active = false;
        mountedRef.current = null;
        // Stripe tears down an element that fails to load, and destroying it
        // again throws, which would take the whole checkout down with it.
        try {
          payment?.destroy();
        } catch (destroyError) {
          console.warn('Failed to destroy the payment form:', destroyError);
        }
      };
    }, [checkout.clientSecret, publishableKey]);

    const confirm = async () => {
      const mounted = mountedRef.current;
      if (!mounted || busyAction || paymentExpired) return;
      setBusyAction('paying');
      setError(null);
      try {
        const submitted = await mounted.elements.submit();
        if (submitted.error) {
          setError(submitted.error.message ?? 'Check your payment details.');
          setBusyAction(null);
          return;
        }
        const returnUrl = new URL('/store/receipt', globalThis.location.href);
        returnUrl.searchParams.set('order', checkout.orderId);
        const result = await mounted.stripe.confirmPayment({
          elements: mounted.elements,
          redirect: 'if_required',
          confirmParams: {
            return_url: returnUrl.href,
            payment_method_data: {
              billing_details: {
                name: shipping.name,
                email: shipping.email,
                address: {
                  line1: shipping.addressLine1,
                  line2: shipping.addressLine2 || null,
                  city: shipping.city,
                  state: shipping.state,
                  postal_code: shipping.postalCode,
                  country: shipping.country,
                },
              },
            },
          },
        });
        if (result.error) {
          setError(
            result.error.message ?? 'Your payment could not be completed.'
          );
          setBusyAction(null);
          return;
        }
        onConfirmed();
      } catch (confirmationError) {
        console.error(
          'Failed to confirm the Stripe payment:',
          confirmationError
        );
        setError(
          'The payment provider could not complete the request. Please try again.'
        );
        setBusyAction(null);
      }
    };

    const abandon = async () => {
      if (busyAction) return;
      setBusyAction('canceling');
      setError(null);
      try {
        await onCancel();
      } catch (cancelError) {
        console.error('Failed to cancel checkout:', cancelError);
        setError(
          cancelError instanceof Error
            ? cancelError.message
            : 'Checkout could not be canceled.'
        );
        setBusyAction(null);
      }
    };

    return (
      <>
        <PaymentHost ref={hostRef} />
        {!ready && !error ? (
          <Status>Loading secure payment form…</Status>
        ) : null}
        {error ? <Status $error>{error}</Status> : null}
        <FormActions>
          <Button
            type="button"
            disabled={!ready || busyAction !== null || paymentExpired}
            onClick={confirm}
          >
            {busyAction === 'paying' ? 'Processing…' : `Pay order`}
          </Button>
          <Button
            type="button"
            disabled={busyAction !== null}
            onClick={abandon}
          >
            {busyAction === 'canceling' ? 'Canceling…' : 'Cancel checkout'}
          </Button>
        </FormActions>
      </>
    );
  }
);

export default StripePayment;
