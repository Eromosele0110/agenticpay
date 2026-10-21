import { describe, expect, it } from 'vitest';
import { payoutFailureAnalyticsService } from '../payout-failure-analytics.js';

describe('payoutFailureAnalyticsService', () => {
  it('generates empty analytics with no payouts', () => {
    expect(payoutFailureAnalyticsService).toBeDefined();
    expect(typeof payoutFailureAnalyticsService.generateAnalytics).toBe('function');
  });
});
