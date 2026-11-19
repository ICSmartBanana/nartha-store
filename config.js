// Public config — safe to ship to the browser (no secrets here).
export const CONFIG = {
  store: "https://www.nartha.in",
  supabaseUrl: "https://lkeinzvwnnmunibzeqdp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrZWluenZ3bm5tdW5pYnplcWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNjU1ODIsImV4cCI6MjExMDY0MTU4Mn0.KfuuRuocb0IhU5LWX4378gG6gyEPm8Ql4xOjbmgqrNA",
  heroHandles: ["suvarna-rekhini", "crimson-harithaka", "neela-lata"],
  weeklyLimit: 3, // display only — the real limit is enforced by the server (WEEKLY_LIMIT secret)
};
