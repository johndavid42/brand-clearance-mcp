export const ENV = {
  PORT: (() => {
    const raw = process.env.PORT ?? "3000";
    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid PORT: ${raw}`);
    }
    return parsed;
  })(),

  NODE_ENV: (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",

  // Optional: free key from https://developer.company-information.service.gov.uk/
  // If absent, Companies House lookups are skipped; OpenCorporates still runs.
  COMPANIES_HOUSE_API_KEY: process.env.COMPANIES_HOUSE_API_KEY ?? null,
};
