import {Link} from 'react-router';
import styled from 'styled-components';

export const StoreShell = styled.section`
  width: 100%;
  padding: 8px 0 48px;
  pointer-events: auto;
  overflow-wrap: anywhere;
`;

// The store page centers its whole column; checkout and the receipt stay
// left-aligned around their forms. It carries its own top padding because it
// has no heading to space the art away from the navigation.
export const StorePage = styled(StoreShell)`
  position: relative;
  padding-top: 32px;
  text-align: center;
`;

export const StoreHeading = styled.h1`
  margin-bottom: 28px;
  font-size: clamp(28px, 5vw, 52px);
  font-weight: 400;
  letter-spacing: -0.04em;
`;

export const Eyebrow = styled.div`
  margin-bottom: 8px;
  color: #aaa;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
`;

export const ProductGrid = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
`;

// The art's viewBox is cropped to the hat, so the block hugs the image rather
// than reserving height for whitespace baked into the file.
export const ProductArt = styled.div`
  width: 100%;
  display: grid;
  place-items: center;
  background: transparent;

  > img {
    display: block;
    width: min(100%, 480px);
    height: auto;
  }
`;

export const ProductDetails = styled.div`
  width: min(100%, 280px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
`;

// Newlines in the stored description render as line breaks.
export const ProductCopy = styled.p`
  color: #c7c7c7;
  font-size: 16px;
  line-height: 1.5;
  white-space: pre-line;
`;

export const Price = styled.div`
  font-size: 24px;
`;

export const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: #bbb;
  font-size: 13px;
`;

const controlStyles = `
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #666;
  border-radius: 0;
  background: #080808;
  color: white;
  font: inherit;
  font-size: 16px;
  min-height: 44px;
  padding: 10px 11px;
  pointer-events: auto;

  &:focus {
    border-color: white;
    outline: none;
  }

  /* Chromium and Safari paint autofilled fields light with an !important
     background, so an inset shadow covers it and the text stays white.
     Firefox tints them with a filter instead. Separate rules, because a
     browser drops a whole selector list it does not fully support. */
  &:-webkit-autofill {
    box-shadow: 0 0 0 1000px #080808 inset;
    -webkit-text-fill-color: white;
    caret-color: white;
  }

  &:autofill {
    box-shadow: 0 0 0 1000px #080808 inset;
    -webkit-text-fill-color: white;
    caret-color: white;
    filter: none;
  }
`;

export const Input = styled.input`
  ${controlStyles}
`;

const monospace = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// The size picker is wider than the add-to-cart button beneath it.
export const SizeField = styled.div`
  position: relative;
  width: min(100%, 180px);
`;

export const SizeBox = styled.span`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #aaa;
  background: #080808;
  font-family: ${monospace};
  font-size: 15px;
  padding: 10px 11px;
  text-align: center;
`;

export const SizeCaret = styled.span`
  width: 10px;
  height: 6px;
  background-color: #bbb;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='black' stroke-width='1.5'/%3E%3C/svg%3E")
    center / contain no-repeat;
  transition: rotate 0.15s ease;
`;

// The trigger spans the bordered box and the caret centered beneath it, so
// clicking either one opens the list.
export const SizeTrigger = styled.button`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 0;
  padding: 0;
  background: none;
  color: white;
  font: inherit;
  cursor: pointer;

  &:focus {
    outline: none;
  }

  &:focus ${SizeBox}, &[aria-expanded='true'] ${SizeBox} {
    border-color: white;
  }

  /* Matches the add-to-cart button's hover. */
  &:hover:not(:disabled) ${SizeBox} {
    border-color: white;
    background: #1a1a1a;
  }

  &:hover ${SizeCaret}, &:focus ${SizeCaret} {
    background-color: white;
  }

  &[aria-expanded='true'] ${SizeCaret} {
    rotate: 180deg;
  }

  &:disabled {
    color: #666;
    cursor: not-allowed;
  }

  &:disabled ${SizeBox} {
    border-color: #444;
  }

  &:disabled ${SizeCaret} {
    background-color: #444;
  }
`;

export const SizeList = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 1;
  border: 1px solid #aaa;
  background: #080808;
  font-family: ${monospace};
  font-size: 15px;
  text-align: center;
`;

export const SizeOption = styled.div<{$active: boolean}>`
  position: relative;
  box-sizing: border-box;
  min-height: 44px;
  padding: 9px 11px;
  background: ${({$active}) => ($active ? '#1a1a1a' : '#080808')};
  cursor: pointer;

  &[aria-selected='true'] {
    background: #242424;
  }

  /* Out of flow, so the checkmark does not push the size off center. */
  &[aria-selected='true']::before {
    content: '✓' / '';
    position: absolute;
    left: 11px;
    color: #bbb;
  }
`;

export const Button = styled.button`
  min-height: 44px;
  border: 1px solid #aaa;
  border-radius: 0;
  background: #101010;
  color: white;
  font: inherit;
  font-size: 14px;
  padding: 9px 18px;
  cursor: pointer;
  pointer-events: auto;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: white;
    background: #1a1a1a;
  }

  &:disabled {
    border-color: #444;
    color: #666;
    cursor: not-allowed;
  }
