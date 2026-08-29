import { randomUUID } from 'node:crypto';
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('chatgpt-machine-mcp', '0.3.0');

export async function withToolSpan<T>(
  toolName: string,
  attributes: Record<string, string | number | boolean | undefined>,
  callback: (traceId: string) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`mcp.tool.${toolName}`, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) span.setAttribute(key, value);
    }
    const spanTraceId = span.spanContext().traceId;
    const traceId = /^0+$/.test(spanTraceId) ? randomUUID().replaceAll('-', '') : spanTraceId;
    try {
      const result = await callback(traceId);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: unknown) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error) span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
