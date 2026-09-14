import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // ------------------------------------------------------------------
    // Multi-image analysis: one record per uploaded FILE (scan), holding
    // the inspection report for that file.
    // ------------------------------------------------------------------
    scans: defineTable({
      userId: v.id("users"),
      fileName: v.string(),
      fileSize: v.number(),
      mimeType: v.string(),
      kind: v.string(), // png | jpeg | tiff | dicom | nifti | zip | unknown
      structure: v.string(), // single | composite | slice-stack | volume | archive | invalid
      imageCount: v.number(),
      identificationNote: v.string(),
      statusMessage: v.string(),
      inspectionStatus: v.string(), // ok | warning | error
      /** Serialized inspection extras: dimensions, channels, bitDepth, seriesInfo. */
      metadata: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // One record per extracted image — every artifact of a single image lives
    // on ITS OWN record, so results can never be mixed across images.
    images: defineTable({
      scanId: v.id("scans"),
      imageId: v.string(), // "img-0", "img-1", …
      sourceType: v.string(),
      sourceDetail: v.string(), // panel index / frame no / slice axis+index / entry name
      width: v.number(),
      height: v.number(),
      channels: v.number(),
      reviewStatus: v.string(), // pending | accepted | rejected
      // Analysis results (all nullable until the pipeline reaches that stage)
      analysisStatus: v.string(), // pending | running | done | error
      analysisStage: v.optional(v.string()),
      predictedClass: v.optional(v.string()),
      confidence: v.optional(v.number()),
      probabilities: v.optional(v.string()), // JSON Record<ClassLabel, number>
      perturbedPredictedClass: v.optional(v.string()),
      perturbedConfidence: v.optional(v.number()),
      perturbationMethod: v.optional(v.string()),
      ofiValue: v.optional(v.number()),
      ofiConfidenceChange: v.optional(v.number()),
      ofiFormulaVersion: v.optional(v.string()),
      ofiReliable: v.optional(v.boolean()),
      analysisError: v.optional(v.string()),
      updatedAt: v.number(),
    })
      .index("by_scan", ["scanId"])
      .index("by_scan_and_image", ["scanId", "imageId"]),

    // Audit trail of extraction and analysis operations.
    auditLog: defineTable({
      scanId: v.id("scans"),
      userId: v.id("users"),
      action: v.string(), // inspect | extract | manual_correction | analyze | analyze_image | error
      detail: v.string(),
      at: v.number(),
    }).index("by_scan", ["scanId"]),
  },
  {
    schemaValidation: false,
  },
);
