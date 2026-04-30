# HKO Temperature Market App

A full Next.js app for Hong Kong Observatory maximum temperature prediction market analysis.

## Features

- Auto fetch HKO current weather report.
- Auto fetch HKO 9-day forecast.
- Auto fetch latest maximum/minimum air temperature since midnight.
- Monte Carlo probability engine for daily maximum temperature outcomes.
- Poe API Traditional Chinese / Cantonese-style explanation.
- Admin-configurable market assumptions.
- Optional Neon Postgres persistence for state and forecast history.
- Settlement check using HKO Weather and Radiation Level Report.

## Environment Variables

```env
POE_API_KEY=
POE_MODEL=Claude-Sonnet-4.6
ADMIN_SECRET=
DATABASE_URL=