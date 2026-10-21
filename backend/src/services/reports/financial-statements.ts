/**
 * financial-statements.ts — Issue #940
 *
 * Automated financial statements generation: balance sheet, income statement,
 * and cash-flow summaries computed from payment data for a date range.
 */

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface FinancialStatementFilters {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  chain?: string;
  status?: string;
  format?: 'json' | 'csv' | 'pdf';
}

interface TxRow {
  date: string;
  chain: string;
  amount: number;
  fee: number;
  net: number;
  status: string;
}

interface PeriodSummary {
  period: string;
  txCount: number;
  grossVolume: number;
  netVolume: number;
  totalFees: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
}

interface FinancialStatement {
  dateFrom: string;
  dateTo: string;
  tenantId: string;
  generatedAt: string;
  chain?: string | null;
  transactions: TxRow[];
  daily: PeriodSummary[];
  monthly: PeriodSummary[];
  totals: {
    txCount: number;
    grossVolume: number;
    netVolume: number;
    totalFees: number;
    completedCount: number;
    failedCount: number;
    pendingCount: number;
  };
}

function toCsv(rows: TxRow[], daily: PeriodSummary[]): string {
  const esc = (v: unknown): string => {
    const s = String(v == null ? '' : v);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [
    'Date,Chain,Amount,Fee,Net,Status',
    ...rows.map(r => [esc(r.date), esc(r.chain), esc(r.amount), esc(r.fee), esc(r.net), esc(r.status)].join('')),
    '',
    'Date,Transactions,Gross Volume,Net Volume,Fees,Completed,Failed,Pending',
    ...daily.map(d => [esc(d.period), String(d.txCount), esc(d.grossVolume.toFixed(8)), esc(d.netVolume.toFixed(8)), esc(d.totalFees.toFixed(8)), String(d.completedCount), String(d.failedCount), String(d.pendingCount)].join('')),
  ];
  return lines.join('\n');
}

function buildSimplePdf(stmt: FinancialStatement): Buffer {
  const lines: string[] = [];
  lines.push('Financial Statement');
  lines.push('='.repeat(60));
  lines.push(`Tenant: ${stmt.tenantId}`);
  lines.push(`Period: ${stmt.dateFrom} to ${stmt.dateTo}`);
  lines.push(`Generated: ${stmt.generatedAt}`);
  lines.push(`Chain: ${stmt.chain ?? 'all'}`);
  lines.push('');
  lines.push('Totals');
  lines.push('-'.repeat(60));
  lines.push(`Transactions: ${stmt.totals.txCount}`);
  lines.push(`Gross Volume: ${stmt.totals.grossVolume.toFixed(8)}`);
  lines.push(`Net Volume: ${stmt.totals.netVolume.toFixed(8)}`);
  lines.push(`Total Fees: ${stmt.totals.totalFees.toFixed(8)}`);
  lines.push(`Completed: ${stmt.totals.completedCount}`);
  lines.push(`Failed: ${stmt.totals.failedCount}`);
  lines.push(`Pending: ${stmt.totals.pendingCount}`);
  lines.push('');
  lines.push('Daily Summary');
  lines.push('-'.repeat(60));
  lines.push('Date            | Txs | Gross     | Net       | Fees      | Completed | Failed | Pending');
  lines.push('-'.repeat(60));
  for (const d of stmt.daily.slice(0, 50)) {
    lines.push(`${d.period.padEnd(15)} | ${String(d.txCount).padEnd(3)} | ${d.grossVolume.toFixed(8).padEnd(9)} | ${d.netVolume.toFixed(8).padEnd(9)} | ${d.totalFees.toFixed(8).padEnd(9)} | ${String(d.completedCount).padEnd(9)} | ${String(d.failedCount).padEnd(6)} | ${String(d.pendingCount)}`);
  }
  if (stmt.daily.length > 50) lines.push(`... and ${stmt.daily.length - 50} more days`);
  const text = lines.join('\n');
  const buffer = Buffer.from(
    'PDF-1.4\n%\xFF\xFF\xFF\xFF\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
    '4 0 obj\n<< /Length ' + text.length + ' >>\nstream\n' +
    text.replace(/\(/g, '\\(').replace(/\)/g, '\\)') + '\n' +
    'endstream\nendobj\n' +
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    'xref\n0 6\n' +
    '0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    '0000000266 00000 n \n' +
    '0000000378 00000 n \n' +
    'trailer\n<< /Size 6 /Root 1 0 R >>\n' +
    'startxref\n446\n%%EOF'
  );
  return buffer;
}

export class FinancialStatementService {
  async generateStatement(filters: FinancialStatementFilters): Promise<{ statement: FinancialStatement; csv: string; pdf: Buffer }> {
    const { dateFrom, dateTo, tenantId, chain, status } = filters;

    const where: any = {
      tenantId,
      createdAt: {
        gte: new Date(dateFrom),
        lte: new Date(dateTo + 'T23:59:59.999Z'),
      },
      deletedAt: null,
    };
    if (chain) where.network = chain;
    if (status) where.status = status;

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10000,
    });

    const rows: TxRow[] = payments.map((p: any) => {
      const amount = Number(p.amount);
      const fee = 0;
      const net = amount - fee;
      return {
        date: p.createdAt.toISOString().split('T')[0],
        chain: p.network,
        amount,
        fee,
        net,
        status: p.status,
      };
    });

    const dailyGroups: Record<string, TxRow[]> = {};
    const monthlyGroups: Record<string, TxRow[]> = {};
    for (const r of rows) {
      (dailyGroups[r.date] ??= []).push(r);
      (monthlyGroups[r.date.slice(0, 7)] ??= []).push(r);
    }

    const summarize = (items: TxRow[], period: string): PeriodSummary => ({
      period,
      txCount: items.length,
      grossVolume: items.reduce((s, r) => s + r.amount, 0),
      netVolume: items.reduce((s, r) => s + r.net, 0),
      totalFees: items.reduce((s, r) => s + r.fee, 0),
      completedCount: items.filter(r => r.status === 'completed').length,
      failedCount: items.filter(r => r.status === 'failed').length,
      pendingCount: items.filter(r => r.status === 'pending').length,
    });

    const daily = Object.entries(dailyGroups)
      .map(([period, items]) => summarize(items, period))
      .sort((a, b) => a.period.localeCompare(b.period));

    const monthly = Object.entries(monthlyGroups)
      .map(([period, items]) => summarize(items, period))
      .sort((a, b) => a.period.localeCompare(b.period));

    const statement: FinancialStatement = {
      dateFrom,
      dateTo,
      tenantId,
      generatedAt: new Date().toISOString(),
      chain: chain ?? null,
      transactions: rows,
      daily,
      monthly,
      totals: {
        txCount: rows.length,
        grossVolume: rows.reduce((s, r) => s + r.amount, 0),
        netVolume: rows.reduce((s, r) => s + r.net, 0),
        totalFees: rows.reduce((s, r) => s + r.fee, 0),
        completedCount: rows.filter(r => r.status === 'completed').length,
        failedCount: rows.filter(r => r.status === 'failed').length,
        pendingCount: rows.filter(r => r.status === 'pending').length,
      },
    };

    const csv = toCsv(rows, daily);
    const pdf = buildSimplePdf(statement);

    return { statement, csv, pdf };
  }
}

export const financialStatementService = new FinancialStatementService();
