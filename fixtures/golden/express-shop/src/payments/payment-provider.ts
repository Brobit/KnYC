export interface PaymentResult {
  ok: boolean;
  reference?: string;
  reason?: string;
}

export interface PaymentProvider {
  charge(amountCents: number, cardToken: string): Promise<PaymentResult>;
  refund(reference: string): Promise<void>;
}

// Stand-in for a real provider. Test card tokens:
//   "tok_ok"       → charge succeeds
//   "tok_declined" → card declined
export class MockPaymentProvider implements PaymentProvider {
  private counter = 0;
  readonly refunded: string[] = [];

  async charge(amountCents: number, cardToken: string): Promise<PaymentResult> {
    if (amountCents <= 0) return { ok: false, reason: "Invalid amount" };
    if (cardToken === "tok_declined") return { ok: false, reason: "Card declined" };
    if (cardToken !== "tok_ok") return { ok: false, reason: "Unknown card" };
    return { ok: true, reference: `pay_${++this.counter}` };
  }

  async refund(reference: string): Promise<void> {
    this.refunded.push(reference);
  }
}