`;

export const AddToCart = styled(Button)`
  width: min(100%, 140px);
`;

export const ActionLink = styled(Link)`
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1px solid #aaa;
  color: white;
  font-size: 14px;
  padding: 9px 18px;
  text-decoration: none;
  pointer-events: auto;

  &:hover,
  &:focus-visible {
    border-color: white;
    color: white;
    background: #1a1a1a;
  }
`;

export const CartPanel = styled.aside`
  width: min(100%, 460px);
  margin: 42px auto 0;
  border-top: 1px solid #4d4d4d;
  padding-top: 16px;
  text-align: left;
`;

export const CartRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid #242424;
  font-size: 15px;

  button {
    min-height: 44px;
    min-width: 44px;
    border: 0;
    background: none;
    color: white;
    font: inherit;
    font-size: 13px;
    text-decoration: underline;
    cursor: pointer;
  }
`;

export const CartActions = styled.div`
  margin-top: 16px;
  display: flex;
  justify-content: center;
`;

export const CheckoutGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 1.05fr) minmax(250px, 0.95fr);
  gap: 42px;
  align-items: start;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

export const Section = styled.section`
  min-width: 0;
`;

export const SectionTitle = styled.h2`
  margin: 0 0 18px;
  padding-bottom: 7px;
  border-bottom: 1px solid #4d4d4d;
  font-size: 18px;
  font-weight: 400;
`;

export const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

export const FullField = styled(Field)`
  grid-column: 1 / -1;
`;

// The reserved address, one line per part, in place of the locked form.
export const ShippingSummary = styled.p`
  color: #ccc;
  font-size: 15px;
  line-height: 1.5;

  > span {
    display: block;
  }
`;

export const FormActions = styled.div`
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
`;

export const OrderSummary = styled.div`
  margin-bottom: 28px;
  color: #ccc;
  font-size: 14px;
`;

export const SummaryRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  padding: 7px 0;
  border-bottom: 1px solid #292929;
`;

export const Status = styled.p<{$error?: boolean}>`
  margin-top: 16px;
  color: ${({$error}) => ($error ? '#ff8a8a' : '#aaa')};
  font-size: 14px;
  line-height: 1.4;
`;

export const InventoryStatus = styled(Status)`
  position: absolute;
  top: 4px;
  right: 0;
  left: 0;
  margin: 0;
  pointer-events: none;
`;

export const PaymentHost = styled.div`
  min-height: 130px;
  margin-top: 8px;
`;

export const ReceiptPanel = styled.div`
  max-width: 620px;
  border-top: 1px solid #4d4d4d;
  padding-top: 20px;

  p + p {
    margin-top: 12px;
  }
`;
