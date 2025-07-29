import { z } from "zod";

export const extractionRequestSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
  includePayloads: z.boolean().default(true),
  includeSourcePage: z.boolean().default(true),
});

export const extractedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  type: z.enum(["html", "css", "js", "image", "payload", "other"]),
  size: z.number(),
  content: z.string(),
  mimeType: z.string(),
});

export const extractionResultSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  files: z.array(extractedFileSchema),
  totalSize: z.number(),
  totalFiles: z.number(),
  extractedAt: z.string(),
  error: z.string().optional(),
});

export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;
export type ExtractedFile = z.infer<typeof extractedFileSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
