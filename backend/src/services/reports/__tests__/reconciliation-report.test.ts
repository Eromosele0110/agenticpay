import { describe, expect, it } from 'vitest';
import { reconciliationReportService } from '../reconciliation-report.js';

describe('reconciliationReportService', () => {
  it('has generateReport method', () => {
    expect(reconciliationReportService).toBeDefined();
    expect(typeof reconciliationReportService.generateReport).toBe('function');
  });
});
