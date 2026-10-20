import { describe, expect, it } from 'vitest';
import {
  BaseGatewayAdapter, type GatewayConfig, type GatewayType,
  type PaymentRequest, type PaymentResponse,
} from '../gateway-adapter.js';

const config: GatewayConfig = {
  gatewayType: 'stripe', enabled: true, priority: 1, maxRetries: 0,
  timeoutMs: 1000, healthCheckIntervalMs: 60000,
  circuitBreakerThreshold: 2, credentials: {},
};

class StubGateway extends BaseGatewayAdapter {
  response: PaymentResponse = { success: false, transactionId: 'tx1', status: 'failed' };
  constructor() { super(config); }
  getType(): GatewayType { return 'stripe'; }
  protected async executePayment(_request: PaymentRequest): Promise<PaymentResponse> {
    return this.response;
  }
  protected async performHealthCheck(): Promise<void> {}
}

const request: PaymentRequest = {
  amount: '1.00', currency: 'USD', recipient: 'test', idempotencyKey: 'key',
};

describe('gateway result accounting (#1177)', () => {
  it('records returned failures and opens circuit at threshold', async () => {
    const gateway = new StubGateway();
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().consecutiveFailures).toBe(1);
    expect(gateway.getHealthStatus().successRate).toBe(0);
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().isHealthy).toBe(false);
    await expect(gateway.processPayment(request)).rejects.toThrow('circuit is open');
  });

  it('resets failure streak after successful response', async () => {
    const gateway = new StubGateway();
    await gateway.processPayment(request);
    gateway.response = { success: true, transactionId: 'tx2', status: 'completed' };
    await gateway.processPayment(request);
    expect(gateway.getHealthStatus().consecutiveFailures).toBe(0);
    expect(gateway.getHealthStatus().successRate).toBe(0.5);
  });
});
