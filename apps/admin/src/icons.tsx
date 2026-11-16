export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    companies: "M5 21V4h14v17M3 21h18M9 8h1m4 0h1M9 12h1m4 0h1M10 21v-5h4v5",
    clients: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
    settings:
      "m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    operations: "M2 12h5l3-9 4 18 3-9h5",
    help: "M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    bookkeeping: "m12 3 9 5-9 5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5",
    invoicing: "M6 2h9l4 4v16H6ZM14 2v6h5M9 12h7M9 16h5",
    "order-offer": "m12 2 10 5v10l-10 5-10-5V7ZM2 7l10 5 10-5M12 12v10",
    payroll:
      "M16 21v-4c0-3-2-4-6-4s-6 1-6 4v4M17 4a4 4 0 0 1 0 8m3 3c2 1 2 3 2 6M14 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m4 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
    plus: "M12 4v16M4 12h16",
    close: "m5 5 14 14M5 19 19 5",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.companies} />
    </svg>
  );
}
