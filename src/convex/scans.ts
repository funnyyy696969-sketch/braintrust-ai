import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

async function requireUser(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not signed in");
  return userId;
}

/**
 * Persistence + audit for the multi-image pipeline.
 * Image-level artifacts are keyed by (scanId, imageId) — never shared.
 */

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export const createScan = mutation({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    kind: v.string(),
    structure: v.string(),
    imageCount: v.number(),
    identificationNote: v.string(),
    statusMessage: v.string(),
    inspectionStatus: v.string(),
    metadata: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const scanId = await ctx.db.insert("scans", { ...args, userId, createdAt: now });
    await ctx.db.insert("auditLog", {
      scanId,
      userId,
      action: "inspect",
      detail: `Inspected ${args.fileName} → kind=${args.kind}, structure=${args.structure}, images=${args.imageCount}, status=${args.inspectionStatus}`,
      at: now,
    });
    return scanId;
  },
});

export const getScan = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireUser(ctx);
    return await ctx.db.get(scanId);
  },
});

export const listScans = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const finalizeScan = mutation({
  args: {
    scanId: v.id("scans"),
    extractionNote: v.string(),
  },
  handler: async (ctx, { scanId, extractionNote }) => {
    const userId = await requireUser(ctx);
    await ctx.db.insert("auditLog", {
      scanId,
      userId,
      action: "extract",
      detail: extractionNote,
      at: Date.now(),
    });
  },
});

export const logManualCorrection = mutation({
  args: { scanId: v.id("scans"), detail: v.string() },
  handler: async (ctx, { scanId, detail }) => {
    const userId = await requireUser(ctx);
    await ctx.db.insert("auditLog", {
      scanId,
      userId,
      action: "manual_correction",
      detail,
      at: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const createImages = mutation({
  args: {
    scanId: v.id("scans"),
    images: v.array(
      v.object({
        imageId: v.string(),
        sourceType: v.string(),
        sourceDetail: v.string(),
        width: v.number(),
        height: v.number(),
        channels: v.number(),
      }),
    ),
  },
  handler: async (ctx, { scanId, images }) => {
    await requireUser(ctx);
    const now = Date.now();
    for (const im of images) {
      await ctx.db.insert("images", {
        ...im,
        scanId,
        reviewStatus: "pending",
        analysisStatus: "pending",
        updatedAt: now,
      });
    }
  },
});

export const setReviewStatus = mutation({
  args: {
    scanId: v.id("scans"),
    imageId: v.string(),
    reviewStatus: v.string(),
  },
  handler: async (ctx, { scanId, imageId, reviewStatus }) => {
    await requireUser(ctx);
    const doc = await ctx.db
      .query("images")
      .withIndex("by_scan_and_image", (q) => q.eq("scanId", scanId).eq("imageId", imageId))
      .unique();
    if (!doc) throw new Error(`Image ${imageId} not found for this scan`);
    await ctx.db.patch(doc._id, { reviewStatus, updatedAt: Date.now() });
  },
});

export const listImages = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireUser(ctx);
    const docs = await ctx.db
      .query("images")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    docs.sort((a, b) => a.imageId.localeCompare(b.imageId, undefined, { numeric: true }));
    return docs;
  },
});

export const patchImageAnalysis = mutation({
  args: {
    scanId: v.id("scans"),
    imageId: v.string(),
    analysisStatus: v.string(),
    analysisStage: v.optional(v.string()),
    predictedClass: v.optional(v.string()),
    confidence: v.optional(v.number()),
    probabilities: v.optional(v.string()),
    perturbedPredictedClass: v.optional(v.string()),
    perturbedConfidence: v.optional(v.number()),
    perturbationMethod: v.optional(v.string()),
    ofiValue: v.optional(v.number()),
    ofiConfidenceChange: v.optional(v.number()),
    ofiFormulaVersion: v.optional(v.string()),
    ofiReliable: v.optional(v.boolean()),
    analysisError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const { scanId, imageId, ...fields } = args;
    const doc = await ctx.db
      .query("images")
      .withIndex("by_scan_and_image", (q) => q.eq("scanId", scanId).eq("imageId", imageId))
      .unique();
    if (!doc) throw new Error(`Image ${imageId} not found for this scan`);
    await ctx.db.patch(doc._id, { ...fields, updatedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Analysis audit
// ---------------------------------------------------------------------------

export const logAnalysis = mutation({
  args: {
    scanId: v.id("scans"),
    action: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { scanId, action, detail }) => {
    const userId = await requireUser(ctx);
    await ctx.db.insert("auditLog", {
      scanId,
      userId,
      action,
      detail,
      at: Date.now(),
    });
  },
});

export const getAuditLog = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .collect();
    entries.sort((a, b) => a.at - b.at);
    return entries;
  },
});
