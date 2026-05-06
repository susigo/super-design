// @ts-nocheck
import { openaiSizeFor } from '../capabilities/image-gen/index.js';
import { imagePriceFor } from '../billing/pricing.js';
import { writeUsageLog } from '../billing/usage-log.js';

export function recordImageUsageIfBillable({
  db,
  meta,
  projectId,
  aspect,
  conversationId = null,
  messageId = null,
}) {
  if (
    meta?.intentionalStub ||
    meta?.usedStubFallback ||
    meta?.surface !== 'image' ||
    !meta?.model
  ) {
    return;
  }

  try {
    const sizeStr = openaiSizeFor(meta.model, aspect);
    const cost = imagePriceFor(meta.model, sizeStr);
    writeUsageLog(db, {
      ts: Date.now(),
      projectId,
      conversationId,
      messageId,
      surface: 'image',
      provider: meta.providerId || 'unknown',
      model: meta.model,
      imageCount: 1,
      imageSize: sizeStr,
      costUsdEstimate: cost,
      costSource: cost == null ? 'pricing-table-missing' : 'pricing-table',
    });
  } catch {
  }
}
