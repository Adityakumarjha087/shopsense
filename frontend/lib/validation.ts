export interface Address {
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
}

export const EMPTY_ADDRESS: Address = { fullName: "", line1: "", line2: "", city: "", state: "", postalCode: "", phone: "" };

/** Mirrors the backend ShippingAddressSchema so users get instant feedback. */
export function validateAddress(a: Address): Partial<Record<keyof Address, string>> {
  const e: Partial<Record<keyof Address, string>> = {};
  if (a.fullName.trim().length < 2) e.fullName = "Enter your full name";
  if (a.line1.trim().length < 3) e.line1 = "Enter your street address";
  if (a.city.trim().length < 2) e.city = "Enter a city";
  if (a.state.trim().length < 2) e.state = "Enter a state";
  if (!/^\d{6}$/.test(a.postalCode.trim())) e.postalCode = "PIN code must be 6 digits";
  if (!/^\+?\d{10,13}$/.test(a.phone.trim())) e.phone = "Phone must be 10–13 digits";
  return e;
}

export function luhnValid(card: string): boolean {
  const digits = card.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
