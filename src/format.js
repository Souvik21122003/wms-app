export const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n ?? 0);
export const num = (n) => Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 4 });
export const signed = (n) => (n > 0 ? "+" : "") + num(n);
