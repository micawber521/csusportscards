// Browser-side cart: just a list of card ids in localStorage. Prices are never
// trusted from here — the server reprices from the build's card data.
const KEY = "csu-cart";

export function getCart(): number[] {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

export function setCart(ids: number[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage blocked (private mode etc.) — the cart just won't persist.
  }
  cartCount();
}

export function cartCount() {
  const el = document.getElementById("cart-count");
  if (el) el.textContent = String(getCart().length);
}
