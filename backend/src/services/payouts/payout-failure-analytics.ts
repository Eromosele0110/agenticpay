/**
 * payout-failure-analytics.ts — Issue #939
 *
 * Payout failure analytics dashboard: classifies payout failures, computes
 * failure rates by merchant/asset/provider, and surfaces top failure patterns
 * for a date range.
 */

import { FailureAnalytics, classifyFailure, type ErrorCode } from '../failure-analysis.js';
import { payoutEngine } from './payout-engine.js';

export interface PayoutFailureFilters {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  merchantId?: string;
  asset?: string;
}

interface FailureRecord {
  id: string;
  payoutId: string;
  merchantId: string;
  asset: string;
  provider: string;
  amount: number;
  errorCode: string;
  errorMessage: string;
  attempt: number;
  occurredAt: Date;
  txHash?: string;
}

interface FailureSummary {
  period: string;
  merchantId: string;
  asset: string;
  provider: string;
  totalPayouts: number;
  failedPayouts: number;
  failureRate: number;
  totalAmount: number;
  failedAmount: number;
}

interface PayoutFailureAnalytics {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  failures: FailureRecord[];
  byErrorCode: Array<{ code: ErrorCode; count: number }>;
  byMerchant: FailureSummary[];
  byAsset: FailureSummary[];
  totals: {
    totalPayouts: number;
    failedPayouts: number;
    failureRate: number;
    totalAmount: number;
    failedAmount: number;
  };
}

function isFailure(batch: any): boolean {
  return batch.status === 'failed';
}

export class PayoutFailureAnalyticsService {
  private analytics = new FailureAnalytics();

  async generateAnalytics(filters: PayoutFailureFilters): Promise<PayoutFailureAnalytics> {
    const { dateFrom, dateTo, tenantId, merchantId, asset } = filters;

    const batches = payoutEngine.getPayoutHistory(merchantId);

    const from = new Date(dateFrom);
    const to = new Date(dateTo + 'T23:59:59.999Z');

    const filtered = batches.filter((b) => {
      const created = b.createdAt;
      if (created < from || created > to) return false;
      if (asset && b.asset !== asset) return false;
      return true;
    });

    const failures: FailureRecord[] = [];
    for (const b of filtered) {
      if (b.status === 'failed') {
        const classification = classifyFailure({
          errorMessage: b.errorMessage ?? 'Batch failed',
          txHash: b.transactionHash,
        });
        this.analytics.analyse({
          errorMessage: b.errorMessage ?? 'Batch failed',
          txHash: b.transactionHash,
        });
        failures.push({
          id: b.id,
          payoutId: b.id,
          merchantId: b.merchantId,
          asset: b.asset,
          provider: b.asset,
          amount: b.amount,
          errorCode: classification.code,
          errorMessage: b.errorMessage ?? 'Batch failed',
          attempt: b.attempts,
          occurredAt: b.createdAt,
          txHash: b.transactionHash,
        });
      }
    }

    const byErrorCode = this.analytics.getTopFailures(20);

    const byMerchantMap = new Map<string, FailureSummary>();
    const byAssetMap = new Map<string, FailureSummary>();

    for (const f of failures) {
      let m = byMerchantMap.get(f.merchantId);
      if (!m) {
        m = { period: '', merchantId: f.merchantId, asset: '', provider: '', totalPayouts: 0, failedPayouts: 0, failureRate: 0, totalAmount: 0, failedAmount: 0 };
        byMerchantMap.set(f.merchantId, m);
      }
      m.totalPayouts += 1;
      m.failedPayouts += 1;
      m.totalAmount += f.amount;
      m.failedAmount += f.amount;
      m.failureRate = m.totalPayouts > 0 ? (m.failedPayouts / m.totalPayouts) * 100 : 0;

      let a = byAssetMap.get(f.asset);
      if (!a) {
        a = { period: '', merchantId: '', asset: f.asset, provider: '', totalPayouts: 0, failedPayouts: 0, failureRate: 0, totalAmount: 0, failedAmount: 0 };
        byAssetMap.set(f.asset, a);
      }
      a.totalPayouts += 1;
      a.failedPayouts += 1;
      a.totalAmount += f.amount;
      a.failedAmount += f.amount;
      a.failureRate = a.totalPayouts > 0 ? (a.failedPayouts / a.totalPayouts) * 100 : 0;
    }

    let totalPayouts = filtered.length;
    let totalAmount = filtered.reduce((s, b) => s + b.amount, 0);
    let failedAmount = failures.reduce((s, f) => s + f.amount, 0);

    const analytics: PayoutFailureAnalytics = {
      dateFrom,
      dateTo,
      tenantId,
      failures,
      byErrorCode,
      byMerchant: [...byMerchantMap.values()].sort((a, b) => b.failedPayouts - a.failedPayouts),
      byAsset: [...byAssetMap.values()].sort((a, b) => b.failedPayouts - a.failedPayouts),
      totals: {
        totalPayouts,
        failedPayouts: failures.length,
        failureRate: totalPayouts > 0 ? (failures.length / totalPayouts) * 100 : 0,
        totalAmount,
        failedAmount,
      },
    };

    return analytics;
  }

  clearHistory(): void {
    this.analytics.clearHistory();
  }
}

export const payoutFailureAnalyticsService = new PayoutFailureAnalyticsService();
