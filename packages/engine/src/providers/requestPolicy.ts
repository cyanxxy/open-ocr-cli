import {
  defaultProviderExecutionContext,
  ProviderCostLimitError,
  type ProviderExecutionContext,
  type ProviderRequestPolicy,
  type ProviderRequestSlotOptions,
} from './runtime';

export { ProviderCostLimitError, type ProviderRequestPolicy } from './runtime';

export function isProviderCostLimitError(error: unknown): error is ProviderCostLimitError {
  return error instanceof ProviderCostLimitError;
}

export function configureProviderRequestPolicy(policy: ProviderRequestPolicy): void {
  defaultProviderExecutionContext.configure(policy);
}

export function resetProviderRequestPolicy(): void {
  configureProviderRequestPolicy({});
}

/** Queue one request start so every provider surface shares the same RPM cap. */
export async function waitForProviderRequestSlot(
  signal?: AbortSignal,
  runtime: ProviderExecutionContext = defaultProviderExecutionContext,
  options: ProviderRequestSlotOptions = {},
): Promise<void> {
  await runtime.waitForRequestSlot(signal, options);
}
