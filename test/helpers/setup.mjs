import { openDatabase } from '../../server/db.mjs';
import { DEMO_GOAL_ID, DEMO_HOUSEHOLD_ID, createClock, ensureDemoHousehold, setupHousehold } from '../../server/household.mjs';
import { createContributionService } from '../../server/payments/contributions.mjs';
import { createPayPalClient } from '../../server/payments/paypal-client.mjs';
import { createPayPalSdkClient } from '../../server/payments/paypal-sdk-client.mjs';
import { createFakePayPal, fakeSdkControllers } from './fake-paypal.mjs';

// Local noon avoids time-zone edge cases in "today" calculations.
export const FIXED_NOW = '2026-11-03T12:00:00';

let requestCounter = 0;
export const requestId = () => `test-request-${String(++requestCounter).padStart(4, '0')}`;

export function setupDomain({ mode = 'example', adapter = 'rest', paypalOptions = {}, file = ':memory:', playMode = 'family', webhookId = 'WH-TEST' } = {}) {
  const db = openDatabase(file);
  const clock = createClock(FIXED_NOW);
  ensureDemoHousehold(db, clock);
  setupHousehold(db, DEMO_HOUSEHOLD_ID, { playMode, name: 'House of Alder', crest: { field: 'violet', charge: 'stag' } });
  const fake = mode === 'sandbox' ? createFakePayPal(paypalOptions) : null;
  const controllers = fake && adapter === 'sdk' ? fakeSdkControllers(fake) : null;
  const credentials = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };
  const paypal = !fake ? null
    : adapter === 'sdk' ? createPayPalSdkClient({ ...credentials, controllers, restFetch: fake.fetch })
      : createPayPalClient({ ...credentials, fetch: fake.fetch });
  const service = createContributionService({ db, clock, mode, paypal, webhookId });
  return { db, clock, fake, paypal, controllers, service, householdId: DEMO_HOUSEHOLD_ID, goalId: DEMO_GOAL_ID };
}

export function contribution(overrides = {}) {
  return {
    householdId: DEMO_HOUSEHOLD_ID,
    goalId: DEMO_GOAL_ID,
    amountCents: 1500,
    approverId: 'm_rowan',
    approvalConfirmed: true,
    requestId: requestId(),
    ...overrides,
  };
}
